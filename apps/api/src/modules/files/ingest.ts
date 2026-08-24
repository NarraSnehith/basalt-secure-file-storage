import { unlink } from 'node:fs/promises';
import type { Request } from 'express';
import { sql, type Transaction } from 'kysely';
import { db, PG, pgErrorCode } from '../../db/client.js';
import type { Database, FileRow, UserRow } from '../../db/types.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { formatBytes } from '../../lib/bytes.js';
import { extensionOf, suffixName } from '../../lib/filenames.js';
import { extractText } from '../../lib/extract.js';
import { isBlockedExtension, resolveType, type ResolvedType } from '../../lib/mime.js';
import { logger } from '../../lib/logger.js';
import { newStorageKey, storage } from '../../storage/index.js';
import { recordEvent } from '../activity/service.js';
import { assertFolderAccessible } from '../folders/service.js';
import { toFileDTO, type FileDTO } from './dto.js';

/**
 * The single door into the store.
 *
 * Four paths lead here — a plain multipart upload, the final step of a resumable
 * session, a submission through a file request, and an instant upload of content
 * the account already holds — and all of them need identical treatment: the same
 * validation, the same content sniffing, the same quota arithmetic, the same
 * audit trail. Writing that four times is how one of them ends up subtly weaker
 * than the others.
 */

export interface IngestSource {
  filename: string;
  declaredMime: string | null;
  /** A spooled file holding the complete bytes. Consumed either way. */
  spoolPath: string;
  size: number;
  checksum: Buffer;
  /** First bytes, for magic-byte sniffing. */
  head: Buffer;
}

export interface IngestOptions {
  folderId: string | null;
  /** What to do when the folder already holds a file with this name. */
  onConflict: 'version' | 'rename';
  source: 'upload' | 'request' | 'restore';
  visibility?: 'private' | 'public';
  submitter?: string | null;
  requestId?: string | null;
  note?: string | null;
}

export interface IngestResult {
  file: FileDTO;
  /** True when the bytes were already in this account and nothing was written. */
  deduped: boolean;
  /** True when this landed as a new version of an existing file. */
  versioned: boolean;
  version: number;
  /** Bytes actually added to the account — zero for a de-duplicated upload. */
  billedBytes: number;
}

// ─────────────────────────── validation ──────────────────────────────────────

export interface UploadIntent {
  filename: string;
  size: number;
  folderId: string | null;
}

/**
 * Everything we can refuse *before* accepting bytes. A resumable session calls
 * this when it is created, so a client learns that its 4 GB file is unwelcome
 * before it starts sending it rather than after.
 */
export async function assertAcceptable(user: UserRow, intent: UploadIntent): Promise<void> {
  const extension = extensionOf(intent.filename);
  if (isBlockedExtension(extension)) {
    throw new AppError('unsupported_media_type', `.${extension} files are not accepted — zip it and try again.`, {
      details: { filename: intent.filename, extension },
    });
  }
  if (intent.size <= 0) {
    throw new AppError('bad_request', `“${intent.filename}” is empty.`);
  }
  if (intent.size > env.MAX_UPLOAD_BYTES) {
    throw new AppError(
      'payload_too_large',
      `“${intent.filename}” exceeds the ${formatBytes(env.MAX_UPLOAD_BYTES)} limit.`,
      { details: { maxBytes: env.MAX_UPLOAD_BYTES } },
    );
  }
  if (intent.folderId) await assertFolderAccessible(user.id, intent.folderId);

  // An advisory check only: the binding one happens under a row lock at commit,
  // because a 40-minute upload can be overtaken by another one.
  const quota = Number(user.quota_bytes);
  const used = Number(user.storage_used_bytes);
  if (used + intent.size > quota) {
    throw new AppError(
      'quota_exceeded',
      `Not enough space: ${formatBytes(intent.size)} needed, ${formatBytes(Math.max(0, quota - used))} free.`,
      { details: { quotaBytes: quota, usedBytes: used, requiredBytes: intent.size } },
    );
  }
}

/** Does this account already hold these exact bytes? */
export async function findOwnedBlob(ownerId: string, checksum: Buffer): Promise<{ id: string; size: number } | null> {
  const row = await db
    .selectFrom('blobs')
    .select(['id', 'size_bytes'])
    .where('owner_id', '=', ownerId)
    .where('checksum_sha256', '=', checksum)
    .executeTakeFirst();
  return row ? { id: row.id, size: Number(row.size_bytes) } : null;
}

// ─────────────────────────── ingest from a spool file ────────────────────────

export async function ingest(
  user: UserRow,
  input: IngestSource,
  opts: IngestOptions,
  req?: Request,
): Promise<IngestResult> {
  const discard = async () => {
    await unlink(input.spoolPath).catch(() => {});
  };

  try {
    await assertAcceptable(user, {
      filename: input.filename,
      size: input.size,
      folderId: opts.folderId,
    });
  } catch (err) {
    await discard();
    throw err;
  }

  const resolved = await resolveType(input.head, input.filename, input.declaredMime);

  /*
   * De-duplication is scoped to the owner on purpose. A shared content index
   * would let anyone test whether a given file already exists on the service by
   * watching for an instant upload — an existence oracle over other people's
   * data, which is not worth the disk it saves.
   */
  const existing = await findOwnedBlob(user.id, input.checksum);
  let writtenKey: string | null = null;

  if (existing) {
    // Nothing to store: the spool file is the only copy to discard.
    await discard();
  } else {
    writtenKey = newStorageKey();
    try {
      await storage.put(writtenKey, {
        path: input.spoolPath,
        size: input.size,
        contentType: resolved.mimeType,
      });
    } catch (err) {
      await discard();
      throw err;
    }
  }

  try {
    const outcome = await commitFile(user, {
      filename: input.filename,
      resolved,
      size: input.size,
      checksum: input.checksum,
      existingBlobId: existing?.id ?? null,
      newStorageKey: writtenKey,
      opts,
    });
    return await finish(user, outcome, { resolved, size: input.size, deduped: Boolean(existing), opts }, req);
  } catch (err) {
    if (writtenKey) {
      await storage.delete(writtenKey).catch((e) => logger.error({ e, writtenKey }, 'failed to roll back blob'));
    }
    await discard();
    throw err;
  }
}

// ─────────────────────────── ingest bytes we already have ────────────────────

/**
 * Register a file whose content is already stored under `blobId`. This is the
 * instant upload: the client offered a hash we recognised, so no bytes crossed
 * the wire at all. The served content type is still resolved from the *stored*
 * bytes rather than the client's claim.
 */
export async function ingestKnownBlob(
  user: UserRow,
  input: { blobId: string; filename: string; declaredMime: string | null },
  opts: IngestOptions,
  req?: Request,
): Promise<IngestResult> {
  const blob = await db
    .selectFrom('blobs')
    .select(['id', 'size_bytes', 'checksum_sha256', 'storage_key'])
    .where('id', '=', input.blobId)
    .where('owner_id', '=', user.id)
    .executeTakeFirst();
  if (!blob) throw new AppError('not_found', 'Those contents are no longer stored.');

  const size = Number(blob.size_bytes);
  await assertAcceptable(user, { filename: input.filename, size, folderId: opts.folderId });

  const head = await readBlobHead(blob.storage_key, size);
  const resolved = await resolveType(head, input.filename, input.declaredMime);

  const outcome = await commitFile(user, {
    filename: input.filename,
    resolved,
    size,
    checksum: blob.checksum_sha256,
    existingBlobId: blob.id,
    newStorageKey: null,
    opts,
  });

  return finish(user, outcome, { resolved, size, deduped: true, opts }, req);
}

async function readBlobHead(storageKey: string, size: number, bytes = 4100): Promise<Buffer> {
  const end = Math.min(size, bytes) - 1;
  if (end < 0) return Buffer.alloc(0);
  const stream = await storage.read(storageKey, { start: 0, end });
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

// ─────────────────────────── the shared commit ───────────────────────────────

interface CommitInput {
  filename: string;
  resolved: ResolvedType;
  size: number;
  checksum: Buffer;
  /** Set when the bytes already have a blob row. */
  existingBlobId: string | null;
  /** Set when an object was just written and needs a blob row. */
  newStorageKey: string | null;
  opts: IngestOptions;
}

interface CommitOutcome {
  row: FileRow;
  versioned: boolean;
  version: number;
  blobId: string;
}

async function commitFile(user: UserRow, input: CommitInput): Promise<CommitOutcome> {
  const extension = extensionOf(input.filename);
  const { opts, resolved } = input;

  return db.transaction().execute(async (trx) => {
    const owner = await trx
      .selectFrom('users')
      .select(['quota_bytes', 'storage_used_bytes'])
      .where('id', '=', user.id)
      .forUpdate()
      .executeTakeFirstOrThrow();

    let blobId = input.existingBlobId;

    if (!blobId) {
      // Only new content consumes quota; a de-duplicated copy adds no bytes.
      const quota = Number(owner.quota_bytes);
      const used = Number(owner.storage_used_bytes);
      if (used + input.size > quota) {
        throw new AppError(
          'quota_exceeded',
          `Not enough space: ${formatBytes(input.size)} needed, ${formatBytes(Math.max(0, quota - used))} free.`,
          { details: { quotaBytes: quota, usedBytes: used, requiredBytes: input.size } },
        );
      }

      try {
        const created = await trx
          .insertInto('blobs')
          .values({
            owner_id: user.id,
            checksum_sha256: input.checksum,
            size_bytes: input.size,
            storage_driver: storage.name,
            storage_key: input.newStorageKey!,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        blobId = created.id;
      } catch (err) {
        // Two uploads of the same new content raced; adopt the winner's blob and
        // let the caller discard the object we wrote.
        if (pgErrorCode(err) !== PG.UNIQUE_VIOLATION) throw err;
        const winner = await trx
          .selectFrom('blobs')
          .select('id')
          .where('owner_id', '=', user.id)
          .where('checksum_sha256', '=', input.checksum)
          .executeTakeFirstOrThrow();
        blobId = winner.id;
      }
    }

    const current = {
      mime_type: resolved.mimeType,
      declared_mime: resolved.declaredMime,
      kind: resolved.kind,
      mime_mismatch: resolved.mismatch,
      size_bytes: input.size,
      checksum_sha256: input.checksum,
      blob_id: blobId,
    };

    const target =
      opts.onConflict === 'version'
        ? await trx
            .selectFrom('files')
            .selectAll()
            .where('owner_id', '=', user.id)
            .where('deleted_at', 'is', null)
            .where((eb) => (opts.folderId ? eb('folder_id', '=', opts.folderId) : eb('folder_id', 'is', null)))
            .where(sql<boolean>`lower(name) = lower(${input.filename})`)
            .forUpdate()
            .executeTakeFirst()
        : undefined;

    if (target) {
      // ── a new revision of a file that is already here ────────────────────
      const version = target.version + 1;
      await trx
        .insertInto('file_versions')
        .values({
          file_id: target.id,
          version,
          blob_id: blobId,
          name: input.filename,
          mime_type: resolved.mimeType,
          declared_mime: resolved.declaredMime,
          mime_mismatch: resolved.mismatch,
          size_bytes: input.size,
          source: opts.source,
          note: opts.note ?? null,
          created_by: user.id,
        })
        .execute();

      const updated = await trx
        .updateTable('files')
        .set({
          ...current,
          extension,
          version,
          version_count: target.version_count + 1,
          // The contents changed, so the old extraction is stale.
          content_text: null,
          content_indexed: false,
        })
        .where('id', '=', target.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      return { row: updated, versioned: true, version, blobId };
    }

    // ── a file that is new to this folder ──────────────────────────────────
    const name = await freeName(trx, user.id, opts.folderId, input.filename);
    let row: FileRow;
    try {
      row = await trx
        .insertInto('files')
        .values({
          ...current,
          owner_id: user.id,
          folder_id: opts.folderId,
          name,
          extension,
          visibility: 'private',
          request_id: opts.requestId ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (err) {
      if (pgErrorCode(err) === PG.UNIQUE_VIOLATION) {
        throw new AppError('conflict', `“${name}” already exists in this folder.`);
      }
      throw err;
    }

    await trx
      .insertInto('file_versions')
      .values({
        file_id: row.id,
        version: 1,
        blob_id: blobId,
        name,
        mime_type: resolved.mimeType,
        declared_mime: resolved.declaredMime,
        mime_mismatch: resolved.mismatch,
        size_bytes: input.size,
        source: opts.source,
        note: opts.note ?? null,
        created_by: user.id,
      })
      .execute();

    return { row, versioned: false, version: 1, blobId };
  });
}

/** Everything after the transaction commits: sharing, audit, indexing. */
async function finish(
  user: UserRow,
  outcome: CommitOutcome,
  context: { resolved: ResolvedType; size: number; deduped: boolean; opts: IngestOptions },
  req?: Request,
): Promise<IngestResult> {
  const { resolved, size, deduped, opts } = context;

  let publicSlug: string | null = null;
  if (opts.visibility === 'public' && !outcome.versioned) {
    const { enablePublicLink } = await import('./service.js');
    publicSlug = (await enablePublicLink(user.id, outcome.row.id)).slug;
  }

  await recordEvent({
    type: outcome.versioned ? 'file.version' : 'file.upload',
    actorId: user.id,
    fileId: outcome.row.id,
    subject: outcome.row.name,
    metadata: {
      sizeBytes: size,
      mimeType: resolved.mimeType,
      declaredMime: resolved.declaredMime,
      sniffed: resolved.sniffedMime,
      mismatch: resolved.mismatch,
      deduped,
      version: outcome.version,
      source: opts.source,
      ...(opts.submitter ? { submitter: opts.submitter } : {}),
    },
    req,
  });

  if (resolved.mismatch) {
    logger.warn(
      { fileId: outcome.row.id, declared: resolved.declaredMime, sniffed: resolved.sniffedMime },
      'upload content type contradicts its extension — will only ever be served as an attachment',
    );
  }

  // Indexing reads the stored bytes back; the upload response should not wait.
  void indexContent(outcome.row.id, outcome.blobId, resolved.mimeType, size);

  return {
    file: toFileDTO(outcome.row, { publicSlug, shareCount: publicSlug ? 1 : 0 }),
    deduped,
    versioned: outcome.versioned,
    version: outcome.version,
    billedBytes: deduped ? 0 : size,
  };
}

/**
 * First unused name in a folder: "report.pdf", then "report (2).pdf", …
 *
 * Resolved with a query rather than by retrying the insert: a failed INSERT
 * aborts the surrounding Postgres transaction, and we are inside one holding the
 * quota lock. The unique index remains the real guarantee.
 */
export async function freeName(
  trx: Transaction<Database>,
  ownerId: string,
  folderId: string | null,
  desired: string,
): Promise<string> {
  const dot = desired.lastIndexOf('.');
  const stem = dot > 0 ? desired.slice(0, dot) : desired;
  const prefix = `${stem.toLowerCase().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;

  const rows = await trx
    .selectFrom('files')
    .select('name')
    .where('owner_id', '=', ownerId)
    .where(folderId ? (eb) => eb('folder_id', '=', folderId) : (eb) => eb('folder_id', 'is', null))
    .where('deleted_at', 'is', null)
    .where(sql<boolean>`lower(name) LIKE ${prefix}`)
    .execute();

  const taken = new Set(rows.map((r) => r.name.toLowerCase()));
  if (!taken.has(desired.toLowerCase())) return desired;

  for (let n = 2; n < 1000; n += 1) {
    const candidate = suffixName(desired, n);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  throw new AppError('conflict', `Too many files named “${desired}” in this folder.`);
}

/**
 * Pull readable text out of the stored bytes and let Postgres index it, so
 * search can find a file by something it says rather than only by its name.
 * A failure here is not worth failing an upload over.
 */
export async function indexContent(
  fileId: string,
  blobId: string,
  mimeType: string,
  size: number,
): Promise<void> {
  try {
    const text = await extractText(blobId, mimeType, size);
    await db
      .updateTable('files')
      .set({ content_text: text, content_indexed: true })
      .where('id', '=', fileId)
      .execute();
  } catch (err) {
    logger.warn({ err, fileId }, 'content extraction failed');
  }
}

/**
 * Re-index files whose contents have not been read yet.
 *
 * Extraction is deliberately fire-and-forget, which means it can be lost — the
 * process restarts, or a revision is restored and invalidates what was there.
 * Rather than pretend that never happens, `content_indexed` records whether the
 * work was done and this pass finishes whatever is outstanding. It runs with
 * maintenance, and the seed calls it so a fresh database is searchable.
 */
export async function reindexPending(limit = 200): Promise<number> {
  const due = await db
    .selectFrom('files')
    .innerJoin('blobs', 'blobs.id', 'files.blob_id')
    .select(['files.id', 'files.blob_id', 'files.mime_type', 'files.size_bytes'])
    .where('files.content_indexed', '=', false)
    .where('files.deleted_at', 'is', null)
    .limit(limit)
    .execute();

  for (const row of due) {
    await indexContent(row.id, row.blob_id, row.mime_type, Number(row.size_bytes));
  }
  return due.length;
}

import type { Request } from 'express';
import { sql, type Kysely, type Transaction } from 'kysely';
import { db, PG, pgErrorCode } from '../../db/client.js';
import type { Database, FileRow, UserRow } from '../../db/types.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { formatBytes } from '../../lib/bytes.js';
import { shareSlug } from '../../lib/crypto.js';
import { extensionOf, suffixName } from '../../lib/filenames.js';
import { isBlockedExtension, resolveType } from '../../lib/mime.js';
import { logger } from '../../lib/logger.js';
import { newStorageKey, storage } from '../../storage/index.js';
import { recordEvent } from '../activity/service.js';
import { assertFolderAccessible } from '../folders/service.js';
import { toFileDTO, toShareDTO, type FileDTO, type ShareDTO } from './dto.js';
import { discardBlobs, type ReceivedBlob } from './upload.js';

// ───────────────────────────── upload ────────────────────────────────────────

export interface PersistOptions {
  folderId: string | null;
  visibility: 'private' | 'public';
}

/**
 * Turn a received blob into a file the user owns.
 *
 * Order of operations matters:
 *   1. reject types we refuse to store at all
 *   2. decide the real content type from magic bytes (never the client's claim)
 *   3. copy the blob into storage
 *   4. take a row lock on the user, re-check the quota, insert the row
 *
 * The quota check happens under `SELECT … FOR UPDATE` so two concurrent uploads
 * cannot both see room for the last megabyte. If the insert fails the blob is
 * removed again, so storage never keeps bytes the database does not know about.
 */
export async function persistUpload(
  user: UserRow,
  blob: ReceivedBlob,
  opts: PersistOptions,
  req: Request,
): Promise<FileDTO> {
  const extension = extensionOf(blob.filename);

  if (isBlockedExtension(extension)) {
    await discardBlobs([blob]);
    throw new AppError('unsupported_media_type', `.${extension} files are not accepted — zip it and try again.`, {
      details: { filename: blob.filename, extension },
    });
  }

  if (blob.size === 0) {
    await discardBlobs([blob]);
    throw new AppError('bad_request', `“${blob.filename}” is empty.`, { details: { filename: blob.filename } });
  }

  if (blob.size > env.MAX_UPLOAD_BYTES) {
    await discardBlobs([blob]);
    throw new AppError('payload_too_large', `“${blob.filename}” exceeds the ${formatBytes(env.MAX_UPLOAD_BYTES)} limit.`);
  }

  const resolved = await resolveType(blob.head, blob.filename, blob.declaredMime);
  const storageKey = newStorageKey();

  if (opts.folderId) await assertFolderAccessible(user.id, opts.folderId);

  await storage.put(storageKey, {
    path: blob.spoolPath,
    size: blob.size,
    contentType: resolved.mimeType,
  });

  try {
    const row = await db.transaction().execute(async (trx) => {
      const owner = await trx
        .selectFrom('users')
        .select(['quota_bytes', 'storage_used_bytes'])
        .where('id', '=', user.id)
        .forUpdate()
        .executeTakeFirstOrThrow();

      const quota = Number(owner.quota_bytes);
      const used = Number(owner.storage_used_bytes);
      if (used + blob.size > quota) {
        throw new AppError(
          'quota_exceeded',
          `Not enough space: ${formatBytes(blob.size)} needed, ${formatBytes(Math.max(0, quota - used))} free.`,
          { details: { quotaBytes: quota, usedBytes: used, requiredBytes: blob.size } },
        );
      }

      // Sibling names are unique per folder, so behave like a file manager and
      // append a counter. The name is resolved with a query rather than by
      // retrying the insert: a failed INSERT aborts the surrounding transaction
      // in Postgres, and we are holding the quota lock inside one.
      const name = await freeName(trx, user.id, opts.folderId, blob.filename);

      try {
        return await trx
          .insertInto('files')
          .values({
            owner_id: user.id,
            folder_id: opts.folderId,
            name,
            extension,
            mime_type: resolved.mimeType,
            declared_mime: resolved.declaredMime,
            kind: resolved.kind,
            mime_mismatch: resolved.mismatch,
            size_bytes: blob.size,
            checksum_sha256: blob.checksum,
            storage_driver: storage.name,
            storage_key: storageKey,
            visibility: 'private',
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (err) {
        if (pgErrorCode(err) === PG.UNIQUE_VIOLATION) {
          throw new AppError('conflict', `“${name}” already exists in this folder.`);
        }
        throw err;
      }
    });

    let publicSlug: string | null = null;
    if (opts.visibility === 'public') {
      publicSlug = (await enablePublicLink(user.id, row.id)).slug;
    }

    await recordEvent({
      type: 'file.upload',
      actorId: user.id,
      fileId: row.id,
      subject: row.name,
      metadata: {
        sizeBytes: blob.size,
        mimeType: resolved.mimeType,
        declaredMime: resolved.declaredMime,
        sniffed: resolved.sniffedMime,
        mismatch: resolved.mismatch,
      },
      req,
    });

    if (resolved.mismatch) {
      logger.warn(
        { fileId: row.id, declared: resolved.declaredMime, sniffed: resolved.sniffedMime },
        'upload content type contradicts its extension — will only ever be served as an attachment',
      );
    }

    return toFileDTO(row, { publicSlug, shareCount: publicSlug ? 1 : 0 });
  } catch (err) {
    // The row never landed: take the orphan blob back out of storage.
    await storage.delete(storageKey).catch((e) => logger.error({ e, storageKey }, 'failed to roll back blob'));
    await discardBlobs([blob]);
    throw err;
  }
}


/**
 * First unused name in a folder: "report.pdf", then "report (2).pdf", …
 *
 * Only names sharing the stem are fetched, and the caller already holds the
 * user's row lock, so two uploads by the same account cannot pick the same
 * answer. The unique index remains the real guarantee.
 */
async function freeName(
  trx: Kysely<Database> | Transaction<Database>,
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

// ───────────────────────────── listing ───────────────────────────────────────

export type FileScope = 'folder' | 'all' | 'trash' | 'starred' | 'shared' | 'recent';
export type FileSort = 'name' | 'size' | 'created' | 'updated';

export interface ListQuery {
  scope: FileScope;
  folderId?: string | null;
  q?: string | undefined;
  kind?: string | undefined;
  sort: FileSort;
  dir: 'asc' | 'desc';
  limit: number;
  cursor?: string | undefined;
}

const SORT_COLUMN: Record<FileSort, string> = {
  name: 'lower(files.name)',
  size: 'files.size_bytes',
  created: 'files.created_at',
  updated: 'files.updated_at',
};

interface Cursor {
  v: string | number;
  id: string;
}

const encodeCursor = (c: Cursor): string => Buffer.from(JSON.stringify(c)).toString('base64url');

function decodeCursor(raw: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if ((typeof parsed.v !== 'string' && typeof parsed.v !== 'number') || typeof parsed.id !== 'string') {
      throw new Error('shape');
    }
    return parsed;
  } catch {
    throw new AppError('bad_request', 'That pagination cursor is not valid.');
  }
}

export async function listFiles(
  ownerId: string,
  query: ListQuery,
): Promise<{ items: FileDTO[]; nextCursor: string | null; total: number | null }> {
  const search = query.q?.trim();

  let base = db
    .selectFrom('files')
    .where('files.owner_id', '=', ownerId);

  if (query.scope === 'trash') {
    base = base.where('files.deleted_at', 'is not', null);
  } else {
    base = base.where('files.deleted_at', 'is', null);
  }

  if (query.scope === 'starred') base = base.where('files.starred', '=', true);
  if (query.scope === 'shared') {
    base = base.where((eb) =>
      eb.or([
        eb('files.visibility', '=', 'public'),
        eb.exists(
          eb
            .selectFrom('share_links')
            .select('share_links.id')
            .whereRef('share_links.file_id', '=', 'files.id')
            .where('share_links.revoked_at', 'is', null),
        ),
      ]),
    );
  }
  // Searching and the flat scopes intentionally ignore folder boundaries —
  // people search their whole drive, not the folder they happen to be in.
  if (query.scope === 'folder' && !search) {
    base = query.folderId
      ? base.where('files.folder_id', '=', query.folderId)
      : base.where('files.folder_id', 'is', null);
  }
  if (search) {
    const pattern = `%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    base = base.where(sql<boolean>`lower(files.name) LIKE lower(${pattern})`);
  }
  if (query.kind) {
    const kinds = query.kind.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 12);
    if (kinds.length) base = base.where('files.kind', 'in', kinds);
  }

  const totalRow = query.cursor
    ? null
    : await base.select(sql<string>`count(*)`.as('n')).executeTakeFirst();

  const column = SORT_COLUMN[query.sort];
  const direction = query.scope === 'recent' ? 'desc' : query.dir;
  const comparator = direction === 'asc' ? '>' : '<';

  let rows = base
    .selectAll('files')
    .select((eb) => [
      eb
        .selectFrom('share_links')
        .select('share_links.slug')
        .whereRef('share_links.file_id', '=', 'files.id')
        .where('share_links.kind', '=', 'toggle')
        .where('share_links.revoked_at', 'is', null)
        .limit(1)
        .as('public_slug'),
      eb
        .selectFrom('share_links')
        .select(sql<string>`count(*)`.as('c'))
        .whereRef('share_links.file_id', '=', 'files.id')
        .where('share_links.revoked_at', 'is', null)
        .as('share_count'),
    ])
    .orderBy(sql.raw(`${column} ${direction}`))
    // id breaks ties so keyset pagination is stable
    .orderBy(`files.id`, direction)
    .limit(query.limit + 1);

  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    rows = rows.where(
      sql<boolean>`(${sql.raw(column)}, files.id) ${sql.raw(comparator)} (${cursor.v}, ${cursor.id}::uuid)`,
    );
  }

  const found = await rows.execute();
  const page = found.slice(0, query.limit);
  const last = page[page.length - 1];

  const cursorValue = (row: typeof last): string | number => {
    if (!row) return '';
    switch (query.sort) {
      case 'name':
        return row.name.toLowerCase();
      case 'size':
        return Number(row.size_bytes);
      case 'created':
        return new Date(row.created_at).toISOString();
      default:
        return new Date(row.updated_at).toISOString();
    }
  };

  return {
    items: page.map((row) =>
      toFileDTO(row as FileRow, {
        publicSlug: (row as { public_slug?: string | null }).public_slug ?? null,
        shareCount: Number((row as { share_count?: string }).share_count ?? 0),
      }),
    ),
    nextCursor: found.length > query.limit && last ? encodeCursor({ v: cursorValue(last), id: last.id }) : null,
    total: totalRow ? Number(totalRow.n) : null,
  };
}

// ───────────────────────────── single file ───────────────────────────────────

/**
 * Load a file *scoped to its owner*. Every read and write in this module goes
 * through here, so an id belonging to another account is a 404 — the only safe
 * answer to "does this file exist?".
 */
async function ownedFile(ownerId: string, id: string, opts: { includeTrashed?: boolean } = {}): Promise<FileRow> {
  let q = db.selectFrom('files').selectAll().where('id', '=', id).where('owner_id', '=', ownerId);
  if (!opts.includeTrashed) q = q.where('deleted_at', 'is', null);
  const row = await q.executeTakeFirst();
  if (!row) throw new AppError('not_found', 'File not found.');
  return row;
}

export async function getFile(ownerId: string, id: string): Promise<{ file: FileDTO; shares: ShareDTO[] }> {
  const row = await ownedFile(ownerId, id, { includeTrashed: true });
  const shares = await db
    .selectFrom('share_links')
    .selectAll()
    .where('file_id', '=', id)
    .where('revoked_at', 'is', null)
    .orderBy('created_at', 'desc')
    .execute();
  const toggle = shares.find((s) => s.kind === 'toggle');
  return {
    file: toFileDTO(row, { publicSlug: toggle?.slug ?? null, shareCount: shares.length }),
    shares: shares.map(toShareDTO),
  };
}

export async function renameFile(ownerId: string, id: string, rawName: string, req: Request): Promise<FileDTO> {
  const current = await ownedFile(ownerId, id);
  const { sanitizeFilename } = await import('../../lib/filenames.js');
  const name = sanitizeFilename(rawName, current.name);

  // Renaming must not become a way to smuggle in an executable extension.
  const extension = extensionOf(name);
  if (isBlockedExtension(extension)) {
    throw new AppError('unsupported_media_type', `.${extension} is not an allowed extension.`);
  }

  try {
    const row = await db
      .updateTable('files')
      .set({ name, extension })
      .where('id', '=', id)
      .where('owner_id', '=', ownerId)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirstOrThrow();
    await recordEvent({
      type: 'file.rename',
      actorId: ownerId,
      fileId: id,
      subject: name,
      metadata: { from: current.name, to: name },
      req,
    });
    return toFileDTO(row);
  } catch (err) {
    if (pgErrorCode(err) === PG.UNIQUE_VIOLATION) {
      throw new AppError('conflict', `“${name}” already exists in this folder.`, {
        fields: { name: ['Name already in use here.'] },
      });
    }
    throw err;
  }
}

export async function moveFile(ownerId: string, id: string, folderId: string | null, req: Request): Promise<FileDTO> {
  await ownedFile(ownerId, id);
  if (folderId) await assertFolderAccessible(ownerId, folderId);

  try {
    const row = await db
      .updateTable('files')
      .set({ folder_id: folderId })
      .where('id', '=', id)
      .where('owner_id', '=', ownerId)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirstOrThrow();
    await recordEvent({ type: 'file.move', actorId: ownerId, fileId: id, subject: row.name, req });
    return toFileDTO(row);
  } catch (err) {
    if (pgErrorCode(err) === PG.UNIQUE_VIOLATION) {
      throw new AppError('conflict', 'A file with that name already exists in the destination folder.');
    }
    throw err;
  }
}

export async function setStarred(ownerId: string, id: string, starred: boolean): Promise<FileDTO> {
  await ownedFile(ownerId, id);
  const row = await db
    .updateTable('files')
    .set({ starred })
    .where('id', '=', id)
    .where('owner_id', '=', ownerId)
    .returningAll()
    .executeTakeFirstOrThrow();
  return toFileDTO(row);
}

// ───────────────────────────── public toggle ────────────────────────────────

/** Create (or reuse) the single 'toggle' link that the public switch controls. */
export async function enablePublicLink(ownerId: string, fileId: string): Promise<{ slug: string }> {
  const existing = await db
    .selectFrom('share_links')
    .select(['slug'])
    .where('file_id', '=', fileId)
    .where('kind', '=', 'toggle')
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  if (existing) return { slug: existing.slug };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = shareSlug();
    try {
      const row = await db
        .insertInto('share_links')
        .values({ file_id: fileId, owner_id: ownerId, slug, kind: 'toggle' })
        .returning('slug')
        .executeTakeFirstOrThrow();
      return { slug: row.slug };
    } catch (err) {
      if (pgErrorCode(err) === PG.UNIQUE_VIOLATION) continue; // slug collision
      throw err;
    }
  }
  throw new AppError('internal_error', 'Could not allocate a share link. Please try again.');
}

export async function setVisibility(
  ownerId: string,
  id: string,
  visibility: 'private' | 'public',
  req: Request,
): Promise<{ file: FileDTO; shares: ShareDTO[] }> {
  const current = await ownedFile(ownerId, id);

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('files')
      .set({ visibility })
      .where('id', '=', id)
      .where('owner_id', '=', ownerId)
      .execute();

    if (visibility === 'private') {
      // Going private revokes *every* link, including custom ones: the switch
      // has to mean "nobody outside this account can reach it".
      await trx
        .updateTable('share_links')
        .set({ revoked_at: new Date() })
        .where('file_id', '=', id)
        .where('revoked_at', 'is', null)
        .execute();
    }
  });

  if (visibility === 'public') await enablePublicLink(ownerId, id);

  await recordEvent({
    type: 'file.visibility',
    actorId: ownerId,
    fileId: id,
    subject: current.name,
    metadata: { from: current.visibility, to: visibility },
    req,
  });

  return getFile(ownerId, id);
}

// ───────────────────────────── trash lifecycle ──────────────────────────────

export async function trashFiles(ownerId: string, ids: string[], req: Request): Promise<number> {
  const now = new Date();
  const purgeAfter = new Date(now.getTime() + env.TRASH_RETENTION_DAYS * 86_400_000);

  const rows = await db
    .updateTable('files')
    .set({ deleted_at: now, purge_after: purgeAfter, starred: false })
    .where('owner_id', '=', ownerId)
    .where('id', 'in', ids)
    .where('deleted_at', 'is', null)
    .returning(['id', 'name'])
    .execute();

  if (rows.length) {
    // Trashed files must stop being reachable by anyone holding a link.
    await db
      .updateTable('share_links')
      .set({ revoked_at: now })
      .where('owner_id', '=', ownerId)
      .where('file_id', 'in', rows.map((r) => r.id))
      .where('revoked_at', 'is', null)
      .execute();
    await db
      .updateTable('files')
      .set({ visibility: 'private' })
      .where('owner_id', '=', ownerId)
      .where('id', 'in', rows.map((r) => r.id))
      .execute();
  }

  for (const row of rows) {
    await recordEvent({ type: 'file.trash', actorId: ownerId, fileId: row.id, subject: row.name, req });
  }
  return rows.length;
}

export async function restoreFiles(ownerId: string, ids: string[], req: Request): Promise<number> {
  const targets = await db
    .selectFrom('files')
    .select(['id', 'name', 'folder_id'])
    .where('owner_id', '=', ownerId)
    .where('id', 'in', ids)
    .where('deleted_at', 'is not', null)
    .execute();

  let restored = 0;
  for (const target of targets) {
    // A file whose folder is still in the trash comes back to the root.
    let folderId = target.folder_id;
    if (folderId) {
      const parent = await db
        .selectFrom('folders')
        .select('id')
        .where('id', '=', folderId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!parent) folderId = null;
    }

    try {
      await db
        .updateTable('files')
        .set({ deleted_at: null, purge_after: null, folder_id: folderId })
        .where('id', '=', target.id)
        .where('owner_id', '=', ownerId)
        .execute();
      restored += 1;
      await recordEvent({ type: 'file.restore', actorId: ownerId, fileId: target.id, subject: target.name, req });
    } catch (err) {
      if (pgErrorCode(err) === PG.UNIQUE_VIOLATION) {
        // Something took the name while this was in the trash — restore beside
        // it under a numbered name instead of failing.
        for (let attempt = 2; attempt < 20; attempt += 1) {
          try {
            await db
              .updateTable('files')
              .set({
                deleted_at: null,
                purge_after: null,
                folder_id: folderId,
                name: suffixName(target.name, attempt),
              })
              .where('id', '=', target.id)
              .execute();
            restored += 1;
            break;
          } catch (inner) {
            if (pgErrorCode(inner) !== PG.UNIQUE_VIOLATION) throw inner;
          }
        }
      } else {
        throw err;
      }
    }
  }
  return restored;
}

/** Hard delete: row first, then the blob. Frees quota. */
export async function purgeFiles(ownerId: string, ids: string[], req: Request): Promise<number> {
  const rows = await db
    .deleteFrom('files')
    .where('owner_id', '=', ownerId)
    .where('id', 'in', ids)
    .where('deleted_at', 'is not', null)
    .returning(['id', 'name', 'storage_key'])
    .execute();

  for (const row of rows) {
    await recordEvent({ type: 'file.purge', actorId: ownerId, subject: row.name, req });
  }

  await Promise.allSettled(
    rows.map((row) =>
      storage.delete(row.storage_key).catch((err) => {
        // The row is gone; a stranded blob is reclaimed by the sweeper.
        logger.error({ err, storageKey: row.storage_key }, 'blob delete failed after purge');
      }),
    ),
  );
  return rows.length;
}

export async function emptyTrash(ownerId: string, req: Request): Promise<number> {
  const ids = await db
    .selectFrom('files')
    .select('id')
    .where('owner_id', '=', ownerId)
    .where('deleted_at', 'is not', null)
    .execute();
  if (!ids.length) return 0;
  const purged = await purgeFiles(ownerId, ids.map((r) => r.id), req);
  await db.deleteFrom('folders').where('owner_id', '=', ownerId).where('deleted_at', 'is not', null).execute();
  return purged;
}

// ───────────────────────────── download ─────────────────────────────────────

export interface DownloadTarget {
  id: string;
  name: string;
  mimeType: string;
  mismatch: boolean;
  sizeBytes: number;
  storageKey: string;
  checksum: string;
}

export async function resolveOwnDownload(ownerId: string, id: string): Promise<DownloadTarget> {
  const row = await ownedFile(ownerId, id, { includeTrashed: true });
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    mismatch: row.mime_mismatch,
    sizeBytes: Number(row.size_bytes),
    storageKey: row.storage_key,
    checksum: Buffer.from(row.checksum_sha256).toString('hex'),
  };
}

export async function registerDownload(fileId: string): Promise<void> {
  await db
    .updateTable('files')
    .set((eb) => ({ download_count: eb('download_count', '+', 1), last_accessed_at: new Date() }))
    .where('id', '=', fileId)
    .execute();
}

// ───────────────────────────── stats ────────────────────────────────────────

export interface StorageStats {
  quotaBytes: number;
  usedBytes: number;
  trashBytes: number;
  fileCount: number;
  folderCount: number;
  publicCount: number;
  strata: Array<{ kind: string; bytes: number; count: number }>;
}

/**
 * Powers the "core sample" meter in the UI: how the account's bytes are
 * distributed across file families, largest layer first.
 */
export async function storageStats(user: UserRow): Promise<StorageStats> {
  const [strata, trash, folders, publics] = await Promise.all([
    db
      .selectFrom('files')
      .select(['kind', sql<string>`sum(size_bytes)`.as('bytes'), sql<string>`count(*)`.as('count')])
      .where('owner_id', '=', user.id)
      .where('deleted_at', 'is', null)
      .groupBy('kind')
      .orderBy(sql`sum(size_bytes)`, 'desc')
      .execute(),
    db
      .selectFrom('files')
      .select([sql<string>`coalesce(sum(size_bytes),0)`.as('bytes'), sql<string>`count(*)`.as('count')])
      .where('owner_id', '=', user.id)
      .where('deleted_at', 'is not', null)
      .executeTakeFirst(),
    db
      .selectFrom('folders')
      .select(sql<string>`count(*)`.as('count'))
      .where('owner_id', '=', user.id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst(),
    db
      .selectFrom('files')
      .select(sql<string>`count(*)`.as('count'))
      .where('owner_id', '=', user.id)
      .where('deleted_at', 'is', null)
      .where('visibility', '=', 'public')
      .executeTakeFirst(),
  ]);

  return {
    quotaBytes: Number(user.quota_bytes),
    usedBytes: Number(user.storage_used_bytes),
    trashBytes: Number(trash?.bytes ?? 0),
    fileCount: strata.reduce((n, s) => n + Number(s.count), 0),
    folderCount: Number(folders?.count ?? 0),
    publicCount: Number(publics?.count ?? 0),
    strata: strata.map((s) => ({ kind: s.kind, bytes: Number(s.bytes), count: Number(s.count) })),
  };
}

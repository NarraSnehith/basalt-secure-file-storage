import type { Request } from 'express';
import { sql } from 'kysely';
import { db, PG, pgErrorCode } from '../../db/client.js';
import type { FileRow, UserRow } from '../../db/types.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { shareSlug } from '../../lib/crypto.js';
import { extensionOf, sanitizeFilename, suffixName } from '../../lib/filenames.js';
import { isBlockedExtension } from '../../lib/mime.js';
import { logger } from '../../lib/logger.js';
import { storage } from '../../storage/index.js';
import { recordEvent } from '../activity/service.js';
import { assertFolderAccessible } from '../folders/service.js';
import {
  denied,
  loadFolderAccess,
  mayTouchFile,
  type FileAction,
  type FolderAccess,
} from '../collaborators/access.js';
import { toFileDTO, toShareDTO, type FileDTO, type ShareDTO } from './dto.js';

// ───────────────────────────── listing ───────────────────────────────────────

export type FileScope = 'folder' | 'all' | 'trash' | 'starred' | 'shared' | 'recent' | 'incoming';
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
  user: UserRow,
  query: ListQuery,
): Promise<{ items: FileDTO[]; nextCursor: string | null; total: number | null }> {
  const search = query.q?.trim();
  const ownerId = user.id;

  /*
   * Which files this listing is allowed to see.
   *
   * Every scope but two is "my drive", filtered by owner. The exceptions are a
   * folder shared with me — where the folder itself is the authority, not
   * ownership — and `incoming`, which gathers everything from every folder
   * anyone has shared with me.
   */
  const access = query.scope === 'folder' || query.scope === 'incoming'
    ? await loadFolderAccess(user)
    : new Map<string, never>();

  const sharedFolder =
    query.scope === 'folder' && query.folderId && access.has(query.folderId) ? query.folderId : null;
  const incomingFolders = query.scope === 'incoming' ? [...access.keys()] : [];

  if (query.scope === 'incoming' && incomingFolders.length === 0) {
    return { items: [], nextCursor: null, total: 0 };
  }

  let base = db.selectFrom('files');

  if (sharedFolder) {
    // Authorised by the grant on the folder, so the owner filter would be wrong.
    base = base.where('files.folder_id', '=', sharedFolder);
  } else if (incomingFolders.length > 0) {
    base = base.where('files.folder_id', 'in', incomingFolders);
  } else {
    base = base.where('files.owner_id', '=', ownerId);
  }

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
  // people search their whole drive, not the folder they happen to be in. A
  // shared folder is the exception: its boundary *is* the permission, so search
  // inside it stays inside it.
  if (query.scope === 'folder' && !sharedFolder && !search) {
    base = query.folderId
      ? base.where('files.folder_id', '=', query.folderId)
      : base.where('files.folder_id', 'is', null);
  }
  if (search) {
    // Two ways to match, because they fail differently: full-text finds words
    // inside a document but not fragments, and a trigram scan finds "forecas"
    // in a filename but knows nothing about contents. Users expect both.
    const pattern = `%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    base = base.where(
      sql<boolean>`(files.search_vector @@ websearch_to_tsquery('english', ${search})
                    OR lower(files.name) LIKE lower(${pattern}))`,
    );
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
 * Load a file *scoped to its owner*. Used by the operations that only an owner
 * may perform, so an id belonging to another account is a 404 — the only safe
 * answer to "does this file exist?".
 */
async function ownedFile(ownerId: string, id: string, opts: { includeTrashed?: boolean } = {}): Promise<FileRow> {
  let q = db.selectFrom('files').selectAll().where('id', '=', id).where('owner_id', '=', ownerId);
  if (!opts.includeTrashed) q = q.where('deleted_at', 'is', null);
  const row = await q.executeTakeFirst();
  if (!row) throw new AppError('not_found', 'File not found.');
  return row;
}

/**
 * Load a file the caller is allowed to take this action on — theirs, or one in a
 * folder shared with them at a sufficient role.
 *
 * The permission decision itself lives in `mayTouchFile`, so the rule is stated
 * once rather than re-derived at each call site. A refusal is a 404, identical to
 * a file that does not exist.
 */
async function fileForAction(
  user: UserRow,
  id: string,
  action: FileAction,
  opts: { includeTrashed?: boolean; access?: FolderAccess } = {},
): Promise<FileRow> {
  let q = db.selectFrom('files').selectAll().where('id', '=', id);
  if (!opts.includeTrashed) q = q.where('deleted_at', 'is', null);
  const row = await q.executeTakeFirst();
  if (!row) throw denied();

  if (row.owner_id === user.id) return row;

  const access = opts.access ?? (await loadFolderAccess(user));
  const allowed = mayTouchFile(
    user,
    { ownerId: row.owner_id, folderId: row.folder_id, createdBy: row.created_by },
    action,
    access,
  );
  if (!allowed) throw denied();
  return row;
}

export async function getFile(user: UserRow, id: string): Promise<{ file: FileDTO; shares: ShareDTO[] }> {
  const row = await fileForAction(user, id, 'read', { includeTrashed: true });
  // Only the owner sees the links: a collaborator has no business knowing which
  // of the owner's files are exposed publicly, or with what conditions.
  const shares =
    row.owner_id === user.id
      ? await db
          .selectFrom('share_links')
          .selectAll()
          .where('file_id', '=', id)
          .where('revoked_at', 'is', null)
          .orderBy('created_at', 'desc')
          .execute()
      : [];
  const toggle = shares.find((s) => s.kind === 'toggle');
  return {
    file: toFileDTO(row, { publicSlug: toggle?.slug ?? null, shareCount: shares.length }),
    shares: shares.map(toShareDTO),
  };
}

export async function renameFile(user: UserRow, id: string, rawName: string, req: Request): Promise<FileDTO> {
  const current = await fileForAction(user, id, 'write');
  const ownerId = current.owner_id;
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

export async function moveFile(user: UserRow, id: string, folderId: string | null, req: Request): Promise<FileDTO> {
  const current = await fileForAction(user, id, 'write');
  const ownerId = current.owner_id;
  // The destination has to belong to the same account: moving a file out of a
  // shared folder and into your own drive would be a way to take it.
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
  owner: UserRow,
  id: string,
  visibility: 'private' | 'public',
  req: Request,
): Promise<{ file: FileDTO; shares: ShareDTO[] }> {
  // Publishing is an owner's decision alone — see mayTouchFile('publish').
  const ownerId = owner.id;
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

  return getFile(owner, id);
}

// ───────────────────────────── trash lifecycle ──────────────────────────────

/**
 * Move files to the trash — the *owner's* trash, even when a collaborator did
 * it, because that is whose drive the file lives in and whose quota it still
 * occupies. Each id is authorised individually, so a mixed selection cannot
 * smuggle one through.
 */
export async function trashFiles(user: UserRow, ids: string[], req: Request): Promise<number> {
  const now = new Date();
  const purgeAfter = new Date(now.getTime() + env.TRASH_RETENTION_DAYS * 86_400_000);

  const access = await loadFolderAccess(user);
  const permitted: string[] = [];
  for (const id of ids) {
    try {
      const row = await fileForAction(user, id, 'write', { access });
      permitted.push(row.id);
    } catch {
      // Silently skipped: reporting which ids were refused would leak whether
      // they exist.
    }
  }
  if (permitted.length === 0) return 0;

  const rows = await db
    .updateTable('files')
    .set({ deleted_at: now, purge_after: purgeAfter, starred: false })
    .where('id', 'in', permitted)
    .where('deleted_at', 'is', null)
    .returning(['id', 'name', 'owner_id'])
    .execute();

  if (rows.length) {
    // Trashed files must stop being reachable by anyone holding a link.
    await db
      .updateTable('share_links')
      .set({ revoked_at: now })
      .where('file_id', 'in', rows.map((r) => r.id))
      .where('revoked_at', 'is', null)
      .execute();
    await db
      .updateTable('files')
      .set({ visibility: 'private' })
      .where('id', 'in', rows.map((r) => r.id))
      .execute();
  }

  for (const row of rows) {
    await recordEvent({ type: 'file.trash', actorId: user.id, fileId: row.id, subject: row.name, req });
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

/**
 * Hard delete.
 *
 * Deleting the file cascades to its versions, which drops each blob's reference
 * count; the ones that reach zero release their quota immediately (see the
 * accounting trigger) and their objects are removed here. A blob still held by
 * another file — the whole point of de-duplication — is left alone.
 */
export async function purgeFiles(ownerId: string, ids: string[], req: Request): Promise<number> {
  const rows = await db
    .deleteFrom('files')
    .where('owner_id', '=', ownerId)
    .where('id', 'in', ids)
    .where('deleted_at', 'is not', null)
    .returning(['id', 'name'])
    .execute();

  for (const row of rows) {
    await recordEvent({ type: 'file.purge', actorId: ownerId, subject: row.name, req });
  }

  await releaseUnreferencedBlobs(ownerId);
  return rows.length;
}

/**
 * Delete the objects behind blobs nothing points at any more. Called after a
 * purge for immediacy; the maintenance pass repeats it to catch anything a
 * crash left behind.
 */
export async function releaseUnreferencedBlobs(ownerId?: string): Promise<number> {
  let query = db.selectFrom('blobs').select(['id', 'storage_key']).where('ref_count', '=', 0).limit(500);
  if (ownerId) query = query.where('owner_id', '=', ownerId);
  const orphans = await query.execute();
  if (orphans.length === 0) return 0;

  const removed: string[] = [];
  await Promise.all(
    orphans.map(async (blob) => {
      try {
        await storage.delete(blob.storage_key);
        removed.push(blob.id);
      } catch (err) {
        // Leave the row: the object still exists and must not be forgotten.
        logger.error({ err, storageKey: blob.storage_key }, 'could not delete unreferenced blob');
      }
    }),
  );

  if (removed.length) {
    await db.deleteFrom('blobs').where('id', 'in', removed).where('ref_count', '=', 0).execute();
  }
  return removed.length;
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

/**
 * Where the bytes are, for a file the caller owns.
 *
 * `version` addresses a specific revision; without it the current one is
 * served. Either way the storage key comes from the blob, so a de-duplicated
 * file and its twin resolve to the same object.
 */
export async function resolveOwnDownload(
  user: UserRow,
  id: string,
  version?: number,
): Promise<DownloadTarget> {
  const row = await fileForAction(user, id, 'read', { includeTrashed: true });

  if (version !== undefined && version !== row.version) {
    const revision = await db
      .selectFrom('file_versions')
      .innerJoin('blobs', 'blobs.id', 'file_versions.blob_id')
      .select([
        'file_versions.name',
        'file_versions.mime_type',
        'file_versions.mime_mismatch',
        'file_versions.size_bytes',
        'blobs.storage_key',
        'blobs.checksum_sha256',
      ])
      .where('file_versions.file_id', '=', id)
      .where('file_versions.version', '=', version)
      .executeTakeFirst();
    if (!revision) throw new AppError('not_found', 'That version does not exist.');
    return {
      id: row.id,
      name: revision.name,
      mimeType: revision.mime_type,
      mismatch: revision.mime_mismatch,
      sizeBytes: Number(revision.size_bytes),
      storageKey: revision.storage_key,
      checksum: Buffer.from(revision.checksum_sha256).toString('hex'),
    };
  }

  const blob = await db
    .selectFrom('blobs')
    .select(['storage_key'])
    .where('id', '=', row.blob_id)
    .executeTakeFirstOrThrow();

  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    mismatch: row.mime_mismatch,
    sizeBytes: Number(row.size_bytes),
    storageKey: blob.storage_key,
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
  /** Bytes held by revisions that are no longer current. */
  versionBytes: number;
  /** Bytes this account would have paid for without content addressing. */
  dedupSavedBytes: number;
  /** Blobs nothing points at any more, awaiting the sweeper. */
  unreferencedBytes: number;
}

/**
 * Powers the "core sample" meter in the UI: how the account's bytes are
 * distributed across file families, largest layer first.
 */
export async function storageStats(user: UserRow): Promise<StorageStats> {
  const [strata, counts, trash, folders, publics, versionOverhead, savings] = await Promise.all([
    /*
     * Composition of the bytes actually on disk.
     *
     * Grouping by SUM(files.size_bytes) would double-count a de-duplicated
     * copy and make the legend add up to more than the account uses, so each
     * blob is counted once and attributed to the kind of the oldest file
     * pointing at it.
     */
    db
      .selectFrom(
        db
          .selectFrom('blobs')
          .innerJoin('files', 'files.blob_id', 'blobs.id')
          .select(({ fn }) => [
            'blobs.id as blob_id',
            'blobs.size_bytes as size_bytes',
            fn
              .agg<string>('min', [sql`files.kind`])
              .over((ob) => ob.partitionBy('blobs.id'))
              .as('kind'),
          ])
          .distinctOn('blobs.id')
          .where('blobs.owner_id', '=', user.id)
          .where('blobs.ref_count', '>', 0)
          .where('files.deleted_at', 'is', null)
          .as('live'),
      )
      .select(['kind', sql<string>`sum(size_bytes)`.as('bytes'), sql<string>`count(*)`.as('count')])
      .groupBy('kind')
      .orderBy(sql`sum(size_bytes)`, 'desc')
      .execute(),

    db
      .selectFrom('files')
      .select(sql<string>`count(*)`.as('count'))
      .where('owner_id', '=', user.id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst(),

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

    // Superseded revisions: blobs held by a version that is no longer current.
    db
      .selectFrom('file_versions')
      .innerJoin('files', 'files.id', 'file_versions.file_id')
      .innerJoin('blobs', 'blobs.id', 'file_versions.blob_id')
      .select([sql<string>`coalesce(sum(distinct blobs.size_bytes), 0)`.as('bytes')])
      .where('files.owner_id', '=', user.id)
      .whereRef('file_versions.blob_id', '<>', 'files.blob_id')
      .executeTakeFirst(),

    // What the same content would have cost stored once per reference.
    db
      .selectFrom('blobs')
      .select([
        sql<string>`coalesce(sum((ref_count - 1) * size_bytes) filter (where ref_count > 1), 0)`.as('saved'),
        sql<string>`coalesce(sum(size_bytes) filter (where ref_count = 0), 0)`.as('unreferenced'),
      ])
      .where('owner_id', '=', user.id)
      .executeTakeFirst(),
  ]);

  return {
    quotaBytes: Number(user.quota_bytes),
    usedBytes: Number(user.storage_used_bytes),
    trashBytes: Number(trash?.bytes ?? 0),
    fileCount: Number(counts?.count ?? 0),
    folderCount: Number(folders?.count ?? 0),
    publicCount: Number(publics?.count ?? 0),
    strata: strata.map((s) => ({ kind: s.kind, bytes: Number(s.bytes), count: Number(s.count) })),
    versionBytes: Number(versionOverhead?.bytes ?? 0),
    dedupSavedBytes: Number(savings?.saved ?? 0),
    unreferencedBytes: Number(savings?.unreferenced ?? 0),
  };
}


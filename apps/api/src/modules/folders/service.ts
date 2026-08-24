import { db, PG, pgErrorCode, sql } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { sanitizeFilename, suffixName } from '../../lib/filenames.js';

export interface FolderDTO {
  id: string;
  name: string;
  parentId: string | null;
  fileCount: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

const ROOT = null;

const toDTO = (row: {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  file_count?: string | number | null;
  size_bytes?: string | number | null;
}): FolderDTO => ({
  id: row.id,
  name: row.name,
  parentId: row.parent_id,
  fileCount: Number(row.file_count ?? 0),
  sizeBytes: Number(row.size_bytes ?? 0),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

/** Every folder the user owns, with direct file counts — powers the sidebar. */
export async function listFolders(ownerId: string): Promise<FolderDTO[]> {
  const rows = await db
    .selectFrom('folders')
    .leftJoin('files', (join) =>
      join.onRef('files.folder_id', '=', 'folders.id').on('files.deleted_at', 'is', null),
    )
    .select([
      'folders.id',
      'folders.name',
      'folders.parent_id',
      'folders.created_at',
      'folders.updated_at',
      sql<string>`count(files.id)`.as('file_count'),
      sql<string>`coalesce(sum(files.size_bytes), 0)`.as('size_bytes'),
    ])
    .where('folders.owner_id', '=', ownerId)
    .where('folders.deleted_at', 'is', null)
    .groupBy(['folders.id', 'folders.name', 'folders.parent_id', 'folders.created_at', 'folders.updated_at'])
    .orderBy('folders.name', 'asc')
    .execute();

  return rows.map(toDTO);
}

/**
 * Folder access for reads.
 *
 * Writes still require ownership (see `assertOwnedFolder`), but a collaborator
 * needs to be able to resolve the folder they were given, and its subfolders,
 * to navigate at all.
 */
export async function assertFolderReadable(
  user: { id: string; email: string },
  folderId: string,
): Promise<void> {
  const row = await db
    .selectFrom('folders')
    .select(['id', 'owner_id'])
    .where('id', '=', folderId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw new AppError('not_found', 'Folder not found.');
  if (row.owner_id === user.id) return;

  const { loadFolderAccess } = await import('../collaborators/access.js');
  const access = await loadFolderAccess(user);
  if (!access.has(folderId)) throw new AppError('not_found', 'Folder not found.');
}

async function assertOwnedFolder(ownerId: string, folderId: string): Promise<void> {
  const row = await db
    .selectFrom('folders')
    .select('id')
    .where('id', '=', folderId)
    .where('owner_id', '=', ownerId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  // 404 rather than 403: an id that belongs to someone else must be
  // indistinguishable from one that does not exist.
  if (!row) throw new AppError('not_found', 'Folder not found.');
}

export const assertFolderAccessible = assertOwnedFolder;

export async function createFolder(
  ownerId: string,
  input: { name: string; parentId?: string | null },
): Promise<FolderDTO> {
  const parentId = input.parentId ?? ROOT;
  if (parentId) await assertOwnedFolder(ownerId, parentId);

  const cleanName = sanitizeFilename(input.name, 'New folder');

  // Sibling names are unique; rather than bouncing the user we do what a file
  // manager does and append a counter.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const name = attempt === 0 ? cleanName : suffixName(cleanName, attempt + 1);
    try {
      const row = await db
        .insertInto('folders')
        .values({ owner_id: ownerId, parent_id: parentId, name })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toDTO(row);
    } catch (err) {
      if (pgErrorCode(err) === PG.UNIQUE_VIOLATION) continue;
      throw err;
    }
  }
  throw new AppError('conflict', 'Too many folders with that name here.');
}

export async function renameFolder(ownerId: string, id: string, rawName: string): Promise<FolderDTO> {
  await assertOwnedFolder(ownerId, id);
  const name = sanitizeFilename(rawName, 'Untitled folder');
  try {
    const row = await db
      .updateTable('folders')
      .set({ name })
      .where('id', '=', id)
      .where('owner_id', '=', ownerId)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toDTO(row);
  } catch (err) {
    if (pgErrorCode(err) === PG.UNIQUE_VIOLATION) {
      throw new AppError('conflict', `“${name}” already exists here.`, { fields: { name: ['Name already in use.'] } });
    }
    throw err;
  }
}

/** Ids of a folder and everything beneath it (one query, depth-limited). */
async function subtreeIds(ownerId: string, rootId: string): Promise<string[]> {
  const { rows } = await sql<{ id: string }>`
    WITH RECURSIVE subtree(id, depth) AS (
      SELECT id, 0 FROM folders WHERE id = ${rootId} AND owner_id = ${ownerId}
      UNION ALL
      SELECT f.id, s.depth + 1
        FROM folders f JOIN subtree s ON f.parent_id = s.id
       WHERE f.owner_id = ${ownerId} AND s.depth < 64
    )
    SELECT id FROM subtree
  `.execute(db);
  return rows.map((r) => r.id);
}

export async function moveFolder(
  ownerId: string,
  id: string,
  parentId: string | null,
): Promise<FolderDTO> {
  await assertOwnedFolder(ownerId, id);
  if (parentId) {
    await assertOwnedFolder(ownerId, parentId);
    if (parentId === id) throw new AppError('bad_request', 'A folder cannot contain itself.');
    // Moving a folder into its own descendant would detach the subtree from the
    // root and create an unreachable cycle.
    const descendants = await subtreeIds(ownerId, id);
    if (descendants.includes(parentId)) {
      throw new AppError('bad_request', 'You cannot move a folder into one of its own subfolders.');
    }
  }

  try {
    const row = await db
      .updateTable('folders')
      .set({ parent_id: parentId })
      .where('id', '=', id)
      .where('owner_id', '=', ownerId)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toDTO(row);
  } catch (err) {
    if (pgErrorCode(err) === PG.UNIQUE_VIOLATION) {
      throw new AppError('conflict', 'A folder with that name already exists in the destination.');
    }
    throw err;
  }
}

/** Soft-delete a folder, its subfolders and every file inside them. */
export async function trashFolder(ownerId: string, id: string, retentionDays: number): Promise<{ folders: number; files: number }> {
  await assertOwnedFolder(ownerId, id);
  const ids = await subtreeIds(ownerId, id);
  const now = new Date();
  const purgeAfter = new Date(now.getTime() + retentionDays * 86_400_000);

  return db.transaction().execute(async (trx) => {
    const files = await trx
      .updateTable('files')
      .set({ deleted_at: now, purge_after: purgeAfter })
      .where('owner_id', '=', ownerId)
      .where('folder_id', 'in', ids)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    const folders = await trx
      .updateTable('folders')
      .set({ deleted_at: now })
      .where('owner_id', '=', ownerId)
      .where('id', 'in', ids)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    return {
      folders: Number(folders.numUpdatedRows ?? 0),
      files: Number(files.numUpdatedRows ?? 0),
    };
  });
}

export async function restoreFolder(ownerId: string, id: string): Promise<void> {
  const row = await db
    .selectFrom('folders')
    .select(['id', 'parent_id'])
    .where('id', '=', id)
    .where('owner_id', '=', ownerId)
    .where('deleted_at', 'is not', null)
    .executeTakeFirst();
  if (!row) throw new AppError('not_found', 'Folder not found in trash.');

  // If the parent is still trashed the folder would restore into limbo, so it
  // comes back at the root instead — same behaviour as every file manager.
  let parentId = row.parent_id;
  if (parentId) {
    const parent = await db
      .selectFrom('folders')
      .select('id')
      .where('id', '=', parentId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!parent) parentId = null;
  }

  await db
    .updateTable('folders')
    .set({ deleted_at: null, parent_id: parentId })
    .where('id', '=', id)
    .where('owner_id', '=', ownerId)
    .execute();
}

/** Root → … → folder, for the breadcrumb trail. */
export async function breadcrumbs(ownerId: string, folderId: string): Promise<Array<{ id: string; name: string }>> {
  const { rows } = await sql<{ id: string; name: string; depth: number }>`
    WITH RECURSIVE trail(id, name, parent_id, depth) AS (
      SELECT id, name, parent_id, 0
        FROM folders WHERE id = ${folderId} AND owner_id = ${ownerId} AND deleted_at IS NULL
      UNION ALL
      SELECT f.id, f.name, f.parent_id, t.depth + 1
        FROM folders f JOIN trail t ON f.id = t.parent_id
       WHERE f.owner_id = ${ownerId} AND f.deleted_at IS NULL AND t.depth < 64
    )
    SELECT id, name, depth FROM trail ORDER BY depth DESC
  `.execute(db);
  if (rows.length === 0) throw new AppError('not_found', 'Folder not found.');
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

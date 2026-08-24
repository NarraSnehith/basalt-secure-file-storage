import { sql } from 'kysely';
import { db } from '../../db/client.js';
import type { CollaboratorRole, UserRow } from '../../db/types.js';
import { AppError } from '../../lib/errors.js';

/**
 * Who may do what in someone else's folder.
 *
 * A share link is a bearer token: possession is permission, and revoking one
 * revokes it for everyone it was ever sent to. That is right for "here is a
 * file" and wrong for "we work on this together". A collaborator is an identity
 * instead — the grant attaches to an account, so revoking one person leaves
 * everybody else alone, and every action is attributable to a name.
 *
 * Three roles, chosen so the boundaries are guessable:
 *
 *   viewer       read and download
 *   contributor  …and add files, and manage the ones they added
 *   editor       …and rename, move or bin anything in the folder
 *
 * Owners keep what only an owner should have: managing collaborators, and making
 * a file public to the world.
 */

export const ROLE_RANK: Record<CollaboratorRole, number> = {
  viewer: 1,
  contributor: 2,
  editor: 3,
};

export const atLeast = (held: CollaboratorRole, needed: CollaboratorRole): boolean =>
  ROLE_RANK[held] >= ROLE_RANK[needed];

/** Folder id → the strongest role this user holds on it. */
export type FolderAccess = Map<string, CollaboratorRole>;

/**
 * Every folder shared with this user, including everything nested beneath it.
 *
 * A grant on a folder covers its subtree — that is what people mean by sharing
 * a folder — so the descendants are expanded here with one recursive walk
 * rather than a query per lookup. Depth is capped so a cycle (which the folder
 * constraints already prevent) could never turn into an unbounded walk.
 */
export async function loadFolderAccess(user: Pick<UserRow, 'id' | 'email'>): Promise<FolderAccess> {
  const { rows } = await sql<{ folder_id: string; role: CollaboratorRole }>`
    WITH RECURSIVE granted AS (
      SELECT fc.folder_id, fc.role
        FROM folder_collaborators fc
        JOIN folders f ON f.id = fc.folder_id
       WHERE fc.revoked_at IS NULL
         AND f.deleted_at IS NULL
         AND (fc.user_id = ${user.id} OR (fc.user_id IS NULL AND fc.email = ${user.email}))
    ),
    subtree(folder_id, role, depth) AS (
      SELECT folder_id, role, 0 FROM granted
      UNION ALL
      SELECT f.id, s.role, s.depth + 1
        FROM folders f
        JOIN subtree s ON f.parent_id = s.folder_id
       WHERE f.deleted_at IS NULL AND s.depth < 64
    )
    SELECT folder_id, role FROM subtree
  `.execute(db);

  const access: FolderAccess = new Map();
  for (const row of rows) {
    // Overlapping grants (a folder and its parent) resolve to the stronger one.
    const held = access.get(row.folder_id);
    if (!held || ROLE_RANK[row.role] > ROLE_RANK[held]) access.set(row.folder_id, row.role);
  }
  return access;
}

/** The folders shared with this user that were granted directly, for listing. */
export interface SharedFolderSummary {
  id: string;
  name: string;
  role: CollaboratorRole;
  ownerName: string;
  ownerEmail: string;
  fileCount: number;
  sizeBytes: number;
  sharedAt: string;
}

export async function listSharedWithMe(
  user: Pick<UserRow, 'id' | 'email'>,
): Promise<SharedFolderSummary[]> {
  const rows = await db
    .selectFrom('folder_collaborators')
    .innerJoin('folders', 'folders.id', 'folder_collaborators.folder_id')
    .innerJoin('users', 'users.id', 'folders.owner_id')
    .leftJoin('files', (join) =>
      join.onRef('files.folder_id', '=', 'folders.id').on('files.deleted_at', 'is', null),
    )
    .select([
      'folders.id',
      'folders.name',
      'folder_collaborators.role',
      'folder_collaborators.created_at as shared_at',
      'users.display_name as owner_name',
      'users.email as owner_email',
      sql<string>`count(files.id)`.as('file_count'),
      sql<string>`coalesce(sum(files.size_bytes), 0)`.as('size_bytes'),
    ])
    .where('folder_collaborators.revoked_at', 'is', null)
    .where('folders.deleted_at', 'is', null)
    .where((eb) =>
      eb.or([
        eb('folder_collaborators.user_id', '=', user.id),
        eb.and([
          eb('folder_collaborators.user_id', 'is', null),
          eb('folder_collaborators.email', '=', user.email),
        ]),
      ]),
    )
    .groupBy([
      'folders.id',
      'folders.name',
      'folder_collaborators.role',
      'folder_collaborators.created_at',
      'users.display_name',
      'users.email',
    ])
    .orderBy('folder_collaborators.created_at', 'desc')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    fileCount: Number(row.file_count),
    sizeBytes: Number(row.size_bytes),
    sharedAt: new Date(row.shared_at).toISOString(),
  }));
}

// ─────────────────────────── decisions ───────────────────────────────────────

export interface FileSubject {
  ownerId: string;
  folderId: string | null;
  createdBy: string | null;
}

export type FileAction = 'read' | 'write' | 'publish';

/**
 * May this user take this action on this file?
 *
 * Structured as one function with an explicit table rather than scattered
 * `if (row.owner_id !== me)` checks, because a permission model that lives in
 * fifteen call sites is a permission model with a hole in it.
 */
export function mayTouchFile(
  user: Pick<UserRow, 'id'>,
  file: FileSubject,
  action: FileAction,
  access: FolderAccess,
): boolean {
  if (file.ownerId === user.id) return true;

  // Only an owner may expose a file to the public internet, whatever their role.
  if (action === 'publish') return false;

  const role = file.folderId ? access.get(file.folderId) : undefined;
  if (!role) return false;

  if (action === 'read') return true;

  // write: an editor may change anything here; a contributor only what they added.
  if (role === 'editor') return true;
  if (role === 'contributor') return file.createdBy === user.id;
  return false;
}

/** May this user put a new file into this folder? */
export function mayWriteToFolder(folderOwnerId: string, user: Pick<UserRow, 'id'>, folderId: string, access: FolderAccess): boolean {
  if (folderOwnerId === user.id) return true;
  const role = access.get(folderId);
  return role !== undefined && atLeast(role, 'contributor');
}

/**
 * The 404 that hides existence.
 *
 * A file the caller may not touch answers exactly as one that does not exist —
 * otherwise the error code itself confirms that some id is real.
 */
export const denied = (what = 'File'): AppError => new AppError('not_found', `${what} not found.`);

// ─────────────────────────── upload destinations ─────────────────────────────

export interface WriteTarget {
  folderId: string | null;
  /**
   * Whose quota pays and whose drive the file lives in — the folder's owner.
   * A contributor adds to someone else's folder; the bytes are not theirs.
   */
  quotaHolder: UserRow;
  /** Who actually uploaded it, recorded on the file and in the audit trail. */
  actorId: string;
}

/**
 * Work out where an upload is allowed to land, and who pays for it.
 *
 * Keeping ownership with the folder is what makes a shared folder behave like a
 * folder: everything in it belongs to the same account, deleting the folder takes
 * its contents, and one quota is answerable for it. `created_by` preserves who
 * contributed what.
 */
export async function resolveUploadTarget(
  user: UserRow,
  folderId: string | null,
): Promise<WriteTarget> {
  if (!folderId) return { folderId: null, quotaHolder: user, actorId: user.id };

  const folder = await db
    .selectFrom('folders')
    .select(['id', 'owner_id'])
    .where('id', '=', folderId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!folder) throw denied('Folder');

  if (folder.owner_id === user.id) {
    return { folderId, quotaHolder: user, actorId: user.id };
  }

  const access = await loadFolderAccess(user);
  const role = access.get(folderId);
  if (!role || !atLeast(role, 'contributor')) throw denied('Folder');

  const owner = await db
    .selectFrom('users')
    .selectAll()
    .where('id', '=', folder.owner_id)
    .executeTakeFirst();
  if (!owner) throw denied('Folder');

  return { folderId, quotaHolder: owner, actorId: user.id };
}

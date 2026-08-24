import type { Request } from 'express';
import { db, PG, pgErrorCode } from '../../db/client.js';
import type { CollaboratorRole, UserRow } from '../../db/types.js';
import { AppError } from '../../lib/errors.js';
import { recordEvent } from '../activity/service.js';

/**
 * Managing the people a folder is shared with.
 *
 * Only the folder's owner can do any of this. An editor can reorganise the
 * contents; letting them widen the guest list as well would make "who can see
 * this?" unanswerable by the one person responsible for it.
 */

export interface CollaboratorDTO {
  id: string;
  email: string;
  role: CollaboratorRole;
  /** False while the invitation is waiting for an account with that address. */
  active: boolean;
  displayName: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

async function ownedFolder(ownerId: string, folderId: string): Promise<{ id: string; name: string }> {
  const row = await db
    .selectFrom('folders')
    .select(['id', 'name'])
    .where('id', '=', folderId)
    .where('owner_id', '=', ownerId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw new AppError('not_found', 'Folder not found.');
  return row;
}

export async function listCollaborators(ownerId: string, folderId: string): Promise<CollaboratorDTO[]> {
  await ownedFolder(ownerId, folderId);

  const rows = await db
    .selectFrom('folder_collaborators')
    .leftJoin('users', 'users.id', 'folder_collaborators.user_id')
    .select([
      'folder_collaborators.id',
      'folder_collaborators.email',
      'folder_collaborators.role',
      'folder_collaborators.user_id',
      'folder_collaborators.created_at',
      'folder_collaborators.last_seen_at',
      'users.display_name',
    ])
    .where('folder_collaborators.folder_id', '=', folderId)
    .where('folder_collaborators.revoked_at', 'is', null)
    .orderBy('folder_collaborators.created_at', 'asc')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    active: row.user_id !== null,
    displayName: row.display_name,
    createdAt: new Date(row.created_at).toISOString(),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
  }));
}

/**
 * Invite someone, or change the role of someone already invited.
 *
 * Re-inviting an existing collaborator updates their role rather than failing:
 * "share again with a different role" is what people mean by the second invite,
 * and refusing it would just make them revoke and re-add.
 */
export async function inviteCollaborator(
  owner: UserRow,
  folderId: string,
  input: { email: string; role: CollaboratorRole },
  req?: Request,
): Promise<CollaboratorDTO> {
  const folder = await ownedFolder(owner.id, folderId);

  if (input.email.toLowerCase() === owner.email.toLowerCase()) {
    throw new AppError('bad_request', 'That is your own account — you already have full access.', {
      fields: { email: ['You cannot invite yourself.'] },
    });
  }

  // Resolve the address to an account if one exists; otherwise the invitation
  // waits, and the database trigger attaches it when they register.
  const existing = await db
    .selectFrom('users')
    .select(['id', 'display_name'])
    .where('email', '=', input.email)
    .executeTakeFirst();

  let row;
  try {
    row = await db
      .insertInto('folder_collaborators')
      .values({
        folder_id: folderId,
        granted_by: owner.id,
        email: input.email,
        user_id: existing?.id ?? null,
        role: input.role,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (err) {
    if (pgErrorCode(err) !== PG.UNIQUE_VIOLATION) throw err;
    row = await db
      .updateTable('folder_collaborators')
      .set({ role: input.role, user_id: existing?.id ?? null })
      .where('folder_id', '=', folderId)
      .where('email', '=', input.email)
      .where('revoked_at', 'is', null)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  await recordEvent({
    type: 'folder.share',
    actorId: owner.id,
    subject: folder.name,
    metadata: { email: input.email, role: input.role, pending: !existing },
    req,
  });

  return {
    id: row.id,
    email: row.email,
    role: row.role,
    active: row.user_id !== null,
    displayName: existing?.display_name ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    lastSeenAt: null,
  };
}

export async function revokeCollaborator(
  ownerId: string,
  folderId: string,
  collaboratorId: string,
  req?: Request,
): Promise<void> {
  const folder = await ownedFolder(ownerId, folderId);

  const row = await db
    .updateTable('folder_collaborators')
    .set({ revoked_at: new Date() })
    .where('id', '=', collaboratorId)
    .where('folder_id', '=', folderId)
    .where('revoked_at', 'is', null)
    .returning(['email'])
    .executeTakeFirst();
  if (!row) throw new AppError('not_found', 'That person does not have access to this folder.');

  await recordEvent({
    type: 'folder.unshare',
    actorId: ownerId,
    subject: folder.name,
    metadata: { email: row.email },
    req,
  });
}

/**
 * Note that a collaborator has looked at a folder.
 *
 * Fire-and-forget: it is a courtesy for the owner's "last seen" column, not
 * something worth adding latency to a listing for.
 */
export function touchCollaborator(userId: string, folderId: string): void {
  void db
    .updateTable('folder_collaborators')
    .set({ last_seen_at: new Date(), accepted_at: new Date() })
    .where('folder_id', '=', folderId)
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute()
    .catch(() => undefined);
}

/** Folders this owner has shared with somebody, for badging the sidebar. */
export async function sharedOutFolderIds(ownerId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('folder_collaborators')
    .innerJoin('folders', 'folders.id', 'folder_collaborators.folder_id')
    .select('folder_collaborators.folder_id')
    .distinct()
    .where('folders.owner_id', '=', ownerId)
    .where('folder_collaborators.revoked_at', 'is', null)
    .execute();
  return rows.map((r) => r.folder_id);
}

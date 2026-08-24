import type { Request } from 'express';
import { db, PG, pgErrorCode } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword, shareSlug, verifyPassword } from '../../lib/crypto.js';
import { recordEvent } from '../activity/service.js';
import { toShareDTO, type ShareDTO } from '../files/dto.js';

export interface CreateShareInput {
  label?: string | null;
  password?: string | null;
  expiresAt?: Date | null;
  maxDownloads?: number | null;
  allowPreview?: boolean;
}

async function assertOwnedFile(ownerId: string, fileId: string): Promise<{ id: string; name: string }> {
  const row = await db
    .selectFrom('files')
    .select(['id', 'name'])
    .where('id', '=', fileId)
    .where('owner_id', '=', ownerId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw new AppError('not_found', 'File not found.');
  return row;
}

export async function listSharesForFile(ownerId: string, fileId: string): Promise<ShareDTO[]> {
  await assertOwnedFile(ownerId, fileId);
  const rows = await db
    .selectFrom('share_links')
    .selectAll()
    .where('file_id', '=', fileId)
    .where('owner_id', '=', ownerId)
    .where('revoked_at', 'is', null)
    .orderBy('created_at', 'desc')
    .execute();
  return rows.map(toShareDTO);
}

export async function listAllShares(ownerId: string) {
  const rows = await db
    .selectFrom('share_links')
    .innerJoin('files', 'files.id', 'share_links.file_id')
    .select([
      'share_links.id', 'share_links.file_id', 'share_links.owner_id', 'share_links.slug',
      'share_links.kind', 'share_links.label', 'share_links.password_hash', 'share_links.expires_at',
      'share_links.max_downloads', 'share_links.download_count', 'share_links.allow_preview',
      'share_links.created_at', 'share_links.updated_at', 'share_links.last_accessed_at',
      'share_links.revoked_at',
      'files.name as file_name', 'files.kind as file_kind', 'files.size_bytes as file_size',
    ])
    .where('share_links.owner_id', '=', ownerId)
    .where('share_links.revoked_at', 'is', null)
    .where('files.deleted_at', 'is', null)
    .orderBy('share_links.created_at', 'desc')
    .execute();

  return rows.map((row) => ({
    ...toShareDTO(row),
    file: {
      id: row.file_id,
      name: row.file_name,
      kind: row.file_kind,
      sizeBytes: Number(row.file_size),
    },
  }));
}

export async function createShare(
  ownerId: string,
  fileId: string,
  input: CreateShareInput,
  req: Request,
): Promise<ShareDTO> {
  const file = await assertOwnedFile(ownerId, fileId);

  const passwordHash = input.password ? await hashPassword(input.password) : null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const row = await db
        .insertInto('share_links')
        .values({
          file_id: fileId,
          owner_id: ownerId,
          slug: shareSlug(),
          kind: 'custom',
          label: input.label ?? null,
          password_hash: passwordHash,
          expires_at: input.expiresAt ?? null,
          max_downloads: input.maxDownloads ?? null,
          allow_preview: input.allowPreview ?? true,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // A file with a live link is public by definition — keep the flag honest
      // so the dashboard badge and the switch agree with reality.
      await db.updateTable('files').set({ visibility: 'public' }).where('id', '=', fileId).execute();

      await recordEvent({
        type: 'share.create',
        actorId: ownerId,
        fileId,
        shareId: row.id,
        subject: file.name,
        metadata: {
          hasPassword: Boolean(passwordHash),
          expiresAt: input.expiresAt?.toISOString() ?? null,
          maxDownloads: input.maxDownloads ?? null,
        },
        req,
      });
      return toShareDTO(row);
    } catch (err) {
      if (pgErrorCode(err) === PG.UNIQUE_VIOLATION) continue;
      throw err;
    }
  }
  throw new AppError('internal_error', 'Could not allocate a share link. Please try again.');
}

export async function updateShare(
  ownerId: string,
  shareId: string,
  patch: {
    label?: string | null;
    password?: string | null;
    expiresAt?: Date | null;
    maxDownloads?: number | null;
    allowPreview?: boolean;
  },
  req: Request,
): Promise<ShareDTO> {
  const existing = await db
    .selectFrom('share_links')
    .select(['id', 'file_id'])
    .where('id', '=', shareId)
    .where('owner_id', '=', ownerId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  if (!existing) throw new AppError('not_found', 'Share link not found.');

  const values: Record<string, unknown> = {};
  if (patch.label !== undefined) values.label = patch.label;
  if (patch.expiresAt !== undefined) values.expires_at = patch.expiresAt;
  if (patch.maxDownloads !== undefined) values.max_downloads = patch.maxDownloads;
  if (patch.allowPreview !== undefined) values.allow_preview = patch.allowPreview;
  if (patch.password !== undefined) {
    values.password_hash = patch.password ? await hashPassword(patch.password) : null;
  }

  if (Object.keys(values).length === 0) {
    const row = await db.selectFrom('share_links').selectAll().where('id', '=', shareId).executeTakeFirstOrThrow();
    return toShareDTO(row);
  }

  const row = await db
    .updateTable('share_links')
    .set(values)
    .where('id', '=', shareId)
    .where('owner_id', '=', ownerId)
    .returningAll()
    .executeTakeFirstOrThrow();

  await recordEvent({
    type: 'share.update',
    actorId: ownerId,
    fileId: existing.file_id,
    shareId,
    metadata: { changed: Object.keys(values) },
    req,
  });
  return toShareDTO(row);
}

export async function revokeShare(ownerId: string, shareId: string, req: Request): Promise<void> {
  const row = await db
    .updateTable('share_links')
    .set({ revoked_at: new Date() })
    .where('id', '=', shareId)
    .where('owner_id', '=', ownerId)
    .where('revoked_at', 'is', null)
    .returning(['id', 'file_id'])
    .executeTakeFirst();
  if (!row) throw new AppError('not_found', 'Share link not found.');

  // No links left => the file is private again.
  const remaining = await db
    .selectFrom('share_links')
    .select('id')
    .where('file_id', '=', row.file_id)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  if (!remaining) {
    await db.updateTable('files').set({ visibility: 'private' }).where('id', '=', row.file_id).execute();
  }

  await recordEvent({ type: 'share.revoke', actorId: ownerId, fileId: row.file_id, shareId, req });
}

// ───────────────────────── public resolution ────────────────────────────────

export interface ResolvedShare {
  shareId: string;
  slug: string;
  fileId: string;
  name: string;
  kind: string;
  mimeType: string;
  mismatch: boolean;
  sizeBytes: number;
  storageKey: string;
  checksum: string;
  ownerName: string;
  requiresPassword: boolean;
  allowPreview: boolean;
  expiresAt: string | null;
  maxDownloads: number | null;
  downloadCount: number;
  createdAt: string;
  passwordHash: string | null;
}

/**
 * Resolve a slug to something servable, enforcing the whole gate in one place:
 * link exists, not revoked, not expired, budget not spent, and the file behind
 * it still exists and is still public. Anything else is a 404 — an attacker
 * guessing slugs learns nothing about which ones were once real.
 */
export async function resolveShare(slug: string): Promise<ResolvedShare> {
  const row = await db
    .selectFrom('share_links')
    .innerJoin('files', 'files.id', 'share_links.file_id')
    .innerJoin('blobs', 'blobs.id', 'files.blob_id')
    .innerJoin('users', 'users.id', 'share_links.owner_id')
    .select([
      'share_links.id as share_id', 'share_links.slug', 'share_links.password_hash',
      'share_links.expires_at', 'share_links.max_downloads', 'share_links.download_count',
      'share_links.allow_preview', 'share_links.created_at', 'share_links.revoked_at',
      'files.id as file_id', 'files.name', 'files.kind', 'files.mime_type', 'files.mime_mismatch',
      'files.size_bytes', 'blobs.storage_key', 'files.checksum_sha256', 'files.deleted_at',
      'files.visibility',
      'users.display_name as owner_name',
    ])
    .where('share_links.slug', '=', slug)
    .executeTakeFirst();

  if (!row || row.revoked_at || row.deleted_at || row.visibility !== 'public') {
    throw new AppError('not_found', 'This link is no longer available.');
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError('share_expired', 'This link has expired.');
  }
  if (row.max_downloads !== null && row.download_count >= row.max_downloads) {
    throw new AppError('share_exhausted', 'This link has reached its download limit.');
  }

  return {
    shareId: row.share_id,
    slug: row.slug,
    fileId: row.file_id,
    name: row.name,
    kind: row.kind,
    mimeType: row.mime_type,
    mismatch: row.mime_mismatch,
    sizeBytes: Number(row.size_bytes),
    storageKey: row.storage_key,
    checksum: Buffer.from(row.checksum_sha256).toString('hex'),
    ownerName: row.owner_name,
    requiresPassword: Boolean(row.password_hash),
    allowPreview: row.allow_preview,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    maxDownloads: row.max_downloads,
    downloadCount: row.download_count,
    createdAt: new Date(row.created_at).toISOString(),
    passwordHash: row.password_hash,
  };
}

export async function checkSharePassword(share: ResolvedShare, password: string): Promise<boolean> {
  if (!share.passwordHash) return true;
  return verifyPassword(share.passwordHash, password);
}

/**
 * Atomically claim one download from the link's budget.
 *
 * The condition lives inside the UPDATE, so two simultaneous requests on a
 * "one download only" link cannot both win.
 */
export async function claimDownload(shareId: string): Promise<boolean> {
  const row = await db
    .updateTable('share_links')
    .set((eb) => ({ download_count: eb('download_count', '+', 1), last_accessed_at: new Date() }))
    .where('id', '=', shareId)
    .where('revoked_at', 'is', null)
    .where((eb) =>
      eb.or([eb('max_downloads', 'is', null), eb(eb.ref('download_count'), '<', eb.ref('max_downloads'))]),
    )
    .returning('download_count')
    .executeTakeFirst();
  return Boolean(row);
}

export async function touchShare(shareId: string): Promise<void> {
  await db.updateTable('share_links').set({ last_accessed_at: new Date() }).where('id', '=', shareId).execute();
}

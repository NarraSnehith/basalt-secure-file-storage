import type { Request } from 'express';
import { sql } from 'kysely';
import { db, PG, pgErrorCode } from '../../db/client.js';
import type { FileRequestRow } from '../../db/types.js';
import { AppError } from '../../lib/errors.js';
import { formatBytes } from '../../lib/bytes.js';
import { hashPassword, shareSlug, verifyPassword } from '../../lib/crypto.js';
import { clientIp, userAgent } from '../../lib/http.js';
import { env } from '../../config/env.js';
import { recordEvent } from '../activity/service.js';
import { assertFolderAccessible } from '../folders/service.js';

/**
 * File requests: a share link pointing the other way.
 *
 * "Please email me those files" is a bad protocol — attachment limits, no
 * integrity check, no idea what arrived. Google Drive's answer requires the
 * *sender* to have an account, which is exactly the wrong constraint. A request
 * here is a link into one folder, with the limits the owner chooses, that anyone
 * can use once without signing up for anything.
 *
 * The uploads land in the owner's drive and consume the owner's quota, so the
 * limits are not a nicety — they are the only thing between a public link and a
 * filled disk. Hence a file cap, a byte cap, an expiry, and an optional password.
 */

export interface RequestDTO {
  id: string;
  slug: string;
  url: string;
  title: string;
  message: string | null;
  folderId: string;
  folderName: string | null;
  hasPassword: boolean;
  maxFiles: number | null;
  maxBytes: number | null;
  expiresAt: string | null;
  submissionCount: number;
  receivedBytes: number;
  remainingFiles: number | null;
  remainingBytes: number | null;
  expired: boolean;
  full: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export const requestUrl = (slug: string): string => `${env.WEB_ORIGIN}/u/${slug}`;

function toDTO(row: FileRequestRow & { folder_name?: string | null }): RequestDTO {
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  const maxBytes = row.max_bytes === null ? null : Number(row.max_bytes);
  const received = Number(row.received_bytes);
  const expired = Boolean(expiresAt && expiresAt.getTime() <= Date.now());
  const full =
    (row.max_files !== null && row.submission_count >= row.max_files) ||
    (maxBytes !== null && received >= maxBytes);

  return {
    id: row.id,
    slug: row.slug,
    url: requestUrl(row.slug),
    title: row.title,
    message: row.message,
    folderId: row.folder_id,
    folderName: row.folder_name ?? null,
    hasPassword: Boolean(row.password_hash),
    maxFiles: row.max_files,
    maxBytes,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    submissionCount: row.submission_count,
    receivedBytes: received,
    remainingFiles: row.max_files === null ? null : Math.max(0, row.max_files - row.submission_count),
    remainingBytes: maxBytes === null ? null : Math.max(0, maxBytes - received),
    expired,
    full,
    createdAt: new Date(row.created_at).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
  };
}

// ─────────────────────────── owner side ──────────────────────────────────────

export interface CreateRequestInput {
  folderId: string;
  title: string;
  message?: string | null;
  password?: string | null;
  maxFiles?: number | null;
  maxBytes?: number | null;
  expiresAt?: Date | null;
}

export async function createRequest(
  ownerId: string,
  input: CreateRequestInput,
  req?: Request,
): Promise<RequestDTO> {
  await assertFolderAccessible(ownerId, input.folderId);
  const passwordHash = input.password ? await hashPassword(input.password) : null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const row = await db
        .insertInto('file_requests')
        .values({
          owner_id: ownerId,
          folder_id: input.folderId,
          slug: shareSlug(),
          title: input.title,
          message: input.message ?? null,
          password_hash: passwordHash,
          max_files: input.maxFiles ?? null,
          max_bytes: input.maxBytes ?? null,
          expires_at: input.expiresAt ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await recordEvent({
        type: 'request.create',
        actorId: ownerId,
        subject: input.title,
        metadata: { slug: row.slug, maxFiles: input.maxFiles ?? null, maxBytes: input.maxBytes ?? null },
        req,
      });
      return toDTO(row);
    } catch (err) {
      if (pgErrorCode(err) === PG.UNIQUE_VIOLATION) continue; // slug collision
      throw err;
    }
  }
  throw new AppError('internal_error', 'Could not allocate a request link. Please try again.');
}

export async function listRequests(ownerId: string): Promise<RequestDTO[]> {
  const rows = await db
    .selectFrom('file_requests')
    .leftJoin('folders', 'folders.id', 'file_requests.folder_id')
    .selectAll('file_requests')
    .select('folders.name as folder_name')
    .where('file_requests.owner_id', '=', ownerId)
    .where('file_requests.revoked_at', 'is', null)
    .orderBy('file_requests.created_at', 'desc')
    .execute();
  return rows.map(toDTO);
}

export interface SubmissionDTO {
  id: string;
  fileId: string | null;
  filename: string;
  sizeBytes: number;
  submitter: string | null;
  ip: string | null;
  createdAt: string;
  /** False once the owner has deleted what was sent. */
  present: boolean;
}

/** The inbox for one request: who sent what, and when. */
export async function listSubmissions(ownerId: string, requestId: string): Promise<SubmissionDTO[]> {
  const owned = await db
    .selectFrom('file_requests')
    .select('id')
    .where('id', '=', requestId)
    .where('owner_id', '=', ownerId)
    .executeTakeFirst();
  if (!owned) throw new AppError('not_found', 'Request not found.');

  const rows = await db
    .selectFrom('request_submissions')
    .leftJoin('files', 'files.id', 'request_submissions.file_id')
    .select([
      'request_submissions.id',
      'request_submissions.file_id',
      'request_submissions.filename',
      'request_submissions.size_bytes',
      'request_submissions.submitter',
      'request_submissions.ip',
      'request_submissions.created_at',
      'files.deleted_at as file_deleted_at',
    ])
    .where('request_submissions.request_id', '=', requestId)
    .orderBy('request_submissions.created_at', 'desc')
    .limit(200)
    .execute();

  return rows.map((row) => ({
    id: row.id,
    fileId: row.file_id,
    filename: row.filename,
    sizeBytes: Number(row.size_bytes),
    submitter: row.submitter,
    ip: row.ip,
    createdAt: new Date(row.created_at).toISOString(),
    present: Boolean(row.file_id) && !row.file_deleted_at,
  }));
}

export async function updateRequest(
  ownerId: string,
  id: string,
  patch: {
    title?: string;
    message?: string | null;
    password?: string | null;
    maxFiles?: number | null;
    maxBytes?: number | null;
    expiresAt?: Date | null;
  },
  req?: Request,
): Promise<RequestDTO> {
  const values: Record<string, unknown> = {};
  if (patch.title !== undefined) values.title = patch.title;
  if (patch.message !== undefined) values.message = patch.message;
  if (patch.maxFiles !== undefined) values.max_files = patch.maxFiles;
  if (patch.maxBytes !== undefined) values.max_bytes = patch.maxBytes;
  if (patch.expiresAt !== undefined) values.expires_at = patch.expiresAt;
  if (patch.password !== undefined) {
    values.password_hash = patch.password ? await hashPassword(patch.password) : null;
  }

  const row = await db
    .updateTable('file_requests')
    .set(Object.keys(values).length ? values : { updated_at: new Date() })
    .where('id', '=', id)
    .where('owner_id', '=', ownerId)
    .where('revoked_at', 'is', null)
    .returningAll()
    .executeTakeFirst();
  if (!row) throw new AppError('not_found', 'Request not found.');

  void req;
  return toDTO(row);
}

export async function revokeRequest(ownerId: string, id: string, req?: Request): Promise<void> {
  const row = await db
    .updateTable('file_requests')
    .set({ revoked_at: new Date() })
    .where('id', '=', id)
    .where('owner_id', '=', ownerId)
    .where('revoked_at', 'is', null)
    .returning(['id', 'title'])
    .executeTakeFirst();
  if (!row) throw new AppError('not_found', 'Request not found.');

  await recordEvent({ type: 'request.revoke', actorId: ownerId, subject: row.title, req });
}

// ─────────────────────────── public side ─────────────────────────────────────

export interface ResolvedRequest {
  id: string;
  slug: string;
  ownerId: string;
  folderId: string;
  title: string;
  message: string | null;
  requiresPassword: boolean;
  passwordHash: string | null;
  maxFiles: number | null;
  maxBytes: number | null;
  submissionCount: number;
  receivedBytes: number;
  remainingFiles: number | null;
  remainingBytes: number | null;
  ownerName: string;
  expiresAt: string | null;
}

/**
 * Resolve a slug to something a stranger may upload into.
 *
 * Validity only — revoked, expired, folder gone. Capacity is deliberately *not*
 * checked here: opening a session reserves a slot, so by the time that sender's
 * chunks arrive the link may well look "full", and refusing them would break the
 * very upload it just accepted. Capacity is asserted once, at the point of
 * reservation, by `assertRoomFor`.
 */
export async function resolveRequest(slug: string): Promise<ResolvedRequest> {
  const row = await db
    .selectFrom('file_requests')
    .innerJoin('users', 'users.id', 'file_requests.owner_id')
    .innerJoin('folders', 'folders.id', 'file_requests.folder_id')
    .select([
      'file_requests.id',
      'file_requests.slug',
      'file_requests.owner_id',
      'file_requests.folder_id',
      'file_requests.title',
      'file_requests.message',
      'file_requests.password_hash',
      'file_requests.max_files',
      'file_requests.max_bytes',
      'file_requests.submission_count',
      'file_requests.received_bytes',
      'file_requests.expires_at',
      'file_requests.revoked_at',
      'users.display_name as owner_name',
      'folders.deleted_at as folder_deleted_at',
    ])
    .where('file_requests.slug', '=', slug)
    .executeTakeFirst();

  if (!row || row.revoked_at || row.folder_deleted_at) {
    throw new AppError('not_found', 'This upload link is no longer available.');
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError('share_expired', 'This upload link has expired.');
  }

  const maxBytes = row.max_bytes === null ? null : Number(row.max_bytes);
  const received = Number(row.received_bytes);

  return {
    id: row.id,
    slug: row.slug,
    ownerId: row.owner_id,
    folderId: row.folder_id,
    title: row.title,
    message: row.message,
    requiresPassword: Boolean(row.password_hash),
    passwordHash: row.password_hash,
    maxFiles: row.max_files,
    maxBytes,
    submissionCount: row.submission_count,
    receivedBytes: received,
    remainingFiles: row.max_files === null ? null : Math.max(0, row.max_files - row.submission_count),
    remainingBytes: maxBytes === null ? null : Math.max(0, maxBytes - received),
    ownerName: row.owner_name,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
  };
}

/** Is there room for one more file of this size? Called when a session opens. */
export function assertRoomFor(request: ResolvedRequest, size: number): void {
  if (request.remainingFiles !== null && request.remainingFiles <= 0) {
    throw new AppError('share_exhausted', 'This upload link has reached its file limit.');
  }
  if (request.remainingBytes !== null) {
    if (request.remainingBytes <= 0) {
      throw new AppError('share_exhausted', 'This upload link has reached its size limit.');
    }
    if (size > request.remainingBytes) {
      throw new AppError(
        'share_exhausted',
        `That file is larger than the ${formatBytes(request.remainingBytes)} left on this link.`,
      );
    }
  }
}

export async function checkRequestPassword(request: ResolvedRequest, password: string): Promise<boolean> {
  if (!request.passwordHash) return true;
  return verifyPassword(request.passwordHash, password);
}

/**
 * Reserve room for one more file, atomically.
 *
 * The counters move *before* the bytes are accepted and the condition lives
 * inside the UPDATE, so a link limited to three files cannot be talked into
 * taking four by three simultaneous senders.
 */
export async function reserveSlot(requestId: string, size: number): Promise<void> {
  const row = await db
    .updateTable('file_requests')
    .set((eb) => ({
      submission_count: eb('submission_count', '+', 1),
      received_bytes: sql<string>`received_bytes + ${size}`,
      last_used_at: new Date(),
    }))
    .where('id', '=', requestId)
    .where('revoked_at', 'is', null)
    .where((eb) =>
      eb.and([
        eb.or([eb('max_files', 'is', null), eb(eb.ref('submission_count'), '<', eb.ref('max_files'))]),
        eb.or([eb('max_bytes', 'is', null), sql<boolean>`received_bytes + ${size} <= max_bytes`]),
        eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', new Date())]),
      ]),
    )
    .returning('id')
    .executeTakeFirst();

  if (!row) {
    throw new AppError('share_exhausted', `This upload link cannot accept ${formatBytes(size)} more.`);
  }
}

/** Give the room back when the upload never completes. */
export async function releaseSlot(requestId: string, size: number): Promise<void> {
  await db
    .updateTable('file_requests')
    .set({
      submission_count: sql<number>`greatest(0, submission_count - 1)`,
      received_bytes: sql<string>`greatest(0, received_bytes - ${size})`,
    })
    .where('id', '=', requestId)
    .execute();
}

export async function recordSubmission(
  requestId: string,
  input: { fileId: string; filename: string; sizeBytes: number; submitter: string | null },
  req?: Request,
): Promise<void> {
  await db
    .insertInto('request_submissions')
    .values({
      request_id: requestId,
      file_id: input.fileId,
      filename: input.filename,
      size_bytes: input.sizeBytes,
      submitter: input.submitter,
      ip: req ? clientIp(req) || null : null,
      user_agent: req ? userAgent(req) : null,
    })
    .execute();

  await recordEvent({
    type: 'request.submit',
    fileId: input.fileId,
    subject: input.filename,
    metadata: { requestId, submitter: input.submitter, sizeBytes: input.sizeBytes },
    req,
  });
}

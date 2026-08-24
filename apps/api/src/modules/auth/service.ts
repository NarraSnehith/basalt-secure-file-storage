import type { Request } from 'express';
import { db, PG, pgConstraint, pgErrorCode, sql } from '../../db/client.js';
import type { UserRow } from '../../db/types.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { digestToken, equaliseTiming, hashPassword, randomToken, verifyPassword } from '../../lib/crypto.js';
import { clientIp, userAgent } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import { signAccessToken } from '../../lib/tokens.js';
import { recordEvent } from '../activity/service.js';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  sessionId: string;
  expiresIn: number;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  accent: string;
  quotaBytes: number;
  storageUsedBytes: number;
  createdAt: string;
}

export const toPublicUser = (row: UserRow): PublicUser => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  accent: row.accent,
  quotaBytes: Number(row.quota_bytes),
  storageUsedBytes: Number(row.storage_used_bytes),
  createdAt: new Date(row.created_at).toISOString(),
});

/** Issue a brand-new refresh-token family plus its first access token. */
async function issueTokens(userId: string, req: Request, familyId?: string): Promise<IssuedTokens> {
  const refreshToken = randomToken(32);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000);

  const session = await db
    .insertInto('sessions')
    .values({
      user_id: userId,
      family_id: familyId ?? sql<string>`gen_random_uuid()`,
      token_hash: digestToken(refreshToken),
      user_agent: userAgent(req),
      ip: clientIp(req) || null,
      expires_at: expiresAt,
    })
    .returning(['id', 'family_id'])
    .executeTakeFirstOrThrow();

  return {
    accessToken: await signAccessToken(userId, session.id),
    refreshToken,
    csrfToken: randomToken(24),
    sessionId: session.id,
    expiresIn: env.ACCESS_TOKEN_TTL,
  };
}

export async function register(
  input: { email: string; password: string; displayName: string },
  req: Request,
): Promise<{ user: PublicUser; tokens: IssuedTokens }> {
  const passwordHash = await hashPassword(input.password);

  let row: UserRow;
  try {
    row = await db
      .insertInto('users')
      .values({
        email: input.email,
        password_hash: passwordHash,
        display_name: input.displayName,
        quota_bytes: env.DEFAULT_QUOTA_BYTES,
        accent: pickAccent(input.email),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (err) {
    if (pgErrorCode(err) === PG.UNIQUE_VIOLATION) {
      throw new AppError('conflict', 'An account with that email already exists.', {
        fields: { email: ['That email is already registered.'] },
      });
    }
    throw err;
  }

  const tokens = await issueTokens(row.id, req);
  await recordEvent({ type: 'auth.register', actorId: row.id, subject: row.email, req });
  return { user: toPublicUser(row), tokens };
}

export async function login(
  input: { email: string; password: string },
  req: Request,
): Promise<{ user: PublicUser; tokens: IssuedTokens }> {
  const row = await db.selectFrom('users').selectAll().where('email', '=', input.email).executeTakeFirst();

  // Same failure, same message, same cost, whether or not the account exists.
  if (!row) {
    await equaliseTiming();
    throw new AppError('invalid_credentials', 'Email or password is incorrect.');
  }

  const ok = await verifyPassword(row.password_hash, input.password);
  if (!ok) {
    await recordEvent({ type: 'auth.login_failed', actorId: row.id, subject: row.email, req });
    throw new AppError('invalid_credentials', 'Email or password is incorrect.');
  }

  const tokens = await issueTokens(row.id, req);
  await recordEvent({ type: 'auth.login', actorId: row.id, subject: row.email, req });
  return { user: toPublicUser(row), tokens };
}

/**
 * Rotate a refresh token.
 *
 * Every refresh mints a new token and retires the old one. Presenting a token
 * that was already rotated (or revoked) means it leaked: the entire family is
 * killed, which logs that device chain out everywhere.
 */
export async function rotate(refreshToken: string, req: Request): Promise<{ user: PublicUser; tokens: IssuedTokens }> {
  const hash = digestToken(refreshToken);

  const session = await db
    .selectFrom('sessions')
    .select(['id', 'user_id', 'family_id', 'expires_at', 'revoked_at'])
    .where('token_hash', '=', hash)
    .executeTakeFirst();

  if (!session) throw new AppError('unauthenticated', 'Your session has expired. Please sign in again.');

  if (session.revoked_at) {
    await db
      .updateTable('sessions')
      .set({ revoked_at: new Date(), revoked_reason: 'reuse_detected' })
      .where('family_id', '=', session.family_id)
      .where('revoked_at', 'is', null)
      .execute();
    await recordEvent({ type: 'auth.refresh_reuse', actorId: session.user_id, req });
    logger.warn({ userId: session.user_id, familyId: session.family_id }, 'refresh token reuse — family revoked');
    throw new AppError('unauthenticated', 'Your session was ended for security reasons. Please sign in again.');
  }

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    throw new AppError('unauthenticated', 'Your session has expired. Please sign in again.');
  }

  const user = await db.selectFrom('users').selectAll().where('id', '=', session.user_id).executeTakeFirst();
  if (!user) throw new AppError('unauthenticated', 'Account no longer exists.');

  const tokens = await issueTokens(user.id, req, session.family_id);
  await db
    .updateTable('sessions')
    .set({ revoked_at: new Date(), revoked_reason: 'rotated', replaced_by: tokens.sessionId, last_used_at: new Date() })
    .where('id', '=', session.id)
    .execute();

  return { user: toPublicUser(user), tokens };
}

export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await db
    .updateTable('sessions')
    .set({ revoked_at: new Date(), revoked_reason: reason })
    .where('id', '=', sessionId)
    .where('revoked_at', 'is', null)
    .execute();
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  let q = db
    .updateTable('sessions')
    .set({ revoked_at: new Date(), revoked_reason: 'user_revoked_all' })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null);
  if (exceptSessionId) q = q.where('id', '<>', exceptSessionId);
  const res = await q.executeTakeFirst();
  return Number(res.numUpdatedRows ?? 0);
}

export async function listSessions(userId: string, currentSessionId: string) {
  // A rotated token is not a new device — collapse each family into one row.
  const rows = await db
    .selectFrom('sessions')
    .select(['id', 'family_id', 'user_agent', 'ip', 'created_at', 'last_used_at', 'expires_at'])
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', new Date())
    .orderBy('created_at', 'desc')
    .execute();

  return rows.map((r) => ({
    id: r.id,
    userAgent: r.user_agent,
    ip: r.ip,
    createdAt: new Date(r.created_at).toISOString(),
    lastUsedAt: new Date(r.last_used_at).toISOString(),
    expiresAt: new Date(r.expires_at).toISOString(),
    current: r.id === currentSessionId,
  }));
}

export async function changePassword(
  userId: string,
  currentSessionId: string,
  input: { currentPassword: string; newPassword: string },
  req: Request,
): Promise<void> {
  const user = await db
    .selectFrom('users')
    .select(['id', 'password_hash', 'email'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();

  if (!(await verifyPassword(user.password_hash, input.currentPassword))) {
    throw new AppError('forbidden', 'Your current password is incorrect.', {
      fields: { currentPassword: ['That is not your current password.'] },
    });
  }
  if (await verifyPassword(user.password_hash, input.newPassword)) {
    throw new AppError('validation_failed', 'Choose a password you have not used here before.', {
      fields: { newPassword: ['This is already your password.'] },
    });
  }

  await db
    .updateTable('users')
    .set({ password_hash: await hashPassword(input.newPassword) })
    .where('id', '=', userId)
    .execute();

  // Changing a password logs every *other* device out.
  await revokeAllSessions(userId, currentSessionId);
  await recordEvent({ type: 'auth.password_changed', actorId: userId, subject: user.email, req });
}

export async function updateProfile(
  userId: string,
  input: { displayName?: string; accent?: string },
): Promise<PublicUser> {
  const patch: Record<string, unknown> = {};
  if (input.displayName !== undefined) patch.display_name = input.displayName;
  if (input.accent !== undefined) patch.accent = input.accent;

  if (Object.keys(patch).length === 0) {
    const row = await db.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirstOrThrow();
    return toPublicUser(row);
  }

  const row = await db
    .updateTable('users')
    .set(patch)
    .where('id', '=', userId)
    .returningAll()
    .executeTakeFirstOrThrow();
  return toPublicUser(row);
}

export async function deleteAccount(userId: string, password: string): Promise<string[]> {
  const user = await db
    .selectFrom('users')
    .select(['password_hash'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();

  if (!(await verifyPassword(user.password_hash, password))) {
    throw new AppError('forbidden', 'Password is incorrect.', { fields: { password: ['Incorrect password.'] } });
  }

  // Collect object keys first: the cascade deletes the rows, but object storage
  // has no foreign keys and must be swept explicitly.
  const blobs = await db.selectFrom('blobs').select(['storage_key']).where('owner_id', '=', userId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
  return blobs.map((b) => b.storage_key);
}

const ACCENTS = ['ember', 'basalt', 'moss', 'lapis', 'clay', 'ash'] as const;
function pickAccent(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ACCENTS[h % ACCENTS.length]!;
}

/** Housekeeping: drop refresh tokens that expired more than a week ago. */
export async function pruneSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 86_400_000);
  const res = await db.deleteFrom('sessions').where('expires_at', '<', cutoff).executeTakeFirst();
  return Number(res.numDeletedRows ?? 0);
}

/** Constraint name -> field, for friendlier validation errors. */
export const constraintField = (err: unknown): string | undefined => pgConstraint(err);

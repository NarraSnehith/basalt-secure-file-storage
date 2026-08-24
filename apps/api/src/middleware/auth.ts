import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { db } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { ACCESS_COOKIE, REFRESH_COOKIE, readCookie } from '../modules/auth/cookies.js';

/**
 * Reads the access token from the httpOnly cookie, or from
 * `Authorization: Bearer …` for non-browser clients (CI, CLI, tests).
 */
function extractToken(req: Request): string | undefined {
  const header = req.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  return readCookie(req, ACCESS_COOKIE);
}

/**
 * Resolve the caller.
 *
 * The JWT alone is not enough: it carries a session id, and the session row is
 * checked on every request. That is one indexed lookup in exchange for
 * revocation that takes effect immediately — sign-out, "log out everywhere" and
 * stolen-token detection all become real instead of "real in 15 minutes".
 */
async function resolve(req: Request): Promise<Request['auth'] | null> {
  const token = extractToken(req);
  if (!token) return null;

  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select([
      'sessions.id as session_id',
      'sessions.revoked_at',
      'sessions.expires_at',
      'users.id',
      'users.email',
      'users.password_hash',
      'users.display_name',
      'users.accent',
      'users.quota_bytes',
      'users.storage_used_bytes',
      'users.created_at',
      'users.updated_at',
    ])
    .where('sessions.id', '=', claims.sid)
    .where('sessions.user_id', '=', claims.sub)
    .executeTakeFirst();

  if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) return null;

  return {
    sessionId: row.session_id,
    user: {
      id: row.id,
      email: row.email,
      password_hash: row.password_hash,
      display_name: row.display_name,
      accent: row.accent,
      quota_bytes: row.quota_bytes,
      storage_used_bytes: row.storage_used_bytes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  };
}

export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  resolve(req)
    .then((auth) => {
      if (!auth) {
        // `refreshable` saves a signed-out visitor a pointless refresh round
        // trip, and tells a signed-in client that its 401 is just a stale token.
        next(
          new AppError('unauthenticated', 'You need to sign in to do that.', {
            details: { refreshable: Boolean(readCookie(req, REFRESH_COOKIE)) },
          }),
        );
        return;
      }
      req.auth = auth;
      next();
    })
    .catch(next);
};

/** Attaches auth when present, never rejects — used by public share routes. */
export const optionalAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  resolve(req)
    .then((auth) => {
      if (auth) req.auth = auth;
      next();
    })
    .catch(() => next());
};

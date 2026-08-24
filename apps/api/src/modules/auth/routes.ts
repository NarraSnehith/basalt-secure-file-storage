import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { AppError } from '../../lib/errors.js';
import { noStore, parseBody, parseParams, route } from '../../lib/http.js';
import { storage } from '../../storage/index.js';
import { logger } from '../../lib/logger.js';
import { recordEvent } from '../activity/service.js';
import {
  clearAuthCookies,
  readCookie,
  REFRESH_COOKIE,
  setAccessCookie,
  setCsrfCookie,
  setRefreshCookie,
} from './cookies.js';
import {
  changePasswordSchema,
  deleteAccountSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from './schemas.js';
import {
  changePassword,
  deleteAccount,
  listSessions,
  login,
  register,
  revokeAllSessions,
  revokeSession,
  rotate,
  toPublicUser,
  updateProfile,
  type IssuedTokens,
} from './service.js';

export const authRouter = Router();

function issue(res: Parameters<typeof setAccessCookie>[0], tokens: IssuedTokens): void {
  setAccessCookie(res, tokens.accessToken);
  setRefreshCookie(res, tokens.refreshToken);
  setCsrfCookie(res, tokens.csrfToken);
}

// Credential endpoints are rate limited twice: per IP (a host hammering us) and
// per IP+email (one account under a dictionary attack).
const registerLimit = rateLimit({ name: 'register', windowMs: 60 * 60_000, max: 10 });
const loginLimitByIp = rateLimit({
  name: 'login-ip',
  windowMs: 15 * 60_000,
  max: 30,
  message: 'Too many sign-in attempts from this network. Try again in a few minutes.',
});
const loginLimitByAccount = rateLimit({
  name: 'login-account',
  windowMs: 15 * 60_000,
  max: 8,
  key: (req) => String((req.body as { email?: string } | undefined)?.email ?? '').toLowerCase().slice(0, 254),
  message: 'Too many attempts for this account. Try again in a few minutes.',
});

/**
 * Session bootstrap. The web app calls this once on load: it returns the CSRF
 * token to echo in headers and, if a refresh cookie is present, whether there
 * is a session worth restoring.
 */
authRouter.get(
  '/csrf',
  route(async (req, res) => {
    noStore(res);
    res.json({
      csrfToken: res.locals.csrfToken as string,
      hasSession: Boolean(readCookie(req, REFRESH_COOKIE)),
    });
  }),
);

authRouter.post(
  '/register',
  registerLimit,
  route(async (req, res) => {
    const input = parseBody(registerSchema, req);
    const { user, tokens } = await register(input, req);
    issue(res, tokens);
    noStore(res);
    res.status(201).json({ user, csrfToken: tokens.csrfToken, expiresIn: tokens.expiresIn });
  }),
);

authRouter.post(
  '/login',
  loginLimitByIp,
  loginLimitByAccount,
  route(async (req, res) => {
    const input = parseBody(loginSchema, req);
    const { user, tokens } = await login(input, req);
    issue(res, tokens);
    noStore(res);
    res.json({ user, csrfToken: tokens.csrfToken, expiresIn: tokens.expiresIn });
  }),
);

/**
 * Silent re-authentication. The browser calls this when a 401 comes back, and
 * on a schedule slightly ahead of the access token's expiry.
 */
authRouter.post(
  '/refresh',
  rateLimit({ name: 'refresh', windowMs: 60_000, max: 60 }),
  route(async (req, res) => {
    const token = readCookie(req, REFRESH_COOKIE);
    if (!token) {
      clearAuthCookies(res);
      throw new AppError('unauthenticated', 'No active session.');
    }
    try {
      const { user, tokens } = await rotate(token, req);
      issue(res, tokens);
      noStore(res);
      res.json({ user, csrfToken: tokens.csrfToken, expiresIn: tokens.expiresIn });
    } catch (err) {
      clearAuthCookies(res);
      throw err;
    }
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  route(async (req, res) => {
    await revokeSession(req.auth!.sessionId, 'user_logout');
    await recordEvent({ type: 'auth.logout', actorId: req.auth!.user.id, req });
    clearAuthCookies(res);
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  route(async (req, res) => {
    noStore(res);
    res.json({ user: toPublicUser(req.auth!.user), sessionId: req.auth!.sessionId });
  }),
);

authRouter.patch(
  '/me',
  requireAuth,
  route(async (req, res) => {
    const input = parseBody(updateProfileSchema, req);
    res.json({ user: await updateProfile(req.auth!.user.id, input) });
  }),
);

authRouter.post(
  '/password',
  requireAuth,
  rateLimit({ name: 'password-change', windowMs: 15 * 60_000, max: 10 }),
  route(async (req, res) => {
    const input = parseBody(changePasswordSchema, req);
    await changePassword(req.auth!.user.id, req.auth!.sessionId, input, req);
    res.status(204).end();
  }),
);

authRouter.get(
  '/sessions',
  requireAuth,
  route(async (req, res) => {
    noStore(res);
    res.json({ sessions: await listSessions(req.auth!.user.id, req.auth!.sessionId) });
  }),
);

authRouter.delete(
  '/sessions/:id',
  requireAuth,
  route(async (req, res) => {
    const { id } = parseParams(z.object({ id: z.string().uuid() }), req);
    // Scoped delete: you can only revoke a session that is yours.
    const target = await listSessions(req.auth!.user.id, req.auth!.sessionId);
    if (!target.some((s) => s.id === id)) throw new AppError('not_found', 'Session not found.');
    await revokeSession(id, 'user_revoked');
    await recordEvent({ type: 'auth.session_revoked', actorId: req.auth!.user.id, req });
    if (id === req.auth!.sessionId) clearAuthCookies(res);
    res.status(204).end();
  }),
);

authRouter.delete(
  '/sessions',
  requireAuth,
  route(async (req, res) => {
    const count = await revokeAllSessions(req.auth!.user.id, req.auth!.sessionId);
    await recordEvent({
      type: 'auth.session_revoked',
      actorId: req.auth!.user.id,
      metadata: { revoked: count, scope: 'all_other' },
      req,
    });
    res.json({ revoked: count });
  }),
);

authRouter.post(
  '/delete-account',
  requireAuth,
  rateLimit({ name: 'delete-account', windowMs: 60 * 60_000, max: 5 }),
  route(async (req, res) => {
    const input = parseBody(deleteAccountSchema, req);
    const keys = await deleteAccount(req.auth!.user.id, input.password);
    clearAuthCookies(res);
    res.status(204).end();
    // Blobs are swept after the response: the account is already gone as far as
    // the client is concerned, and a slow object store must not hold it up.
    void Promise.allSettled(keys.map((k) => storage.delete(k))).then((results) => {
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed) logger.error({ failed, total: keys.length }, 'orphaned blobs after account deletion');
    });
  }),
);

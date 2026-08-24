import type { RequestHandler } from 'express';
import { env, isProd } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { randomToken, safeEqual } from '../lib/crypto.js';
import { CSRF_COOKIE, readCookie, setCsrfCookie } from '../modules/auth/cookies.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_HEADER = 'x-csrf-token';

const allowedOrigins = new Set(
  [env.WEB_ORIGIN, isProd ? null : 'http://localhost:3000', isProd ? null : 'http://127.0.0.1:3000'].filter(
    Boolean,
  ) as string[],
);

/**
 * Hands out the double-submit cookie on any safe request, so the very first
 * page load arrives already holding the token it will need to sign in with.
 * The value is high-entropy and tied to nothing — it proves only that the
 * caller can read our cookies, which is exactly what same-origin means.
 */
export const issueCsrfCookie: RequestHandler = (req, res, next) => {
  const existing = readCookie(req, CSRF_COOKIE);
  const token = existing ?? randomToken(24);
  if (!existing && SAFE_METHODS.has(req.method)) setCsrfCookie(res, token);
  res.locals.csrfToken = token;
  next();
};

/**
 * Two independent checks, because cookie-based sessions are otherwise a CSRF
 * invitation:
 *
 *  1. Origin/Referer must be one we know. Blocks the classic cross-site form
 *     POST, which cannot set this header.
 *  2. Double submit — the `basalt_csrf` cookie (readable by our JS, not
 *     httpOnly) must match the `X-CSRF-Token` header. A cross-site attacker can
 *     make the browser *send* our cookies but cannot read them to echo one back.
 *
 * Requests authenticated with a Bearer token and no cookies are exempt: there
 * is no ambient credential for a third-party site to ride on.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const usesBearer = (req.get('authorization') ?? '').toLowerCase().startsWith('bearer ');
  const hasCookies = Object.keys((req.cookies ?? {}) as Record<string, unknown>).length > 0;
  if (usesBearer && !hasCookies) return next();

  const origin = req.get('origin');
  if (origin) {
    if (!allowedOrigins.has(origin)) {
      return next(new AppError('csrf_failed', 'Request blocked: unrecognised origin.'));
    }
  } else {
    const referer = req.get('referer');
    if (referer) {
      try {
        if (!allowedOrigins.has(new URL(referer).origin)) {
          return next(new AppError('csrf_failed', 'Request blocked: unrecognised referer.'));
        }
      } catch {
        return next(new AppError('csrf_failed', 'Request blocked: malformed referer.'));
      }
    }
    // No Origin and no Referer: a same-origin non-browser client. The
    // double-submit check below still has to pass.
  }

  const cookieToken = readCookie(req, CSRF_COOKIE);
  const headerToken = req.get(CSRF_HEADER);

  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    return next(
      new AppError('csrf_failed', 'Your session token expired. Refresh the page and try again.'),
    );
  }

  return next();
};

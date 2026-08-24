import type { CookieOptions, Response, Request } from 'express';
import { env, isProd } from '../../config/env.js';

/**
 * All three tokens live in cookies:
 *
 *  · access  — httpOnly JWT, 15 min, sent with every API call
 *  · refresh — httpOnly opaque token, 30 days, scoped to /api/auth only, so it
 *              is never attached to file uploads or downloads
 *  · csrf    — readable by JS on purpose; the double-submit partner of the
 *              httpOnly cookies (see middleware/csrf.ts)
 *
 * httpOnly keeps tokens out of reach of any XSS payload, which is the reason we
 * don't hand the access token to localStorage.
 */
const HOST_PREFIX = isProd ? '__Host-' : '';

export const ACCESS_COOKIE = `${HOST_PREFIX}basalt_at`;
export const REFRESH_COOKIE = `${HOST_PREFIX}basalt_rt`;
export const CSRF_COOKIE = 'basalt_csrf';

// __Host- forbids a Path other than "/", so in production the refresh cookie
// trades its narrow path for the stronger prefix guarantee.
const REFRESH_PATH = isProd ? '/' : '/api/auth';

const base: CookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax',
  path: '/',
};

export function setAccessCookie(res: Response, token: string): void {
  res.cookie(ACCESS_COOKIE, token, { ...base, maxAge: env.ACCESS_TOKEN_TTL * 1000 });
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...base,
    sameSite: 'strict',
    path: REFRESH_PATH,
    maxAge: env.REFRESH_TOKEN_TTL * 1000,
  });
}

export function setCsrfCookie(res: Response, token: string): void {
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: env.REFRESH_TOKEN_TTL * 1000,
  });
}

/**
 * Drops the two credentials. The CSRF cookie deliberately stays: it is a random
 * value that proves nothing on its own, and clearing it would leave the very
 * next sign-in request with no token to double-submit.
 */
export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...base });
  res.clearCookie(REFRESH_COOKIE, { ...base, sameSite: 'strict', path: REFRESH_PATH });
}

export const readCookie = (req: Request, name: string): string | undefined => {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

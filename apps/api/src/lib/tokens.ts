import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env.js';

const secret = new TextEncoder().encode(env.ACCESS_TOKEN_SECRET);
const ISSUER = 'basalt';
const AUDIENCE = 'basalt-api';

export interface AccessClaims extends JWTPayload {
  sub: string;
  sid: string;
  typ: 'access';
}

/**
 * Access tokens are short-lived, stateless JWTs. They carry the session id so a
 * revoked session can be rejected before its token naturally expires, and so
 * the audit trail can attribute an action to one device.
 */
export async function signAccessToken(userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ typ: 'access', sid: sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
      clockTolerance: 5,
    });
    if (payload.typ !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      return null;
    }
    return payload as AccessClaims;
  } catch {
    return null;
  }
}

/**
 * Short-lived proof that a visitor already entered the password for one share
 * link. Scoped to a single slug so it cannot be replayed against another link,
 * and signed with the same key as access tokens but a different `typ`, so the
 * two can never be confused.
 */
export async function signShareGrant(slug: string, ttlSeconds = 1800): Promise<string> {
  return new SignJWT({ typ: 'share', slug })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience('basalt-share')
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret);
}

export async function verifyShareGrant(token: string, slug: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: 'basalt-share',
      algorithms: ['HS256'],
      clockTolerance: 5,
    });
    return payload.typ === 'share' && payload.slug === slug;
  } catch {
    return false;
  }
}

/** The same idea as a share grant, for a password-protected upload link. */
export async function signRequestGrant(slug: string, ttlSeconds = 3600): Promise<string> {
  return new SignJWT({ typ: 'request', slug })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience('basalt-request')
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret);
}

export async function verifyRequestGrant(token: string, slug: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: 'basalt-request',
      algorithms: ['HS256'],
      clockTolerance: 5,
    });
    return payload.typ === 'request' && payload.slug === slug;
  } catch {
    return false;
  }
}

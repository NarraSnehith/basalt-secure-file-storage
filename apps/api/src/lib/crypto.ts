import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { env } from '../config/env.js';

/**
 * Argon2id parameters follow the OWASP Password Storage Cheat Sheet
 * (m=19456 KiB, t=2, p=1). The cost is deliberately measurable — logging in
 * should take tens of milliseconds, not microseconds.
 */
const ARGON = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (plain: string): Promise<string> => argonHash(plain, ARGON);

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(hash, plain, ARGON);
  } catch {
    // Malformed hash in the database — treat as a failed attempt, never a 500.
    return false;
  }
}

/**
 * Burn roughly one password-verification worth of CPU. Called when an e-mail
 * does not exist so that "unknown account" and "wrong password" take the same
 * wall-clock time and cannot be distinguished by an enumeration attack.
 */
const DUMMY_HASH = await argonHash('basalt-timing-equaliser', ARGON);
export const equaliseTiming = () => argonVerify(DUMMY_HASH, randomBytes(16).toString('hex'), ARGON).catch(() => false);

/** URL-safe high-entropy token (default 256 bits). */
export const randomToken = (bytesLength = 32): string => randomBytes(bytesLength).toString('base64url');

/** Peppered SHA-256 — refresh tokens are stored as digests, never in the clear. */
export const digestToken = (token: string): Buffer =>
  createHash('sha256').update(`${token}${env.REFRESH_TOKEN_PEPPER}`).digest();

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const SLUG_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Share slugs: 12 chars of unambiguous base-56 ≈ 69 bits of entropy. */
export function shareSlug(length = 12): string {
  const bytes = randomBytes(length * 2);
  let out = '';
  for (let i = 0; out.length < length; i += 1) {
    const byte = bytes[i % bytes.length]!;
    if (byte < 252) out += SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
  }
  return out;
}

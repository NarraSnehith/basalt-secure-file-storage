import type { Request, RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { clientIp } from '../lib/http.js';
import { isTest } from '../config/env.js';

/**
 * Fixed-window counter, in process memory.
 *
 * Deliberately dependency-free: it protects a single API instance, which is the
 * deployment this project ships with. Behind more than one instance, swap the
 * `Store` for Redis (INCR + EXPIRE) — the middleware signature does not change.
 */
interface Counter {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Counter>();

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, counter] of buckets) {
    if (counter.resetAt <= now) buckets.delete(key);
  }
}, 60_000);
sweeper.unref();

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Requests allowed per window. */
  max: number;
  /** Bucket name, so limits don't bleed between routes. */
  name: string;
  /** Extra key material — e.g. the submitted e-mail, to slow credential stuffing. */
  key?: (req: Request) => string | undefined;
  message?: string;
}

export function rateLimit(opts: RateLimitOptions): RequestHandler {
  const { windowMs, max, name, key, message } = opts;

  return (req, res, next) => {
    if (isTest) return next();

    const extra = key?.(req);
    const id = `${name}:${clientIp(req)}${extra ? `:${extra}` : ''}`;
    const now = Date.now();

    let counter = buckets.get(id);
    if (!counter || counter.resetAt <= now) {
      counter = { count: 0, resetAt: now + windowMs };
      buckets.set(id, counter);
    }
    counter.count += 1;

    const remaining = Math.max(0, max - counter.count);
    const resetSeconds = Math.ceil((counter.resetAt - now) / 1000);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSeconds));

    if (counter.count > max) {
      res.setHeader('Retry-After', String(resetSeconds));
      next(
        new AppError('rate_limited', message ?? 'Too many requests — slow down and try again shortly.', {
          details: { retryAfterSeconds: resetSeconds },
        }),
      );
      return;
    }

    next();
  };
}

/** Test helper: forget every counter. */
export const resetRateLimits = (): void => buckets.clear();

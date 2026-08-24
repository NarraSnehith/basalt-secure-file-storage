import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Environment is parsed once, at boot, and the process refuses to start if it
 * is malformed. Everything downstream imports the frozen `env` object, so a
 * missing secret is a startup failure rather than a 500 at 3am.
 */

const here = dirname(fileURLToPath(import.meta.url));
// src/config -> src -> apps/api -> apps -> repo root
for (const candidate of ['../../.env', '../../../../.env', '../../../.env']) {
  const path = resolve(here, candidate);
  if (existsSync(path)) dotenv.config({ path, override: false });
}

const bytes = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

/** Like `bytes`, but 0 is meaningful: it means "no ceiling". */
const optionalBytes = (fallback: number) =>
  z.coerce.number().int().nonnegative().default(fallback);

/**
 * How many reverse proxies sit in front of this process.
 *
 * `false` trusts nothing. A positive integer trusts that many hops, counted
 * from this process outwards, which is the only setting that identifies a
 * client correctly. `true` trusts the whole chain and therefore takes the
 * left-most X-Forwarded-For entry — which the client itself can write, so it
 * hands anybody a way to pick their own rate-limit bucket. It is accepted
 * because it is occasionally the pragmatic answer, not because it is safe.
 *
 * Getting the count wrong is quiet rather than loud: too few and every request
 * is attributed to the nearest proxy, so per-IP limits stop constraining
 * anyone while continuing to look like they work.
 */
const trustProxy = z
  .union([z.enum(['true', 'false', '1', '0', '']), z.coerce.number().int().min(0).max(16)])
  .default('false')
  .transform((v): boolean | number => {
    if (typeof v === 'number') return v === 0 ? false : v;
    if (v === 'true') return true;
    if (v === '1') return 1;
    return false;
  });

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .transform((v) => v === 'true' || v === '1')
    .default(fallback ? 'true' : 'false');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
    PUBLIC_API_ORIGIN: z.string().default('http://localhost:3000/api'),
    TRUST_PROXY: trustProxy,

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_SSL: bool(false),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    /** Milliseconds. 0 disables it. Bounds a query blocked on a lock. */
    DATABASE_STATEMENT_TIMEOUT: z.coerce.number().int().min(0).max(600_000).default(30_000),

    ACCESS_TOKEN_SECRET: z.string().min(32, 'ACCESS_TOKEN_SECRET must be >= 32 chars'),
    REFRESH_TOKEN_PEPPER: z.string().min(32, 'REFRESH_TOKEN_PEPPER must be >= 32 chars'),
    ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_ROOT: z.string().default('./var/blobs'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool(false),
    // Both unset by default — see the note in storage/s3.ts. Set S3_ACL=private
    // only for a bucket that still has ACLs enabled.
    S3_ACL: z.string().optional(),
    S3_SSE: z.string().optional(),

    MAX_UPLOAD_BYTES: bytes(512 * 1024 * 1024),
    DEFAULT_QUOTA_BYTES: bytes(10 * 1024 * 1024 * 1024),
    /**
     * A ceiling on the bytes this deployment will ever put in the object store,
     * across every account. Per-account quotas do not bound the bill — ten
     * accounts at the 10 GB default is 100 GB — and object stores charge by
     * what you have stored, so the only way to guarantee a spend is to stop
     * accepting uploads. 0 disables the check.
     */
    GLOBAL_STORAGE_LIMIT_BYTES: optionalBytes(0),
    TRASH_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    MAX_FILES_PER_UPLOAD: z.coerce.number().int().min(1).max(100).default(20),
  })
  .superRefine((v, ctx) => {
    if (v.STORAGE_DRIVER === 's3' && !v.S3_BUCKET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET is required when STORAGE_DRIVER=s3',
      });
    }
    if (v.NODE_ENV === 'production') {
      if (v.ACCESS_TOKEN_SECRET.includes('change-me')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ACCESS_TOKEN_SECRET'], message: 'refusing to boot production with the sample secret' });
      }
      if (v.REFRESH_TOKEN_PEPPER.includes('change-me')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['REFRESH_TOKEN_PEPPER'], message: 'refusing to boot production with the sample pepper' });
      }
    }
  });

/**
 * The public origin, without making you paste it in twice.
 *
 * WEB_ORIGIN drives CORS, cookie scope and the URLs written into share links,
 * so it has to be the address people actually visit. Every host already tells
 * us that in its own variable, and reading it here removes the single most
 * common deployment mistake: a service that boots fine and then refuses every
 * request with "Origin not allowed".
 */
function inferWebOrigin(): string | undefined {
  const env = process.env;
  if (env.WEB_ORIGIN) return env.WEB_ORIGIN;
  if (env.RENDER_EXTERNAL_URL) return env.RENDER_EXTERNAL_URL;
  if (env.KOYEB_PUBLIC_DOMAIN) return `https://${env.KOYEB_PUBLIC_DOMAIN}`;
  if (env.FLY_APP_NAME) return `https://${env.FLY_APP_NAME}.fly.dev`;
  if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return undefined;
}

const parsed = schema.safeParse({ ...process.env, WEB_ORIGIN: inferWebOrigin() });

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  · ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n✖ Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env (or run \`npm run setup\`) and try again.\n`);
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
export type Env = typeof env;

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

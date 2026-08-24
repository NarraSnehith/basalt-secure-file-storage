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
    TRUST_PROXY: bool(false),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_SSL: bool(false),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

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

    MAX_UPLOAD_BYTES: bytes(512 * 1024 * 1024),
    DEFAULT_QUOTA_BYTES: bytes(10 * 1024 * 1024 * 1024),
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

const parsed = schema.safeParse(process.env);

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

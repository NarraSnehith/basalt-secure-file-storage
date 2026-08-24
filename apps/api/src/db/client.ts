import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { env, isTest } from '../config/env.js';
import { logger } from '../lib/logger.js';
import type { Database } from './types.js';

const { Pool, types } = pg;

// bigint (OID 20) arrives as a string by default which is correct for exact
// byte counts; we convert deliberately at the edges instead of silently losing
// precision here. int8 SUM/COUNT results are handled the same way.
types.setTypeParser(types.builtins.INT8, (v) => v);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: isTest ? 4 : env.DATABASE_POOL_MAX,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  application_name: 'basalt-api',
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => logger.error({ err }, 'idle postgres client errored'));

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
  log: (event) => {
    if (event.level === 'error') {
      logger.error({ err: event.error, sql: event.query.sql }, 'query failed');
    } else if (env.LOG_LEVEL === 'trace') {
      logger.trace({ sql: event.query.sql, ms: Math.round(event.queryDurationMillis) }, 'query');
    }
  },
});

export async function assertDatabaseReachable(): Promise<void> {
  await sql`select 1`.execute(db);
}

export async function closeDatabase(): Promise<void> {
  await db.destroy();
}

/** Postgres error codes we translate into domain errors. */
export const PG = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
} as const;

export function pgErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;
}

export function pgConstraint(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null ? (err as { constraint?: string }).constraint : undefined;
}

export { sql };

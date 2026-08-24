/**
 * Tiny forward-only migration runner.
 *
 * Why not a migration library: the schema lives in plain .sql files that a DBA
 * can read and `psql -f` without Node in the loop. This runner only adds the
 * three things you actually need — a ledger, a session lock so two boots can't
 * race, and per-file transactions.
 *
 *   tsx src/db/migrate.ts up      apply pending migrations
 *   tsx src/db/migrate.ts status  list applied / pending
 *   tsx src/db/migrate.ts reset   drop the public schema, then apply all
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './client.js';

/*
 * Where the .sql files are.
 *
 * Next to the compiled output once built (the build copies them in, so the
 * artefact is self-contained), and next to the source when running through tsx.
 * Resolving both means a deploy cannot fail on a missing directory that exists
 * perfectly well in the repository — which is exactly how this went wrong once.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [join(HERE, 'migrations'), join(HERE, '..', '..', 'src', 'db', 'migrations')];
const DIR = CANDIDATES.find((candidate) => existsSync(candidate)) ?? CANDIDATES[0]!;
const LOCK_KEY = 918_273_645; // arbitrary, stable

type Migration = { name: string; sql: string; checksum: string };

async function load(): Promise<Migration[]> {
  const entries = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(
    entries.map(async (name) => {
      const sql = await readFile(join(DIR, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16) };
    }),
  );
}

async function ensureLedger(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      checksum    text        NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms integer     NOT NULL
    )`);
}

async function applied(): Promise<Map<string, string>> {
  const { rows } = await pool.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM schema_migrations',
  );
  return new Map(rows.map((r) => [r.name, r.checksum]));
}

async function up(): Promise<void> {
  await ensureLedger();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    const done = await applied();
    const all = await load();

    for (const [name, checksum] of done) {
      const found = all.find((m) => m.name === name);
      if (found && found.checksum !== checksum) {
        throw new Error(
          `Migration ${name} changed after it was applied (${checksum} -> ${found.checksum}). ` +
            `Migrations are immutable — add a new file instead.`,
        );
      }
    }

    const pending = all.filter((m) => !done.has(m.name));
    if (pending.length === 0) {
      console.log('· schema up to date');
      return;
    }

    for (const m of pending) {
      const started = Date.now();
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query(
          'INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES ($1, $2, $3)',
          [m.name, m.checksum, Date.now() - started],
        );
        await client.query('COMMIT');
        console.log(`✔ ${m.name} (${Date.now() - started}ms)`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`✖ ${m.name} failed — rolled back`);
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

async function status(): Promise<void> {
  await ensureLedger();
  const done = await applied();
  for (const m of await load()) {
    console.log(`${done.has(m.name) ? '✔ applied' : '· pending'}  ${m.name}`);
  }
}

async function reset(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to reset a production database');
  }
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('· schema dropped');
  await up();
}

const cmd = process.argv[2] ?? 'up';
const run = { up, status, reset }[cmd as 'up' | 'status' | 'reset'];

if (!run) {
  console.error(`unknown command "${cmd}" — expected up | status | reset`);
  process.exit(1);
}

run()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end().catch(() => {});
    process.exit(1);
  });

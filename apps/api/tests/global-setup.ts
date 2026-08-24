import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * One-time setup for the suite: a throwaway schema in the test database and a
 * clean blob directory. The same migration files that build production build
 * this, so a broken migration fails the test run rather than the deploy.
 */
export default async function setup(): Promise<void> {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://basalt:basalt@localhost:5432/basalt_test',
    ACCESS_TOKEN_SECRET: 'test-access-secret-test-access-secret-1234',
    REFRESH_TOKEN_PEPPER: 'test-refresh-pepper-test-refresh-pepper-12',
    LOG_LEVEL: 'silent',
  };

  await rm('./var/test-blobs', { recursive: true, force: true });
  await run('npx', ['tsx', 'src/db/migrate.ts', 'reset'], { env, cwd: process.cwd() });
}

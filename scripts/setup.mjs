#!/usr/bin/env node
/**
 * One-command bootstrap: writes .env with fresh secrets, checks that Postgres is
 * reachable, creates the databases if they are missing, migrates and seeds.
 *
 *   npm run setup
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const say = (icon, message) => console.log(`${icon} ${message}`);

async function ensureEnv() {
  const envPath = join(root, '.env');
  if (existsSync(envPath)) {
    say('·', '.env already exists — leaving it alone');
    return;
  }
  const template = await readFile(join(root, '.env.example'), 'utf8');
  const filled = template
    .replace(/^ACCESS_TOKEN_SECRET=.*$/m, `ACCESS_TOKEN_SECRET=${randomBytes(48).toString('base64')}`)
    .replace(/^REFRESH_TOKEN_PEPPER=.*$/m, `REFRESH_TOKEN_PEPPER=${randomBytes(48).toString('base64')}`);
  await writeFile(envPath, filled, { mode: 0o600 });
  say('✔', 'wrote .env with freshly generated secrets');
}

function databaseUrl() {
  const envPath = join(root, '.env');
  const contents = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const line = /^DATABASE_URL=(.*)$/m.exec(contents);
  return line?.[1]?.trim() || 'postgres://basalt:basalt@localhost:5432/basalt';
}

async function ensureDatabases() {
  const url = new URL(databaseUrl());
  const admin = { ...process.env, PGPASSWORD: url.password };
  const args = ['-h', url.hostname, '-p', url.port || '5432', '-U', url.username, '-d', 'postgres', '-tAc'];

  try {
    await run('psql', [...args, 'select 1'], { env: admin });
  } catch {
    say('✖', `cannot reach postgres at ${url.hostname}:${url.port || 5432}`);
    console.log(`
  Start one, then run this again:

    macOS      brew install postgresql@17 && brew services start postgresql@17
    docker     docker run -d --name basalt-pg -p 5432:5432 \\
                 -e POSTGRES_USER=basalt -e POSTGRES_PASSWORD=basalt \\
                 -e POSTGRES_DB=basalt postgres:17-alpine

  If your credentials differ, edit DATABASE_URL in .env first.
`);
    process.exit(1);
  }

  for (const name of [url.pathname.slice(1), `${url.pathname.slice(1)}_test`]) {
    const { stdout } = await run('psql', [...args, `select 1 from pg_database where datname='${name}'`], { env: admin });
    if (stdout.trim() === '1') {
      say('·', `database ${name} already exists`);
    } else {
      await run('createdb', ['-h', url.hostname, '-p', url.port || '5432', '-U', url.username, name], { env: admin });
      say('✔', `created database ${name}`);
    }
  }
}

async function migrateAndSeed() {
  await run('npm', ['run', 'db:migrate'], { cwd: root });
  say('✔', 'schema migrated');
  await run('npm', ['run', 'db:seed'], { cwd: root });
  say('✔', 'demo account seeded — demo@basalt.build / stone-and-ash-2026');
}

console.log('\nBasalt setup\n');
await ensureEnv();
await ensureDatabases();
await migrateAndSeed();
console.log('\nReady. Start both services with:\n\n    npm run dev\n\nThen open http://localhost:3000\n');

import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from './db/client.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { pruneSessions } from './modules/auth/service.js';
import { storage } from './storage/index.js';
import { LocalStorageDriver } from './storage/local.js';

/**
 * Background housekeeping. Runs on an interval inside the API process, and can
 * also be invoked directly (`npm run maintenance`) from a cron job or a
 * Kubernetes Job if you would rather keep it out of the request path.
 */

/** Hard-delete files whose trash retention window has elapsed. */
export async function purgeExpiredTrash(): Promise<number> {
  const due = await db
    .selectFrom('files')
    .select(['id', 'storage_key', 'name', 'owner_id'])
    .where('deleted_at', 'is not', null)
    .where('purge_after', '<', new Date())
    .limit(500)
    .execute();

  if (due.length === 0) return 0;

  await db.deleteFrom('files').where('id', 'in', due.map((f) => f.id)).execute();
  await Promise.allSettled(due.map((f) => storage.delete(f.storage_key)));

  // Empty trashed folders go once nothing points at them any more.
  await db
    .deleteFrom('folders')
    .where('deleted_at', '<', new Date(Date.now() - env.TRASH_RETENTION_DAYS * 86_400_000))
    .execute();

  logger.info({ purged: due.length }, 'trash retention window elapsed — files purged');
  return due.length;
}

/**
 * Reclaim blobs with no row pointing at them. These can only appear if the
 * process dies between writing bytes and committing the row, so anything
 * younger than an hour is left alone — it may be an upload in flight.
 */
export async function sweepOrphanBlobs(): Promise<number> {
  if (!(storage instanceof LocalStorageDriver)) return 0;
  const root = join(process.cwd(), env.STORAGE_LOCAL_ROOT.replace(/^\.\//, ''));
  const cutoff = Date.now() - 3_600_000;
  let removed = 0;

  const walk = async (dir: string, prefix: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // .spool
      const path = join(dir, entry.name);
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path, key);
        continue;
      }
      const info = await stat(path).catch(() => null);
      if (!info || info.mtimeMs > cutoff) continue;
      const row = await db.selectFrom('files').select('id').where('storage_key', '=', key).executeTakeFirst();
      if (!row) {
        await unlink(path).catch(() => {});
        removed += 1;
      }
    }
  };

  await walk(join(root, 'blob'), 'blob');
  if (removed) logger.warn({ removed }, 'swept orphaned blobs');
  return removed;
}

/** Delete abandoned upload spool files (crashed mid-transfer). */
export async function sweepSpool(): Promise<number> {
  if (!(storage instanceof LocalStorageDriver)) return 0;
  const dir = storage.spoolDir;
  const cutoff = Date.now() - 6 * 3_600_000;
  let removed = 0;
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const name of entries) {
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);
    if (info?.isFile() && info.mtimeMs < cutoff) {
      await unlink(path).catch(() => {});
      removed += 1;
    }
  }
  return removed;
}

export async function runMaintenance(): Promise<void> {
  const [purged, sessions, orphans, spool] = await Promise.all([
    purgeExpiredTrash().catch((err) => {
      logger.error({ err }, 'trash purge failed');
      return 0;
    }),
    pruneSessions().catch(() => 0),
    sweepOrphanBlobs().catch(() => 0),
    sweepSpool().catch(() => 0),
  ]);
  logger.debug({ purged, sessions, orphans, spool }, 'maintenance pass complete');
}

export function startMaintenanceLoop(intervalMs = 6 * 3_600_000): NodeJS.Timeout {
  const timer = setInterval(() => void runMaintenance(), intervalMs);
  timer.unref();
  // First pass shortly after boot, once the process has settled.
  setTimeout(() => void runMaintenance(), 30_000).unref();
  return timer;
}

import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from './db/client.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { pruneSessions } from './modules/auth/service.js';
import { releaseUnreferencedBlobs } from './modules/files/service.js';
import { abandonSession } from './modules/uploads/service.js';
import { storage } from './storage/index.js';
import { LocalStorageDriver } from './storage/local.js';

/**
 * Background housekeeping. Runs on an interval inside the API process, and can
 * also be invoked directly (`npm run maintenance`) from a cron job or a
 * Kubernetes Job if you would rather keep it out of the request path.
 */

/**
 * Hard-delete files whose trash retention window has elapsed.
 *
 * Deleting the rows drops their versions' references; whichever blobs that
 * leaves at zero are released afterwards, so a file that shared its bytes with
 * a live one takes nothing with it.
 */
export async function purgeExpiredTrash(): Promise<number> {
  const due = await db
    .selectFrom('files')
    .select(['id', 'name', 'owner_id'])
    .where('deleted_at', 'is not', null)
    .where('purge_after', '<', new Date())
    .limit(500)
    .execute();

  if (due.length === 0) return 0;

  await db.deleteFrom('files').where('id', 'in', due.map((f) => f.id)).execute();
  await releaseUnreferencedBlobs();

  // Empty trashed folders go once nothing points at them any more.
  await db
    .deleteFrom('folders')
    .where('deleted_at', '<', new Date(Date.now() - env.TRASH_RETENTION_DAYS * 86_400_000))
    .execute();

  logger.info({ purged: due.length }, 'trash retention window elapsed — files purged');
  return due.length;
}

/**
 * Reclaim objects on disk that no blob row points at. These can only appear if
 * the process dies between writing bytes and committing the row, so anything
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
      const row = await db.selectFrom('blobs').select('id').where('storage_key', '=', key).executeTakeFirst();
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

/**
 * Abandon upload sessions that were never finished, and delete their spool
 * files. Without this, a browser closed halfway through a 500 MB transfer would
 * leave half a gigabyte on disk indefinitely.
 */
export async function expireUploadSessions(): Promise<number> {
  const stale = await db
    .selectFrom('upload_sessions')
    .select(['id'])
    .where('status', 'in', ['open', 'completing'])
    .where('expires_at', '<', new Date())
    .limit(200)
    .execute();

  let closed = 0;
  for (const session of stale) {
    try {
      await abandonSession(session.id, 'expired');
      closed += 1;
    } catch (err) {
      logger.warn({ err, sessionId: session.id }, 'could not expire upload session');
    }
  }
  if (closed) logger.info({ closed }, 'expired abandoned upload sessions');
  return closed;
}

export async function runMaintenance(): Promise<void> {
  const [purged, sessions, uploads, released, orphans, spool] = await Promise.all([
    purgeExpiredTrash().catch((err) => {
      logger.error({ err }, 'trash purge failed');
      return 0;
    }),
    pruneSessions().catch(() => 0),
    expireUploadSessions().catch(() => 0),
    releaseUnreferencedBlobs().catch(() => 0),
    sweepOrphanBlobs().catch(() => 0),
    sweepSpool().catch(() => 0),
  ]);
  logger.debug({ purged, sessions, uploads, released, orphans, spool }, 'maintenance pass complete');
}

export function startMaintenanceLoop(intervalMs = 6 * 3_600_000): NodeJS.Timeout {
  const timer = setInterval(() => void runMaintenance(), intervalMs);
  timer.unref();
  // First pass shortly after boot, once the process has settled.
  setTimeout(() => void runMaintenance(), 30_000).unref();
  return timer;
}

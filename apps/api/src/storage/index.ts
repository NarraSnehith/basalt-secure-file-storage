import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import type { StorageDriver } from './driver.js';
import { LocalStorageDriver } from './local.js';
import { S3StorageDriver } from './s3.js';

let driver: StorageDriver;
let spoolDir: string;

if (env.STORAGE_DRIVER === 's3') {
  driver = new S3StorageDriver({
    bucket: env.S3_BUCKET!,
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    acl: env.S3_ACL,
    serverSideEncryption: env.S3_SSE,
  });
  spoolDir = resolve(process.cwd(), env.STORAGE_LOCAL_ROOT, '.spool');
} else {
  const local = new LocalStorageDriver(env.STORAGE_LOCAL_ROOT);
  driver = local;
  spoolDir = local.spoolDir;
}

export const storage = driver;

export async function initStorage(): Promise<void> {
  await mkdir(spoolDir, { recursive: true, mode: 0o700 });
  logger.info({ driver: storage.name, spoolDir }, 'storage ready');
}

export const getSpoolDir = (): string => spoolDir;
export const newSpoolPath = (): string => join(spoolDir, `${randomUUID()}.part`);

/**
 * Opaque, sharded, extension-less object key. Two levels of hex sharding keep
 * any single directory small enough for a filesystem to stay fast, and the key
 * contains nothing derived from user input.
 */
export function newStorageKey(): string {
  const id = randomUUID().replace(/-/g, '');
  return `blob/${id.slice(0, 2)}/${id.slice(2, 4)}/${id}`;
}

export type { StorageDriver, ByteRange, BlobSource } from './driver.js';

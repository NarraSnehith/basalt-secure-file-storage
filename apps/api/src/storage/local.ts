import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, unlink, copyFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import type { BlobSource, ByteRange, StorageDriver } from './driver.js';

/**
 * Filesystem driver. Blobs are stored under a sharded, opaque key with **no
 * extension**, outside any directory the web server can reach, so nothing in
 * the store is ever interpreted as code and no user-controlled string reaches
 * a path. Every key is re-validated against the root before use.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  private readonly root: string;

  constructor(root: string) {
    this.root = isAbsolute(root) ? root : resolve(process.cwd(), root);
  }

  private resolveKey(key: string): string {
    if (!/^[A-Za-z0-9/_-]{3,200}$/.test(key) || key.includes('..')) {
      throw new Error(`unsafe storage key: ${key}`);
    }
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(`${this.root}/`)) {
      throw new Error(`storage key escapes root: ${key}`);
    }
    return full;
  }

  async put(key: string, source: BlobSource): Promise<void> {
    const target = this.resolveKey(key);
    await mkdir(dirname(target), { recursive: true, mode: 0o750 });
    try {
      // Same filesystem in the normal case: an atomic rename, no second write.
      await rename(source.path, target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      await copyFile(source.path, target);
      await unlink(source.path).catch(() => {});
    }
  }

  async read(key: string, range?: ByteRange): Promise<Readable> {
    const target = this.resolveKey(key);
    return createReadStream(target, range ? { start: range.start, end: range.end } : undefined);
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolveKey(key)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }

  async exists(key: string): Promise<boolean> {
    try {
      const s = await stat(this.resolveKey(key));
      return s.isFile();
    } catch {
      return false;
    }
  }

  /** Where uploads are spooled: same volume as the blobs, so put() is a rename. */
  get spoolDir(): string {
    return join(this.root, '.spool');
  }
}

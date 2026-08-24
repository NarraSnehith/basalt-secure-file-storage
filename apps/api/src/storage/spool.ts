import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { getSpoolDir } from './index.js';

/**
 * Spool files for resumable uploads.
 *
 * A session writes into **one** sparse file at each chunk's byte offset, so
 * there is no reassembly pass, no directory of fragments to clean up, and the
 * bytes on disk are already the finished file the moment the last chunk lands.
 * Sparse allocation means a 5 GB session costs only the blocks actually written.
 */

const KEY = /^[A-Za-z0-9_-]{8,80}\.upload$/;

function pathFor(key: string): string {
  if (!KEY.test(key)) throw new Error(`unsafe spool key: ${key}`);
  const dir = getSpoolDir();
  const full = resolve(isAbsolute(dir) ? dir : resolve(process.cwd(), dir), key);
  if (!full.startsWith(`${dir}/`) && !full.startsWith(resolve(process.cwd(), dir))) {
    throw new Error(`spool key escapes the spool directory: ${key}`);
  }
  return full;
}

export const spoolPath = pathFor;

/** Create (or adopt) the sparse file a session will fill. */
export async function createSpool(key: string, size: number): Promise<void> {
  const path = pathFor(key);
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  const handle = await open(path, 'a+', 0o600);
  try {
    // Set the final length up front: writes then land at a stable offset and the
    // filesystem can allocate contiguously.
    await handle.truncate(size);
  } finally {
    await handle.close();
  }
}

/** Write one chunk at its offset. Retrying a chunk simply overwrites it. */
export async function writeChunkAt(key: string, offset: number, data: Buffer): Promise<void> {
  const handle = await open(pathFor(key), 'r+', 0o600);
  try {
    await handle.write(data, 0, data.length, offset);
  } finally {
    await handle.close();
  }
}

/**
 * Stream a request body straight into the spool at `offset`, hashing as it
 * goes. Nothing is buffered, so an 8 MB chunk costs 8 MB of *network*, not of
 * heap. Returns what actually arrived so the caller can decide whether to
 * trust it.
 */
export async function streamChunkInto(
  key: string,
  offset: number,
  source: Readable,
  limit: number,
): Promise<{ bytes: number; sha256: string; overflowed: boolean }> {
  const handle = await open(pathFor(key), 'r+', 0o600);
  const hash = createHash('sha256');
  let bytes = 0;
  let overflowed = false;

  try {
    for await (const piece of source) {
      const buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(piece as ArrayBufferLike);
      if (bytes + buffer.length > limit) {
        overflowed = true;
        break;
      }
      await handle.write(buffer, 0, buffer.length, offset + bytes);
      hash.update(buffer);
      bytes += buffer.length;
    }
  } finally {
    await handle.close();
  }

  return { bytes, sha256: hash.digest('hex'), overflowed };
}

/** SHA-256 over the assembled file, plus its first bytes for type sniffing. */
export async function digestSpool(
  key: string,
  headBytes = 4100,
): Promise<{ checksum: Buffer; size: number; head: Buffer }> {
  const path = pathFor(key);
  const info = await stat(path);
  const hash = createHash('sha256');
  const head: Buffer[] = [];
  let headLength = 0;

  await new Promise<void>((done, fail) => {
    const stream = createReadStream(path, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => {
      const buffer = chunk as Buffer;
      hash.update(buffer);
      if (headLength < headBytes) {
        const slice = buffer.subarray(0, headBytes - headLength);
        head.push(slice);
        headLength += slice.length;
      }
    });
    stream.on('end', () => done());
    stream.on('error', fail);
  });

  return { checksum: hash.digest(), size: info.size, head: Buffer.concat(head) };
}

export async function removeSpool(key: string): Promise<void> {
  await unlink(pathFor(key)).catch(() => {});
}

export async function spoolExists(key: string): Promise<boolean> {
  try {
    return (await stat(pathFor(key))).isFile();
  } catch {
    return false;
  }
}

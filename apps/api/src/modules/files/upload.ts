import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type { Request } from 'express';
import busboy from 'busboy';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { sanitizeFilename } from '../../lib/filenames.js';
import { newSpoolPath } from '../../storage/index.js';

/** A fully received upload, spooled to disk and measured — not yet persisted. */
export interface ReceivedBlob {
  filename: string;
  declaredMime: string | null;
  spoolPath: string;
  size: number;
  checksum: Buffer;
  /** First bytes, kept in memory for magic-byte sniffing. */
  head: Buffer;
}

export interface MultipartResult {
  blobs: ReceivedBlob[];
  fields: Record<string, string>;
}

const HEAD_BYTES = 4_100; // what file-type needs for every format it knows

export interface ReceiveOptions {
  maxBytes: number;
  maxFiles: number;
}

/**
 * Stream a multipart upload to disk.
 *
 * Nothing is buffered in memory beyond the first 4 KB of each file, so a 100 MB
 * (or 5 GB) upload costs a constant amount of RAM. The size limit is enforced
 * by the parser *while* bytes arrive — we never accept a huge body and measure
 * it afterwards — and every partial file is unlinked on any failure path,
 * including a client that disconnects mid-transfer.
 */
export function receiveMultipart(req: Request, opts: ReceiveOptions): Promise<MultipartResult> {
  const contentType = req.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return Promise.reject(
      new AppError('unsupported_media_type', 'Uploads must be sent as multipart/form-data.'),
    );
  }

  // Fail before reading a single byte when the declared body is already too big.
  const declaredLength = Number(req.get('content-length') ?? 0);
  const ceiling = opts.maxBytes * opts.maxFiles + 1024 * 1024;
  if (Number.isFinite(declaredLength) && declaredLength > ceiling) {
    return Promise.reject(
      new AppError('payload_too_large', 'That upload is larger than this account allows in one request.', {
        details: { maxBytesPerFile: opts.maxBytes, maxFiles: opts.maxFiles },
      }),
    );
  }

  return new Promise<MultipartResult>((resolve, reject) => {
    const blobs: ReceivedBlob[] = [];
    const fields: Record<string, string> = {};
    const spooled = new Set<string>();
    let pending = 0;
    let finished = false;
    let settled = false;

    const bb = busboy({
      headers: req.headers,
      limits: {
        // busboy raises 'limit' the moment the counter *reaches* fileSize, so
        // one extra byte of headroom makes a file of exactly maxBytes legal —
        // a 100 MB cap has to accept a 100 MB file.
        fileSize: opts.maxBytes + 1,
        files: opts.maxFiles,
        fields: 16,
        fieldSize: 4096,
        fieldNameSize: 128,
      },
      defParamCharset: 'utf8',
    });

    const cleanup = async () => {
      await Promise.allSettled([...spooled].map((p) => unlink(p)));
    };

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      req.unpipe(bb);
      bb.removeAllListeners();
      // Drain the rest of the request so the socket closes cleanly instead of
      // leaving the browser with a reset connection and no status code.
      req.resume();
      void cleanup().finally(() => reject(err));
    };

    const done = () => {
      if (settled || !finished || pending > 0) return;
      settled = true;
      if (blobs.length === 0) {
        fail(new AppError('bad_request', 'No file was included in the upload.'));
        return;
      }
      resolve({ blobs, fields });
    };

    bb.on('field', (name, value) => {
      if (typeof name === 'string' && name.length <= 128) fields[name] = String(value).slice(0, 4096);
    });

    bb.on('file', (_field, stream, info) => {
      const filename = sanitizeFilename(info.filename ?? '', 'upload');
      const spoolPath = newSpoolPath();
      spooled.add(spoolPath);
      pending += 1;

      const hash = createHash('sha256');
      const heads: Buffer[] = [];
      let headLength = 0;
      let size = 0;
      let aborted = false;

      const out = createWriteStream(spoolPath, { mode: 0o600 });

      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        hash.update(chunk);
        if (headLength < HEAD_BYTES) {
          const slice = chunk.subarray(0, HEAD_BYTES - headLength);
          heads.push(slice);
          headLength += slice.length;
        }
      });

      // busboy raises this the moment the byte counter crosses the limit.
      stream.on('limit', () => {
        aborted = true;
        out.destroy();
        fail(
          new AppError('payload_too_large', `“${filename}” is larger than the ${formatLimit(opts.maxBytes)} limit.`, {
            details: { filename, maxBytes: opts.maxBytes },
          }),
        );
      });

      stream.on('error', (err) => {
        aborted = true;
        out.destroy();
        fail(err);
      });

      out.on('error', (err) => {
        aborted = true;
        fail(err);
      });

      out.on('finish', () => {
        pending -= 1;
        if (aborted || settled) return;
        blobs.push({
          filename,
          declaredMime: typeof info.mimeType === 'string' ? info.mimeType.slice(0, 255) : null,
          spoolPath,
          size,
          checksum: hash.digest(),
          head: Buffer.concat(heads),
        });
        done();
      });

      stream.pipe(out);
    });

    bb.on('filesLimit', () => {
      fail(
        new AppError('bad_request', `Upload at most ${opts.maxFiles} files at a time.`, {
          details: { maxFiles: opts.maxFiles },
        }),
      );
    });

    bb.on('error', (err) => {
      logger.warn({ err }, 'multipart parse failed');
      fail(new AppError('bad_request', 'The upload was malformed or interrupted.'));
    });

    bb.on('close', () => {
      finished = true;
      done();
    });

    req.on('aborted', () => fail(new AppError('bad_request', 'Upload cancelled.')));
    req.on('error', (err) => fail(err));

    req.pipe(bb);
  });
}

/** Discard spooled bytes for uploads that were received but not persisted. */
export async function discardBlobs(blobs: ReceivedBlob[]): Promise<void> {
  await Promise.allSettled(blobs.map((b) => unlink(b.spoolPath)));
}

const formatLimit = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`;

import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { contentDisposition } from '../../lib/filenames.js';
import { dispositionFor } from '../../lib/mime.js';
import { logger } from '../../lib/logger.js';
import { storage } from '../../storage/index.js';

export interface Blob {
  name: string;
  mimeType: string;
  mismatch: boolean;
  sizeBytes: number;
  storageKey: string;
  checksum: string;
}

export interface StreamOptions {
  /** What the caller asked for; downgraded to attachment when unsafe. */
  wants: 'inline' | 'attachment' | 'auto';
  /** Public (share link) responses may be revalidated; private ones never cached. */
  isPublic: boolean;
}

/** Parse a single-range `Range: bytes=…` header. Multi-range is not supported. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return 'invalid';

  const [, rawStart, rawEnd] = match;
  let start: number;
  let end: number;

  if (rawStart === '') {
    if (rawEnd === '') return 'invalid';
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}

/**
 * Stream a stored blob to the client.
 *
 * Every response is hardened the same way, whether the caller is the owner or an
 * anonymous visitor with a share link:
 *
 *  · `nosniff` + a content type we determined ourselves, so the browser cannot
 *    be talked into treating a .png as HTML
 *  · a sandboxing CSP, so even if something *were* rendered it can do nothing
 *  · `Content-Disposition: attachment` for every type that isn't safe inline
 *  · byte ranges, so video and audio can seek instead of downloading in full
 *  · a strong ETag (the content hash) for conditional requests
 *
 * With an S3-style backend the bytes never touch this process at all: the
 * response is a redirect to a short-lived presigned URL with the filename and
 * disposition baked into the signature.
 */
export async function streamBlob(req: Request, res: Response, blob: Blob, opts: StreamOptions): Promise<void> {
  const safest = dispositionFor(blob.mimeType, blob.mismatch);
  const disposition = opts.wants === 'auto' ? safest : opts.wants === 'inline' && safest === 'inline' ? 'inline' : 'attachment';

  const etag = `"sha256-${blob.checksum.slice(0, 32)}"`;

  res.setHeader('Content-Type', blob.mimeType);
  res.setHeader('Content-Disposition', contentDisposition(blob.name, disposition));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // `sandbox` neutralises anything active even if a browser were talked into
  // rendering it. frame-ancestors replaces X-Frame-Options because the web app
  // may be served from a different origin than the API (dev, or a split
  // deployment) and XFO cannot express "this origin plus that one".
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'self' ${env.WEB_ORIGIN}`,
  );
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('ETag', etag);
  // same-site (not same-origin) so the web app can render a private file in an
  // <img>/<video> when it is served from a sibling port of the same site.
  res.setHeader('Cross-Origin-Resource-Policy', opts.isPublic ? 'cross-origin' : 'same-site');
  res.setHeader(
    'Cache-Control',
    opts.isPublic ? 'public, max-age=0, must-revalidate' : 'private, no-store, max-age=0',
  );

  const ifNoneMatch = req.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch.split(',').some((tag) => tag.trim() === etag)) {
    res.status(304).end();
    return;
  }

  const range = parseRange(req.get('range'), blob.sizeBytes);
  if (range === 'invalid') {
    res.setHeader('Content-Range', `bytes */${blob.sizeBytes}`);
    res.status(416).json({ error: { code: 'bad_request', message: 'Requested range is not satisfiable.' } });
    return;
  }

  // Hand the transfer to object storage when it can serve the bytes itself.
  if (!range && storage.signedUrl) {
    const url = await storage
      .signedUrl(blob.storageKey, {
        filename: blob.name,
        contentType: blob.mimeType,
        disposition,
        ttlSeconds: 120,
      })
      .catch(() => null);
    if (url) {
      res.redirect(302, url);
      return;
    }
  }

  const length = range ? range.end - range.start + 1 : blob.sizeBytes;
  if (range) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${blob.sizeBytes}`);
  }
  res.setHeader('Content-Length', String(length));

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  let source;
  try {
    source = await storage.read(blob.storageKey, range ?? undefined);
  } catch (err) {
    logger.error({ err, storageKey: blob.storageKey }, 'stored blob is missing');
    throw new AppError('not_found', 'The stored copy of this file could not be read.');
  }

  // A browser closing the tab mid-download must not leave a dangling handle.
  res.on('close', () => source.destroy());

  try {
    await pipeline(source, res);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'EPIPE') return; // client went away
    throw err;
  }
}

import { inflateSync } from 'node:zlib';
import { db } from '../db/client.js';
import { storage } from '../storage/index.js';
import { logger } from './logger.js';

/**
 * Text extraction for search.
 *
 * Deliberately narrow: formats we can read correctly with no dependency and no
 * ambiguity. Getting this wrong does not produce "slightly worse search" — it
 * fills the index with binary noise that matches everything, so anything we are
 * not confident about is skipped and the file stays findable by name alone.
 */

const MAX_READ_BYTES = 2 * 1024 * 1024; // never pull more than 2 MB back
const MAX_TEXT_CHARS = 256 * 1024; // and index at most 256 KB of it

const TEXTUAL_EXACT = new Set([
  'application/json',
  'application/yaml',
  'application/toml',
  'application/xml',
  'application/sql',
  'application/x-ipynb+json',
  'application/javascript',
]);

const isTextual = (mimeType: string): boolean =>
  mimeType.startsWith('text/') || TEXTUAL_EXACT.has(mimeType);

async function readHead(blobId: string, limit: number): Promise<Buffer | null> {
  const blob = await db
    .selectFrom('blobs')
    .select(['storage_key', 'size_bytes'])
    .where('id', '=', blobId)
    .executeTakeFirst();
  if (!blob) return null;

  const end = Math.min(Number(blob.size_bytes), limit) - 1;
  if (end < 0) return null;

  const stream = await storage.read(blob.storage_key, { start: 0, end });
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

/** Collapse whitespace, drop control characters, and cap the length. */
function normalise(text: string): string {
  return text
    // Strip C0/C1 control characters; they only ever arrive from mis-decoding.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

/** Does this look like prose or code, rather than decoded binary? */
function looksLikeText(text: string): boolean {
  if (text.length < 8) return false;
  const printable = text.replace(/[^\u0020-\u007e\u00a0-\uffff]/g, '').length;
  return printable / text.length > 0.85;
}

export async function extractText(
  blobId: string,
  mimeType: string,
  sizeBytes: number,
): Promise<string | null> {
  try {
    if (isTextual(mimeType)) {
      const buffer = await readHead(blobId, MAX_READ_BYTES);
      if (!buffer) return null;
      const text = normalise(buffer.toString('utf8'));
      return looksLikeText(text) ? text : null;
    }

    if (mimeType === 'application/pdf' && sizeBytes <= MAX_READ_BYTES) {
      const buffer = await readHead(blobId, MAX_READ_BYTES);
      return buffer ? extractPdfText(buffer) : null;
    }

    return null;
  } catch (err) {
    logger.debug({ err, blobId }, 'extraction skipped');
    return null;
  }
}

/**
 * Minimal PDF text extraction: walk the content streams (inflating the
 * FlateDecode ones) and collect the operands of the text-showing operators.
 *
 * This is not a PDF renderer. It handles the common case — text drawn with a
 * standard encoding — and returns nothing at all when the result does not look
 * like text, which is the correct answer for a scanned page or a subset-encoded
 * font. A real deployment would put this behind a proper extraction worker; the
 * point here is that unreadable input degrades to "findable by name" rather
 * than to a poisoned index.
 */
export function extractPdfText(pdf: Buffer): string | null {
  const streams: Buffer[] = [];
  let cursor = 0;

  while (streams.length < 64) {
    const start = pdf.indexOf('stream', cursor);
    if (start === -1) break;
    const end = pdf.indexOf('endstream', start);
    if (end === -1) break;

    // Skip the end-of-line that must follow the `stream` keyword.
    let from = start + 6;
    if (pdf[from] === 0x0d) from += 1;
    if (pdf[from] === 0x0a) from += 1;

    const raw = pdf.subarray(from, end);
    cursor = end + 9;
    if (raw.length === 0) continue;

    if (raw[0] === 0x78) {
      // zlib header: a FlateDecode stream.
      try {
        streams.push(inflateSync(raw));
      } catch {
        /* not inflatable — skip it */
      }
    } else {
      streams.push(raw);
    }
  }

  if (streams.length === 0) return null;

  const content = Buffer.concat(streams).toString('latin1');
  const pieces: string[] = [];

  // ( … ) Tj  and  [ ( … ) … ] TJ, inside a BT/ET text object.
  const showText = /\((?:\\.|[^\\()])*\)/g;
  const textBlocks = content.match(/BT[\s\S]*?ET/g) ?? [content];

  const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '', f: '' };

  for (const block of textBlocks) {
    for (const match of block.match(showText) ?? []) {
      const literal = match
        .slice(1, -1)
        .replace(/\\([nrtbf])/g, (_, code: string) => ESCAPES[code] ?? '')
        .replace(/\\([0-7]{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)))
        .replace(/\\(.)/g, '$1');
      if (literal.trim()) pieces.push(literal);
    }
  }

  const text = normalise(pieces.join(' '));
  return text.length >= 16 && looksLikeText(text) ? text : null;
}

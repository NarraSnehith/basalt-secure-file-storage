import { basename, extname } from 'node:path';

/** Windows device names — harmless on Linux, breaks a synced Windows client. */
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

export const MAX_NAME_LENGTH = 255;

/**
 * Turn whatever the client sent into a name we are willing to persist.
 *
 * The uploaded name never touches the filesystem — blobs are stored under a
 * random key (see storage drivers) — but it *is* echoed back in listings, in
 * Content-Disposition headers and on public share pages, so it still has to be
 * boring: no separators, no control characters, no traversal, no ambiguity.
 */
export function sanitizeFilename(raw: string, fallback = 'untitled'): string {
  let name = String(raw ?? '')
    .normalize('NFC')
    // Take the last path segment under both separators; `basename` alone
    // leaves `..\..\evil.txt` intact on POSIX.
    .replace(/\\/g, '/');
  name = basename(name);

  name = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    // Bidi / zero-width characters used to disguise the real extension.
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    // Trailing dots and spaces are silently dropped by Windows.
    .replace(/[. ]+$/g, '')
    // A leading dot makes the file invisible and hides its extension.
    .replace(/^\.+/, '');

  if (!name) name = fallback;

  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  if (RESERVED.has(stem.toLowerCase())) name = `_${name}`;

  if (Buffer.byteLength(name, 'utf8') > MAX_NAME_LENGTH) {
    const keptExt = ext.slice(0, 16);
    const budget = MAX_NAME_LENGTH - Buffer.byteLength(keptExt, 'utf8');
    let cut = stem;
    while (Buffer.byteLength(cut, 'utf8') > budget) cut = cut.slice(0, -1);
    name = `${cut}${keptExt}`;
  }

  return name || fallback;
}

export function extensionOf(name: string): string | null {
  const ext = extname(name).slice(1).toLowerCase();
  return ext && ext.length <= 16 ? ext : null;
}

/** "report.pdf" + 2 -> "report (2).pdf" — used to resolve name collisions. */
export function suffixName(name: string, n: number): string {
  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  return `${stem} (${n})${ext}`;
}

/**
 * RFC 6266 Content-Disposition with an ASCII fallback plus a UTF-8 filename*,
 * so non-Latin names survive and quotes cannot break out of the header.
 */
export function contentDisposition(name: string, mode: 'inline' | 'attachment'): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

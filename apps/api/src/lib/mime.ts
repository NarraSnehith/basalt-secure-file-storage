import { fileTypeFromBuffer } from 'file-type';
import { extensionOf } from './filenames.js';

export type FileKind =
  | 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'spreadsheet'
  | 'presentation' | 'archive' | 'code' | 'text' | 'font' | 'binary' | 'other';

const BY_EXTENSION: Record<string, string> = {
  // images
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
  tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif',
  svg: 'image/svg+xml', psd: 'image/vnd.adobe.photoshop',
  // video
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', mpg: 'video/mpeg', mpeg: 'video/mpeg',
  // audio
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac',
  ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', opus: 'audio/opus', aiff: 'audio/aiff',
  // documents
  pdf: 'application/pdf', epub: 'application/epub+zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf', pages: 'application/x-iwork-pages-sffpages',
  key: 'application/x-iwork-keynote-sffkey', numbers: 'application/x-iwork-numbers-sffnumbers',
  // archives
  zip: 'application/zip', gz: 'application/gzip', tgz: 'application/gzip',
  tar: 'application/x-tar', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  bz2: 'application/x-bzip2', xz: 'application/x-xz', dmg: 'application/x-apple-diskimage',
  iso: 'application/x-iso9660-image',
  // text & code
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values',
  log: 'text/plain', json: 'application/json', yaml: 'application/yaml', yml: 'application/yaml',
  toml: 'application/toml', xml: 'application/xml', html: 'text/html', htm: 'text/html',
  css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  ts: 'text/plain', tsx: 'text/plain', jsx: 'text/plain', py: 'text/x-python',
  rb: 'text/x-ruby', go: 'text/x-go', rs: 'text/x-rust', java: 'text/x-java',
  c: 'text/x-c', h: 'text/x-c', cpp: 'text/x-c++', hpp: 'text/x-c++', cs: 'text/plain',
  php: 'text/x-php', sh: 'text/x-shellscript', sql: 'application/sql', swift: 'text/plain',
  kt: 'text/plain', ipynb: 'application/x-ipynb+json',
  // fonts & misc
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  exe: 'application/vnd.microsoft.portable-executable', apk: 'application/vnd.android.package-archive',
  deb: 'application/vnd.debian.binary-package', rpm: 'application/x-rpm',
  wasm: 'application/wasm', bin: 'application/octet-stream',
};

const KIND_BY_EXTENSION: Record<string, FileKind> = {
  svg: 'image', psd: 'image',
  pdf: 'pdf', epub: 'document', rtf: 'document',
  doc: 'document', docx: 'document', odt: 'document', pages: 'document',
  xls: 'spreadsheet', xlsx: 'spreadsheet', ods: 'spreadsheet', csv: 'spreadsheet',
  tsv: 'spreadsheet', numbers: 'spreadsheet',
  ppt: 'presentation', pptx: 'presentation', odp: 'presentation', key: 'presentation',
  zip: 'archive', gz: 'archive', tgz: 'archive', tar: 'archive', rar: 'archive',
  '7z': 'archive', bz2: 'archive', xz: 'archive', dmg: 'archive', iso: 'archive',
  txt: 'text', md: 'text', log: 'text',
  json: 'code', yaml: 'code', yml: 'code', toml: 'code', xml: 'code', html: 'code',
  htm: 'code', css: 'code', js: 'code', mjs: 'code', cjs: 'code', ts: 'code',
  tsx: 'code', jsx: 'code', py: 'code', rb: 'code', go: 'code', rs: 'code',
  java: 'code', c: 'code', h: 'code', cpp: 'code', hpp: 'code', cs: 'code',
  php: 'code', sh: 'code', sql: 'code', swift: 'code', kt: 'code', ipynb: 'code',
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font',
  exe: 'binary', apk: 'binary', deb: 'binary', rpm: 'binary', wasm: 'binary', bin: 'binary',
};

/**
 * Uploads with these extensions are rejected outright: they are interpreted as
 * code by common web servers, so a single mis-configured static mount would
 * turn user storage into remote code execution. Nothing of value is lost — the
 * source can be uploaded zipped.
 */
export const BLOCKED_EXTENSIONS = new Set([
  'php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phps', 'phtml', 'phar',
  'jsp', 'jspx', 'jsw', 'jsv', 'jspf',
  'asp', 'aspx', 'asa', 'asax', 'ascx', 'ashx', 'asmx', 'axd', 'cshtml', 'vbhtml',
  'cgi', 'fcgi', 'pht', 'shtml', 'htaccess', 'htpasswd', 'ini', 'config',
]);

/**
 * Served with `Content-Disposition: attachment` and never previewed inline,
 * because a browser rendering them on our origin means stored XSS. Note the
 * public download route is origin-isolated anyway; this is belt *and* braces.
 */
const NEVER_INLINE_MIME = new Set([
  'text/html', 'application/xhtml+xml', 'image/svg+xml', 'application/xml', 'text/xml',
  'text/javascript', 'application/javascript', 'application/wasm',
  'application/x-shockwave-flash', 'text/x-php', 'text/x-shellscript',
]);

const INLINE_SAFE_PREFIXES = ['image/', 'video/', 'audio/'];
const INLINE_SAFE_EXACT = new Set(['application/pdf', 'text/plain', 'text/markdown', 'text/csv']);

export interface ResolvedType {
  /** Content type we will store and serve. Never the raw client claim. */
  mimeType: string;
  /** What the browser told us, kept for auditing. */
  declaredMime: string | null;
  /** What the magic bytes say, when the format is detectable. */
  sniffedMime: string | null;
  /** True when magic bytes contradict the extension's type family. */
  mismatch: boolean;
  kind: FileKind;
}

export function mimeForExtension(ext: string | null): string | null {
  return ext ? (BY_EXTENSION[ext] ?? null) : null;
}

export function classify(mimeType: string, ext: string | null): FileKind {
  if (ext && KIND_BY_EXTENSION[ext]) return KIND_BY_EXTENSION[ext]!;
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('font/')) return 'font';
  if (mimeType.startsWith('text/')) return 'text';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'application/octet-stream') return 'binary';
  return 'other';
}

const family = (mime: string): string => mime.split('/')[0] ?? '';

/** Some containers legitimately sniff as something else — don't cry wolf. */
const BENIGN_SNIFF_PAIRS = new Set([
  'application/zip|application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip|application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip|application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip|application/vnd.oasis.opendocument.text',
  'application/zip|application/vnd.oasis.opendocument.spreadsheet',
  'application/zip|application/vnd.oasis.opendocument.presentation',
  'application/zip|application/epub+zip',
  'application/zip|application/vnd.android.package-archive',
  'application/zip|application/x-iwork-pages-sffpages',
  'application/zip|application/x-iwork-keynote-sffkey',
  'application/zip|application/x-iwork-numbers-sffnumbers',
  'video/mp4|video/x-m4v',
  'video/mp4|audio/mp4',
  'application/xml|image/svg+xml',
]);

/**
 * Decide the content type from three sources of evidence, trusting them in the
 * order: magic bytes > extension > client claim. The client claim is the only
 * one an attacker fully controls, so it is used solely as a last resort.
 */
export async function resolveType(
  head: Buffer,
  filename: string,
  declared: string | null,
): Promise<ResolvedType> {
  const ext = extensionOf(filename);
  const fromExt = mimeForExtension(ext);
  const sniff = head.length > 0 ? await fileTypeFromBuffer(head).catch(() => undefined) : undefined;
  const sniffed = sniff?.mime ?? null;

  let mimeType = sniffed ?? fromExt ?? (declared && /^[\w.+-]+\/[\w.+-]+$/.test(declared) ? declared : null) ?? 'application/octet-stream';

  // Text-ish formats have no magic bytes; the extension is more informative
  // than a generic sniff result, so prefer it when the sniff came up empty.
  if (!sniffed && fromExt) mimeType = fromExt;

  let mismatch = false;
  if (sniffed && fromExt && sniffed !== fromExt) {
    const pair = `${sniffed}|${fromExt}`;
    mismatch = !BENIGN_SNIFF_PAIRS.has(pair) && family(sniffed) !== family(fromExt);
  }

  return {
    mimeType,
    declaredMime: declared,
    sniffedMime: sniffed,
    mismatch,
    kind: classify(mimeType, ext),
  };
}

/** Inline rendering is opt-in per type, and never for a mismatched upload. */
export function dispositionFor(mimeType: string, mismatch = false): 'inline' | 'attachment' {
  if (mismatch) return 'attachment';
  if (NEVER_INLINE_MIME.has(mimeType)) return 'attachment';
  if (INLINE_SAFE_EXACT.has(mimeType)) return 'inline';
  if (INLINE_SAFE_PREFIXES.some((p) => mimeType.startsWith(p))) return 'inline';
  return 'attachment';
}

export const isBlockedExtension = (ext: string | null): boolean => !!ext && BLOCKED_EXTENSIONS.has(ext);

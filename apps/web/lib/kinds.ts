export type FileKind =
  | 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'spreadsheet'
  | 'presentation' | 'archive' | 'code' | 'text' | 'font' | 'binary' | 'other';

export const KIND_ORDER: FileKind[] = [
  'image', 'video', 'audio', 'pdf', 'document', 'spreadsheet',
  'presentation', 'code', 'text', 'archive', 'font', 'binary', 'other',
];

export const KIND_LABEL: Record<FileKind, string> = {
  image: 'Images',
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDFs',
  document: 'Documents',
  spreadsheet: 'Spreadsheets',
  presentation: 'Slides',
  archive: 'Archives',
  code: 'Code',
  text: 'Text',
  font: 'Fonts',
  binary: 'Binaries',
  other: 'Other',
};

/** Singular, for a single row's tooltip. */
export const KIND_NOUN: Record<FileKind, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF',
  document: 'Document',
  spreadsheet: 'Spreadsheet',
  presentation: 'Presentation',
  archive: 'Archive',
  code: 'Code',
  text: 'Text',
  font: 'Font',
  binary: 'Binary',
  other: 'File',
};

export const kindColor = (kind: string): string => `var(--kind-${isKind(kind) ? kind : 'other'})`;

export const isKind = (value: string): value is FileKind => value in KIND_LABEL;

/** What we are willing to render in-page. Anything else downloads. */
export function previewMode(mimeType: string, kind: string): 'image' | 'video' | 'audio' | 'pdf' | 'text' | null {
  if (kind === 'image' && mimeType !== 'image/svg+xml') return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'text/csv') return 'text';
  return null;
}

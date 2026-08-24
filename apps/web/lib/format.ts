const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Decimal units, the way file managers and disk vendors count. */
export function formatBytes(bytes: number, precision = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 KB';
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 10 ? precision : value < 100 ? 1 : 0;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

/** Split for layouts that want to style the unit differently from the number. */
export function splitBytes(bytes: number): { value: string; unit: string } {
  const [value = '0', unit = 'KB'] = formatBytes(bytes).split(' ');
  return { value, unit };
}

export function formatRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—';
  return `${formatBytes(bytesPerSecond, 1)}/s`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 1) return 'now';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const RELATIVE: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const delta = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(delta);
  if (abs < 45_000) return 'just now';
  for (const [unit, ms] of RELATIVE) {
    if (abs >= ms) return rtf.format(Math.round(delta / ms), unit);
  }
  return rtf.format(Math.round(delta / 60_000), 'minute');
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

export const formatDate = (iso: string | null | undefined): string =>
  iso ? dateFmt.format(new Date(iso)) : '—';

export const formatDateTime = (iso: string | null | undefined): string =>
  iso ? `${dateFmt.format(new Date(iso))} · ${timeFmt.format(new Date(iso))}` : '—';

/** Long hex digests are unreadable in full — show head and tail. */
export const shortHash = (hex: string, span = 6): string =>
  hex.length <= span * 2 ? hex : `${hex.slice(0, span)}…${hex.slice(-span)}`;

/** "document.tar.gz" -> { stem: "document.tar", ext: "gz" } */
export function splitName(name: string): { stem: string; ext: string | null } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: null };
  return { stem: name.slice(0, dot), ext: name.slice(dot + 1) };
}

/** Middle-truncate so both the beginning and the extension stay visible. */
export function truncateMiddle(text: string, max = 42): string {
  if (text.length <= max) return text;
  const keep = Math.floor((max - 1) / 2);
  return `${text.slice(0, keep)}…${text.slice(-keep)}`;
}

export const pluralise = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

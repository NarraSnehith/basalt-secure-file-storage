const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Human-readable size using decimal units (what file managers show). */
export function formatBytes(input: number | string, precision = 1): string {
  let value = typeof input === 'string' ? Number(input) : input;
  if (!Number.isFinite(value) || value < 0) return '—';
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 10 ? precision : value < 100 ? 1 : 0;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

/** bigint columns come back from pg as strings — normalise at the edge. */
export const toBytes = (v: number | string | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === 'number' ? v : Number(v);

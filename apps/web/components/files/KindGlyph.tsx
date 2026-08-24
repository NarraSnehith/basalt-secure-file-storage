import { kindColor, type FileKind } from '@/lib/kinds';

/**
 * A drawn mark per file family, on a tinted tile.
 *
 * Extensions alone are noise at a glance ("xlsx" vs "xls" vs "csv"), and a wall
 * of identical page icons is worse. Each family gets its own motif in its own
 * hue, so a folder can be read by shape before any text is parsed.
 */
const MOTIF: Record<FileKind, React.ReactNode> = {
  image: (
    <>
      <circle cx="6.4" cy="6.2" r="1.35" />
      <path d="M2.6 12.4l3.3-3.6 2.2 2.2 2.1-2.6 3.2 4z" />
    </>
  ),
  video: (
    <>
      <rect x="2.4" y="4" width="11.2" height="8" rx="1.3" />
      <path d="M6.9 6.7l3.4 1.9-3.4 1.9z" />
    </>
  ),
  audio: (
    <>
      <path d="M3 9.4V6.6M5.6 11.2V4.8M8.2 10V6M10.8 12V4M13.4 9.4V6.6" strokeWidth="1.5" />
    </>
  ),
  pdf: (
    <>
      <path d="M4 2.6h5.2l3 3v7.8H4z" />
      <path d="M9.2 2.6v3h3" />
      <path d="M6.2 9.4c1.8 0 3.4-1 3.4-2.2" strokeWidth="1.1" />
    </>
  ),
  document: (
    <>
      <path d="M4 2.6h5.2l3 3v7.8H4z" />
      <path d="M9.2 2.6v3h3" />
      <path d="M6 8.4h4M6 10.6h2.6" strokeWidth="1.1" />
    </>
  ),
  spreadsheet: (
    <>
      <rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.1" />
      <path d="M2.6 6.6h10.8M6.4 3.4v9.2M9.8 6.6v6" strokeWidth="1.05" />
    </>
  ),
  presentation: (
    <>
      <rect x="2.4" y="3" width="11.2" height="8" rx="1.1" />
      <path d="M8 11v2.4M5.6 13.4h4.8" strokeWidth="1.1" />
      <path d="M5.4 8.6V6.8M8 8.6V5.4M10.6 8.6V7.6" strokeWidth="1.2" />
    </>
  ),
  archive: (
    <>
      <path d="M2.6 5.6h10.8v7.2H2.6z" />
      <path d="M2.6 5.6l1.4-2.2h8l1.4 2.2" />
      <path d="M8 5.6v2.2M8 9.4v1.4" strokeWidth="1.3" />
    </>
  ),
  code: (
    <>
      <path d="M5.6 5.2L2.8 8l2.8 2.8M10.4 5.2L13.2 8l-2.8 2.8" />
      <path d="M9 3.6l-2 8.8" strokeWidth="1.1" opacity="0.55" />
    </>
  ),
  text: (
    <>
      <path d="M4 2.6h5.2l3 3v7.8H4z" />
      <path d="M6 7.6h4M6 9.6h4M6 11.4h2.4" strokeWidth="1.05" />
    </>
  ),
  font: (
    <>
      <path d="M3.6 12.4L8 3.6l4.4 8.8" />
      <path d="M5.6 9.6h4.8" strokeWidth="1.2" />
    </>
  ),
  binary: (
    <>
      <rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1" />
      <path d="M6.6 2.6v1.8M9.4 2.6v1.8M6.6 11.6v1.8M9.4 11.6v1.8M2.6 6.6h1.8M2.6 9.4h1.8M11.6 6.6h1.8M11.6 9.4h1.8" strokeWidth="1.1" />
    </>
  ),
  other: (
    <>
      <path d="M4 2.6h5.2l3 3v7.8H4z" />
      <path d="M9.2 2.6v3h3" />
    </>
  ),
};

export function KindGlyph({
  kind,
  size = 26,
  flat = false,
}: {
  kind: FileKind;
  size?: number;
  /** Draw the motif alone, without the tinted tile. */
  flat?: boolean;
}) {
  const color = kindColor(kind);
  const glyph = (
    <svg
      width={Math.round(size * 0.62)}
      height={Math.round(size * 0.62)}
      viewBox="0 0 16 16"
      fill="none"
      stroke={color}
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {MOTIF[kind] ?? MOTIF.other}
    </svg>
  );

  if (flat) return glyph;

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(4, size * 0.22),
        background: `color-mix(in oklab, ${color} 13%, transparent)`,
        border: `1px solid color-mix(in oklab, ${color} 26%, transparent)`,
      }}
    >
      {glyph}
    </span>
  );
}

/** The monospace extension tag shown next to a name. */
export function ExtensionChip({ extension, kind }: { extension: string | null; kind: FileKind }) {
  if (!extension) return null;
  const color = kindColor(kind);
  return (
    <span
      className="chip"
      style={{
        color,
        background: `color-mix(in oklab, ${color} 12%, transparent)`,
      }}
    >
      {extension.length > 5 ? extension.slice(0, 5) : extension}
    </span>
  );
}

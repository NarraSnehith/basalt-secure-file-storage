/**
 * Procedural columnar basalt.
 *
 * Real basalt cracks into irregular columns of uneven height as it cools. The
 * geometry here is generated from a seeded PRNG rather than drawn by hand, so
 * every surface it decorates gets its own formation while staying on-brand —
 * and it costs a few hundred bytes instead of a stock illustration.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ColumnArtProps {
  seed?: number;
  columns?: number;
  className?: string;
  /** 'side' draws the cliff face, 'top' the hexagonal pavement. */
  variant?: 'side' | 'top';
}

export function ColumnArt({ seed = 7, columns = 26, className, variant = 'side' }: ColumnArtProps) {
  const random = mulberry32(seed);

  if (variant === 'top') {
    // A hexagonal pavement, offset row by row like the real thing.
    const cells: Array<{ x: number; y: number; opacity: number; r: number }> = [];
    const radius = 15;
    const stepX = radius * 1.74;
    const stepY = radius * 1.5;
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        cells.push({
          x: col * stepX + (row % 2 ? stepX / 2 : 0),
          y: row * stepY,
          opacity: 0.06 + random() * 0.5,
          r: radius * (0.86 + random() * 0.14),
        });
      }
    }
    const hex = (cx: number, cy: number, r: number) =>
      Array.from({ length: 6 }, (_, i) => {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        return `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`;
      }).join(' ');

    return (
      <svg viewBox="0 0 380 380" className={className} aria-hidden preserveAspectRatio="xMidYMid slice">
        {cells.map((cell, i) => (
          <polygon
            key={i}
            points={hex(cell.x, cell.y, cell.r)}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            opacity={cell.opacity}
          />
        ))}
      </svg>
    );
  }

  const width = 400;
  const height = 560;
  const colWidth = width / columns;

  const bars = Array.from({ length: columns }, (_, i) => {
    const top = 90 + random() * 300;
    const shade = 0.05 + random() * 0.42;
    // Occasional columns are snapped off short, as in a weathered face.
    const broken = random() > 0.86;
    return { x: i * colWidth, top: broken ? top + 90 : top, shade, broken };
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="basalt-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
          <stop offset="45%" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
      </defs>
      <g>
        {bars.map((bar, i) => (
          <g key={i}>
            <rect
              x={bar.x}
              y={bar.top}
              width={colWidth - 0.9}
              height={height - bar.top}
              fill="url(#basalt-fade)"
              opacity={bar.shade}
            />
            {/* the fracture between neighbouring columns */}
            <line
              x1={bar.x + colWidth - 0.9}
              y1={bar.top}
              x2={bar.x + colWidth - 0.9}
              y2={height}
              stroke="currentColor"
              strokeWidth="0.6"
              opacity={0.28}
            />
            {/* the cooled cap */}
            <line
              x1={bar.x}
              y1={bar.top}
              x2={bar.x + colWidth - 0.9}
              y2={bar.top}
              stroke="currentColor"
              strokeWidth={bar.broken ? 1.4 : 0.9}
              opacity={bar.broken ? 0.7 : 0.42}
            />
          </g>
        ))}
      </g>
    </svg>
  );
}

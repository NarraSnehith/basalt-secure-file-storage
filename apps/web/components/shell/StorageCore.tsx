'use client';

import { formatBytes, splitBytes } from '@/lib/format';
import { KIND_LABEL, kindColor, isKind } from '@/lib/kinds';
import type { StorageStats } from '@/lib/types';

/**
 * The core sample.
 *
 * A geologist reads a drilled core from the bottom up: oldest layer first, each
 * band's thickness telling you how much of it there is. This is the same idea
 * for a disk quota — one glance says both "how full" and "full of what", which a
 * plain progress bar cannot. The used portion keeps a minimum visible height so
 * a nearly-empty account still shows its composition; the number beside it is
 * always the truth.
 */
export function StorageCore({ stats, compact = false }: { stats: StorageStats | null; compact?: boolean }) {
  if (!stats) {
    return <div className="skeleton h-24 w-full rounded-md" aria-hidden />;
  }

  const { quotaBytes, usedBytes, strata } = stats;
  const ratio = quotaBytes > 0 ? Math.min(1, usedBytes / quotaBytes) : 0;
  const percent = ratio * 100;
  // Below ~4% the bands would be sub-pixel; lift the floor so the composition
  // stays readable and let the label carry the exact figure.
  const filled = usedBytes > 0 ? Math.max(0.045, ratio) : 0;
  // Shorter in the rail, where vertical space is contested by the folder tree.
  const height = compact ? 84 : 124;
  const usedHeight = filled * height;
  const totalStrata = strata.reduce((n, s) => n + s.bytes, 0) || 1;
  const used = splitBytes(usedBytes);

  let offset = 0;
  const bands = strata.map((layer) => {
    const bandHeight = (layer.bytes / totalStrata) * usedHeight;
    const y = height - usedHeight + offset;
    offset += bandHeight;
    return { ...layer, y, height: bandHeight };
  });

  return (
    <div>
      <div className="flex items-start gap-3">
        <svg width={26} height={height} className="shrink-0 overflow-visible" aria-hidden>
          <defs>
            <pattern id="core-hatch" width="5" height="5" patternTransform="rotate(35)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="5" stroke="var(--line-strong)" strokeWidth="1" />
            </pattern>
            <clipPath id="core-shape">
              <rect x="0.5" y="0.5" width="25" height={height - 1} rx="4" />
            </clipPath>
          </defs>

          <g clipPath="url(#core-shape)">
            {/* unused capacity */}
            <rect x="0" y="0" width="26" height={height} fill="url(#core-hatch)" opacity="0.32" />
            {/* the strata */}
            {bands.map((band) => (
              <rect
                key={band.kind}
                x="0"
                y={band.y}
                width="26"
                height={Math.max(1, band.height)}
                fill={kindColor(band.kind)}
                opacity="0.82"
              />
            ))}
            {/* fracture lines between layers */}
            {bands.slice(1).map((band) => (
              <line
                key={`line-${band.kind}`}
                x1="0"
                y1={band.y}
                x2="26"
                y2={band.y}
                stroke="var(--panel)"
                strokeWidth="0.75"
                opacity="0.8"
              />
            ))}
          </g>

          <rect x="0.5" y="0.5" width="25" height={height - 1} rx="4" fill="none" stroke="var(--line-strong)" />
          {/* the fill level */}
          {usedBytes > 0 ? (
            <line
              x1="-2"
              y1={height - usedHeight}
              x2="28"
              y2={height - usedHeight}
              stroke="var(--accent)"
              strokeWidth="1.25"
            />
          ) : null}
        </svg>

        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-1">
            <span className="tnum text-[1.375rem] leading-none font-medium">{used.value}</span>
            <span className="text-[0.75rem]" style={{ color: 'var(--text-dim)' }}>
              {used.unit}
            </span>
          </p>
          <p className="meta mt-1">
            of {formatBytes(quotaBytes, 0)} · {percent < 0.1 && usedBytes > 0 ? '<0.1' : percent.toFixed(percent < 10 ? 1 : 0)}%
          </p>

          <ul className="mt-2 space-y-1">
              {strata.slice(0, compact ? 3 : 5).map((layer) => (
                <li key={layer.kind} className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-[2px]"
                    style={{ background: kindColor(layer.kind) }}
                    aria-hidden
                  />
                  <span className="flex-1 truncate text-[0.6875rem]" style={{ color: 'var(--text-dim)' }}>
                    {isKind(layer.kind) ? KIND_LABEL[layer.kind] : layer.kind}
                  </span>
                  <span className="meta">{formatBytes(layer.bytes)}</span>
                </li>
              ))}
              {strata.length === 0 ? (
                <li className="text-[0.6875rem]" style={{ color: 'var(--text-faint)' }}>
                  Nothing stored yet.
                </li>
              ) : null}
              {compact && strata.length > 3 ? (
                <li className="meta">+{strata.length - 3} more</li>
              ) : null}
            </ul>
        </div>
      </div>

      {stats.trashBytes > 0 ? (
        <p className="meta mt-2.5">{formatBytes(stats.trashBytes)} recoverable in trash</p>
      ) : null}
    </div>
  );
}

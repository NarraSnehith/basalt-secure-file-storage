/**
 * The mark: a basalt column seen from above — the hexagon that forms when a
 * lava flow cools and contracts — with the cooling fractures running through it.
 */
export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label="Basalt"
      fill="none"
    >
      <path
        d="M12 1.6l9 5.2v10.4l-9 5.2-9-5.2V6.8l9-5.2z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* cooling fractures */}
      <path d="M12 1.6v20.8" stroke="currentColor" strokeWidth="0.9" opacity="0.45" />
      <path d="M3 6.8l9 5.2 9-5.2" stroke="currentColor" strokeWidth="0.9" opacity="0.45" />
      <circle cx="12" cy="12" r="1.55" fill="var(--accent)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      <Logo />
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.0625rem',
          letterSpacing: '-0.01em',
          lineHeight: 1,
        }}
      >
        Basalt
      </span>
    </span>
  );
}

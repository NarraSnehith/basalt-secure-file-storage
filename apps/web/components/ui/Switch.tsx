'use client';

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  busy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-[1.125rem] w-8 shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
      style={{
        background: checked ? 'var(--accent)' : 'var(--line-strong)',
        transitionDuration: '150ms',
      }}
    >
      <span
        className="absolute h-3.5 w-3.5 rounded-full transition-transform"
        style={{
          background: checked ? 'var(--accent-ink)' : 'var(--panel)',
          transform: checked ? 'translateX(1.0625rem)' : 'translateX(0.125rem)',
          transitionDuration: '150ms',
          transitionTimingFunction: 'var(--ease-out-quint)',
          opacity: busy ? 0.5 : 1,
        }}
      />
    </button>
  );
}

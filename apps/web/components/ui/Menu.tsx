'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useClickOutside } from '@/lib/hooks';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  /** Renders a divider above this item. */
  separated?: boolean;
}

/**
 * Dropdown menu. Positions itself against the viewport so a row near the bottom
 * of a long list opens upward instead of off-screen, and supports arrow-key
 * navigation like a native menu.
 */
export function Menu({
  trigger,
  items,
  align = 'end',
  width = 12,
}: {
  trigger: (props: { open: boolean; toggle: () => void; ref: (node: HTMLElement | null) => void }) => ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'below' | 'above'>('below');
  const [active, setActive] = useState(0);
  const anchor = useRef<HTMLElement | null>(null);
  const container = useClickOutside<HTMLDivElement>(() => setOpen(false), open);
  const enabled = items.filter((item) => !item.disabled);

  useEffect(() => {
    if (!open || !anchor.current) return;
    const rect = anchor.current.getBoundingClientRect();
    const estimatedHeight = items.length * 30 + 16;
    setPlacement(rect.bottom + estimatedHeight > window.innerHeight - 12 ? 'above' : 'below');
    setActive(0);
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((current) => {
          const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
          return (next + enabled.length) % enabled.length;
        });
      } else if (event.key === 'Enter') {
        event.preventDefault();
        enabled[active]?.onSelect?.();
        setOpen(false);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, active, enabled]);

  return (
    <div ref={container} className="relative inline-flex">
      {trigger({
        open,
        toggle: () => setOpen((v) => !v),
        ref: (node) => {
          anchor.current = node;
        },
      })}
      {open ? (
        <div
          role="menu"
          className="sheet animate-rise absolute z-50 p-1"
          style={{
            width: `${width}rem`,
            [align === 'end' ? 'right' : 'left']: 0,
            ...(placement === 'below' ? { top: 'calc(100% + 4px)' } : { bottom: 'calc(100% + 4px)' }),
          }}
        >
          {items.map((item, index) => {
            const enabledIndex = enabled.indexOf(item);
            return (
              <div key={`${item.label}-${index}`}>
                {item.separated ? <div className="my-1 h-px" style={{ background: 'var(--line)' }} /> : null}
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  data-danger={item.danger ? 'true' : undefined}
                  disabled={item.disabled}
                  style={enabledIndex === active && !item.disabled ? { background: 'var(--hover)', color: 'var(--text)' } : undefined}
                  onMouseEnter={() => enabledIndex >= 0 && setActive(enabledIndex)}
                  onClick={() => {
                    item.onSelect?.();
                    setOpen(false);
                  }}
                >
                  {item.icon ? <span className="shrink-0 opacity-70">{item.icon}</span> : null}
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.hint ? <span className="meta shrink-0">{item.hint}</span> : null}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

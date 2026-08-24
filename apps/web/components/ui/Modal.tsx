'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { IconClose } from './icons';

/**
 * Dialog primitive. Traps focus, restores it on close, locks the page behind it
 * and closes on Escape or a backdrop click — the behaviours people expect and
 * that a bare <div> overlay always forgets.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 30,
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** rem */
  width?: number;
  closeOnBackdrop?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const focusable = panel.current?.querySelectorAll<HTMLElement>(
      'input:not([type=hidden]), textarea, select, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const nodes = [
        ...panel.current.querySelectorAll<HTMLElement>(
          'input:not([type=hidden]), textarea, select, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((node) => node.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="animate-fade fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-4 pt-[10vh] sm:p-6 sm:pt-[12vh]"
      style={{ background: 'color-mix(in oklab, var(--page) 74%, transparent)', backdropFilter: 'blur(3px)' }}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sheet animate-rise w-full"
        style={{ maxWidth: `${width}rem` }}
      >
        <header className="flex items-start gap-3 px-4 pt-3.5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[0.9375rem] leading-tight font-medium">{title}</h2>
            {description ? (
              <p className="mt-1 text-[0.8125rem] leading-snug" style={{ color: 'var(--text-dim)' }}>
                {description}
              </p>
            ) : null}
          </div>
          <button type="button" className="btn btn-sm btn-ghost btn-icon -mr-1 -mt-0.5" onClick={onClose} aria-label="Close">
            <IconClose size={13} />
          </button>
        </header>
        <div className="px-4 pb-4">{children}</div>
        {footer ? (
          <footer
            className="flex items-center justify-end gap-2 px-4 py-3"
            style={{ borderTop: '1px solid var(--line)', background: 'var(--panel-2)', borderRadius: '0 0 12px 12px' }}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

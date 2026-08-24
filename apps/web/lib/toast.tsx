'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type ToastTone = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

interface ToastApi {
  show: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  info: (title: string, detail?: string) => void;
  /** For destructive actions: a toast that can put things back. */
  undoable: (title: string, undo: () => void, detail?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_COLOR: Record<ToastTone, string> = {
  info: 'var(--text-faint)',
  success: 'var(--color-moss)',
  error: 'var(--color-rust)',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-3), { ...toast, id }]);
      // Errors and undoable actions linger; plain confirmations get out of the way.
      const ttl = toast.tone === 'error' ? 7000 : toast.action ? 6500 : 3200;
      setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, detail) => show({ tone: 'success', title, ...(detail ? { detail } : {}) }),
      error: (title, detail) => show({ tone: 'error', title, ...(detail ? { detail } : {}) }),
      info: (title, detail) => show({ tone: 'info', title, ...(detail ? { detail } : {}) }),
      undoable: (title, undo, detail) =>
        show({ tone: 'info', title, ...(detail ? { detail } : {}), action: { label: 'Undo', run: undo } }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 left-1/2 z-[90] flex w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="animate-rise sheet pointer-events-auto flex items-start gap-3 px-3 py-2.5"
            style={{ borderLeft: `2px solid ${TONE_COLOR[toast.tone]}` }}
          >
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] leading-tight">{toast.title}</p>
              {toast.detail ? (
                <p className="mt-1 text-[0.75rem] leading-snug" style={{ color: 'var(--text-faint)' }}>
                  {toast.detail}
                </p>
              ) : null}
            </div>
            {toast.action ? (
              <button
                type="button"
                className="btn btn-sm btn-outline shrink-0"
                onClick={() => {
                  toast.action!.run();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Dismiss"
              className="btn btn-sm btn-ghost btn-icon shrink-0"
              onClick={() => dismiss(toast.id)}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}

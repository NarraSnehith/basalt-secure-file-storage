'use client';

import { useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { IconSpinner } from './icons';

/**
 * Confirmation for anything irreversible. `requirePhrase` demands the user type
 * an exact string first — reserved for actions with no undo, like emptying the
 * trash or deleting an account.
 */
export function Confirm({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  requirePhrase,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requirePhrase?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const blocked = Boolean(requirePhrase) && typed.trim() !== requirePhrase;

  const run = async () => {
    if (blocked) return;
    setBusy(true);
    try {
      await onConfirm();
      onClose();
      setTyped('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={26}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={run}
            disabled={busy || blocked}
          >
            {busy ? <IconSpinner size={13} /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-[0.8125rem] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
        {body}
      </div>
      {requirePhrase ? (
        <div className="mt-3">
          <label className="label">
            Type <span style={{ color: 'var(--text)' }}>{requirePhrase}</span> to confirm
          </label>
          <input
            className="field"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void run();
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      ) : null}
    </Modal>
  );
}

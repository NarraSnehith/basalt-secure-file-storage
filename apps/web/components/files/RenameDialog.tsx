'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { splitName } from '@/lib/format';
import { useVault } from '@/lib/vault-context';
import { Modal } from '@/components/ui/Modal';
import type { StoredFile } from '@/lib/types';

/**
 * Rename. Pre-selects the stem and leaves the extension alone — changing
 * ".pdf" to ".pdff" by accident is the classic rename bug.
 */
export function RenameDialog({ file, onClose }: { file: StoredFile; onClose: () => void }) {
  const { rename } = useVault();
  const { stem, ext } = splitName(file.name);
  const [value, setValue] = useState(file.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const node = input.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(0, stem.length);
  }, [stem.length]);

  const submit = async () => {
    const next = value.trim();
    if (!next || next === file.name) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rename(file.id, next);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? (err.field('name') ?? err.message) : 'Could not rename.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Rename file"
      width={26}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !value.trim()}>
            Rename
          </button>
        </>
      }
    >
      <input
        ref={input}
        className={`field ${error ? 'field-error' : ''}`}
        value={value}
        maxLength={255}
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void submit();
        }}
      />
      {error ? (
        <p className="mt-1.5 text-[0.75rem]" style={{ color: 'var(--color-rust)' }} role="alert">
          {error}
        </p>
      ) : (
        <p className="mt-1.5 text-[0.75rem]" style={{ color: 'var(--text-faint)' }}>
          {ext ? `Keep the .${ext} extension so it opens in the right app.` : 'Slashes and control characters are removed automatically.'}
        </p>
      )}
    </Modal>
  );
}

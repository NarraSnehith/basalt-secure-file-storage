'use client';

import { useState } from 'react';
import { formatBytes, pluralise } from '@/lib/format';
import { fileContentUrl } from '@/lib/api';
import { useVault } from '@/lib/vault-context';
import { Confirm } from '@/components/ui/Confirm';
import { IconClose, IconDownload, IconMove, IconRestore, IconStar, IconTrash } from '@/components/ui/icons';

/**
 * Floating action bar for a multi-selection. Sits above the list rather than
 * replacing the header, so the breadcrumb and search stay put while you work.
 */
export function SelectionBar({ onMove }: { onMove: (ids: string[]) => void }) {
  const { selected, files, clearSelection, trash, restore, purge, star, scope } = useVault();
  const [confirmPurge, setConfirmPurge] = useState(false);

  if (selected.length === 0) return null;

  const chosen = files.filter((f) => selected.includes(f.id));
  const bytes = chosen.reduce((n, f) => n + f.sizeBytes, 0);
  const allStarred = chosen.every((f) => f.starred);

  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-40 -translate-x-1/2 px-4">
      <div className="sheet animate-rise pointer-events-auto flex items-center gap-1 py-1.5 pr-1.5 pl-3">
        <span className="mr-1 text-[0.8125rem] whitespace-nowrap">
          {pluralise(selected.length, 'file')}
          <span className="meta ml-2">{formatBytes(bytes)}</span>
        </span>

        {scope === 'trash' ? (
          <>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void restore(selected)}>
              <IconRestore size={13} />
              Restore
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmPurge(true)}>
              <IconTrash size={13} />
              Delete
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                for (const file of chosen) {
                  window.open(fileContentUrl(file.id, 'attachment'), '_blank');
                }
              }}
            >
              <IconDownload size={13} />
              <span className="hidden sm:inline">Download</span>
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onMove(selected)}>
              <IconMove size={13} />
              <span className="hidden sm:inline">Move</span>
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void star(selected, !allStarred)}>
              <IconStar size={13} filled={allStarred} />
              <span className="hidden sm:inline">{allStarred ? 'Unstar' : 'Star'}</span>
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void trash(selected)}>
              <IconTrash size={13} />
              <span className="hidden sm:inline">Trash</span>
            </button>
          </>
        )}

        <span className="mx-1 h-5 w-px" style={{ background: 'var(--line)' }} />
        <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={clearSelection} aria-label="Clear selection">
          <IconClose size={13} />
        </button>
      </div>

      <Confirm
        open={confirmPurge}
        onClose={() => setConfirmPurge(false)}
        onConfirm={() => purge(selected)}
        title={`Delete ${pluralise(selected.length, 'file')} permanently?`}
        body="The bytes are removed from storage immediately. This cannot be undone."
        confirmLabel="Delete permanently"
        danger
      />
    </div>
  );
}

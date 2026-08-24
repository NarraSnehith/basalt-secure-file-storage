'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCopy, useHotkeys } from '@/lib/hooks';
import { useToast } from '@/lib/toast';
import { requestNewFolder } from '@/lib/ui-events';
import { useVault, type SortBy } from '@/lib/vault-context';
import { pluralise } from '@/lib/format';
import { Confirm } from '@/components/ui/Confirm';
import { IconChevron, IconSpinner, IconUpload } from '@/components/ui/icons';
import type { StoredFile } from '@/lib/types';
import { EmptyState } from './EmptyState';
import { FileCard } from './FileCard';
import { FileRow, type RowActions } from './FileRow';
import { MoveDialog } from './MoveDialog';
import { PreviewOverlay } from './PreviewOverlay';
import { RenameDialog } from './RenameDialog';
import { SelectionBar } from './SelectionBar';

const COLUMNS: Array<{ key: SortBy; label: string; className: string }> = [
  { key: 'size', label: 'Size', className: 'hidden w-[4.5rem] text-right md:block' },
  { key: 'updated', label: 'Modified', className: 'hidden w-[6rem] text-right lg:block' },
];

/**
 * The list itself, plus everything that opens on top of it.
 *
 * Selection, keyboard shortcuts and the dialogs live here rather than in each
 * page, so /vault, /starred and /trash are three lines each and behave
 * identically.
 */
export function FileBrowser({ emptyState }: { emptyState?: { title: string; body: string; seed?: number } }) {
  const vault = useVault();
  const toast = useToast();
  const [, copy] = useCopy();
  const [preview, setPreview] = useState<StoredFile | null>(null);
  const [sharing, setSharing] = useState<StoredFile | null>(null);
  const [renaming, setRenaming] = useState<StoredFile | null>(null);
  const [moving, setMoving] = useState<string[] | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [dropping, setDropping] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [ShareSheetLazy, setShareSheetLazy] = useState<React.ComponentType<{ file: StoredFile; onClose: () => void }> | null>(null);

  // The share sheet is heavier than a row and only needed on demand.
  useEffect(() => {
    if (sharing && !ShareSheetLazy) {
      void import('./ShareSheet').then((mod) => setShareSheetLazy(() => mod.ShareSheet));
    }
  }, [sharing, ShareSheetLazy]);

  const actions = useMemo<RowActions>(
    () => ({
      onPreview: (file) => setPreview(file),
      onShare: (file) => setSharing(file),
      onRename: (file) => setRenaming(file),
      onMove: (ids) => setMoving(ids),
      onDetails: (file) => setPreview(file),
      onCopyLink: (file) => {
        if (file.publicUrl) {
          void copy(file.publicUrl);
          toast.success('Link copied');
        }
      },
    }),
    [copy, toast],
  );

  // Infinite scroll: fetch the next page when the sentinel comes into view.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !vault.hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void vault.loadMore();
      },
      { rootMargin: '320px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [vault.hasMore, vault.loadMore, vault]);

  const focused = vault.selected.length === 1 ? vault.files.find((f) => f.id === vault.selected[0]) : undefined;
  const overlayOpen = Boolean(preview || sharing || renaming || moving);

  const stepSelection = useCallback(
    (delta: number) => {
      const list = vault.files;
      if (list.length === 0) return;
      const at = focused ? list.findIndex((f) => f.id === focused.id) : -1;
      const next = list[Math.max(0, Math.min(list.length - 1, at + delta))];
      if (next) vault.toggleSelect(next.id, 'single');
    },
    [focused, vault],
  );

  useHotkeys(
    {
      j: () => stepSelection(1),
      ArrowDown: () => stepSelection(1),
      k: () => stepSelection(-1),
      ArrowUp: () => stepSelection(-1),
      ' ': () => {
        if (focused) setPreview(focused);
      },
      Enter: () => {
        if (focused) setPreview(focused);
      },
      'mod+a': () => vault.selectAll(),
      Escape: () => vault.clearSelection(),
      r: () => {
        if (focused && vault.scope !== 'trash') setRenaming(focused);
      },
      s: () => {
        if (focused && vault.scope !== 'trash') setSharing(focused);
      },
      m: () => {
        if (vault.selected.length && vault.scope !== 'trash') setMoving(vault.selected);
      },
      u: () => fileInput.current?.click(),
      n: () => requestNewFolder(),
      Backspace: () => {
        if (vault.selected.length === 0) return;
        if (vault.scope === 'trash') void vault.purge(vault.selected);
        else void vault.trash(vault.selected);
      },
      Delete: () => {
        if (vault.selected.length === 0) return;
        if (vault.scope === 'trash') void vault.purge(vault.selected);
        else void vault.trash(vault.selected);
      },
    },
    { enabled: !overlayOpen },
  );

  const isEmpty = !vault.loading && vault.files.length === 0;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropping(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDropping(false);
        const dropped = Array.from(event.dataTransfer.files);
        if (dropped.length) vault.upload(dropped);
      }}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const chosen = Array.from(event.target.files ?? []);
          if (chosen.length) vault.upload(chosen);
          event.target.value = '';
        }}
      />

      {vault.scope === 'trash' && vault.files.length > 0 ? (
        <div className="flex items-center justify-between px-3 py-2 sm:px-5" style={{ borderBottom: '1px solid var(--line)' }}>
          <p className="text-[0.75rem]" style={{ color: 'var(--text-dim)' }}>
            {pluralise(vault.total ?? vault.files.length, 'file')} waiting to be purged.
          </p>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmEmpty(true)}>
            Empty trash
          </button>
        </div>
      ) : null}

      {vault.view === 'list' && !isEmpty ? (
        <div
          className="sticky z-20 grid items-center gap-3 px-3 sm:px-5"
          style={{
            top: 0,
            gridTemplateColumns: 'auto 1fr auto',
            height: '2rem',
            background: 'var(--page)',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              aria-label="Select all"
              className="h-3.5 w-3.5 accent-[var(--accent)]"
              checked={vault.files.length > 0 && vault.selected.length === vault.files.length}
              onChange={(event) => (event.target.checked ? vault.selectAll() : vault.clearSelection())}
            />
            <span className="w-[26px]" />
          </div>
          <button type="button" className="flex items-center gap-1 text-left" onClick={() => vault.setSort('name')}>
            <span className="eyebrow">Name</span>
            <SortMark active={vault.sortBy === 'name'} dir={vault.sortDir} />
          </button>
          <div className="flex items-center gap-3">
            {COLUMNS.map((column) => (
              <button
                key={column.key}
                type="button"
                className={`flex items-center justify-end gap-1 ${column.className}`}
                onClick={() => vault.setSort(column.key)}
              >
                <span className="eyebrow">{column.label}</span>
                <SortMark active={vault.sortBy === column.key} dir={vault.sortDir} />
              </button>
            ))}
            <span className="eyebrow hidden w-[4.5rem] text-right xl:block">Kind</span>
            <span className="w-[4.375rem]" />
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {vault.error ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[0.875rem]" style={{ color: 'var(--color-rust)' }}>
              {vault.error}
            </p>
            <button type="button" className="btn btn-outline mt-4" onClick={() => void vault.refresh()}>
              Try again
            </button>
          </div>
        ) : vault.loading ? (
          <div className="space-y-px p-3 sm:p-5">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="skeleton h-9 rounded-md" style={{ opacity: 1 - i * 0.1 }} />
            ))}
          </div>
        ) : isEmpty ? (
          <EmptyState
            title={emptyState?.title ?? (vault.query ? 'Nothing matched' : 'This folder is empty')}
            body={
              emptyState?.body ??
              (vault.query
                ? `No file names contain “${vault.query}”. Search covers every folder, so it is not hiding elsewhere.`
                : 'Drop files anywhere on this page, or use the upload button.')
            }
            seed={emptyState?.seed ?? 11}
            action={
              !vault.query && vault.scope !== 'trash' ? (
                <button type="button" className="btn btn-primary" onClick={() => fileInput.current?.click()}>
                  <IconUpload size={14} />
                  Choose files
                </button>
              ) : null
            }
          />
        ) : vault.view === 'list' ? (
          <div role="table" className="pb-24">
            {vault.files.map((file) => (
              <FileRow key={file.id} file={file} actions={actions} />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 p-3 pb-24 sm:p-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(9.5rem, 1fr))' }}>
            {vault.files.map((file) => (
              <FileCard key={file.id} file={file} actions={actions} />
            ))}
          </div>
        )}

        <div ref={sentinel} className="flex h-12 items-center justify-center">
          {vault.loadingMore ? (
            <span className="meta flex items-center gap-2">
              <IconSpinner size={12} /> loading more
            </span>
          ) : null}
        </div>
      </div>

      {dropping ? (
        <div
          className="animate-fade pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-lg"
          style={{
            border: '1.5px dashed var(--accent)',
            background: 'color-mix(in oklab, var(--accent) 8%, transparent)',
            backdropFilter: 'blur(1px)',
          }}
        >
          <div className="text-center">
            <IconUpload size={22} style={{ color: 'var(--accent)' }} />
            <p className="mt-2 text-[0.875rem]">Release to store</p>
            <p className="meta mt-1">
              {vault.folderId ? 'into this folder' : 'at the root of your drive'}
            </p>
          </div>
        </div>
      ) : null}

      <SelectionBar onMove={(ids) => setMoving(ids)} />

      {preview ? <PreviewOverlay file={preview} onClose={() => setPreview(null)} onShare={(f) => { setPreview(null); setSharing(f); }} /> : null}
      {sharing && ShareSheetLazy ? <ShareSheetLazy file={sharing} onClose={() => setSharing(null)} /> : null}
      {renaming ? <RenameDialog file={renaming} onClose={() => setRenaming(null)} /> : null}
      {moving ? <MoveDialog ids={moving} onClose={() => setMoving(null)} /> : null}

      <Confirm
        open={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        onConfirm={() => vault.emptyTrash()}
        title="Empty the trash?"
        body="Every file in the trash is deleted from storage immediately and the space is returned to your quota. This cannot be undone."
        confirmLabel="Empty trash"
        requirePhrase="empty trash"
        danger
      />
    </div>
  );
}

function SortMark({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return null;
  return <IconChevron size={10} dir={dir === 'asc' ? 'up' : 'down'} style={{ color: 'var(--accent)' }} />;
}

'use client';

import { useRef } from 'react';
import { formatBytes, formatDate, relativeTime, splitName } from '@/lib/format';
import { KIND_NOUN } from '@/lib/kinds';
import { fileContentUrl } from '@/lib/api';
import { useVault } from '@/lib/vault-context';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { IconMore, IconStar } from '@/components/ui/icons';
import type { StoredFile } from '@/lib/types';
import { Badges } from './Badges';
import { KindGlyph, ExtensionChip } from './KindGlyph';

export interface RowActions {
  onPreview: (file: StoredFile) => void;
  onShare: (file: StoredFile) => void;
  onRename: (file: StoredFile) => void;
  onMove: (ids: string[]) => void;
  onDetails: (file: StoredFile) => void;
  onCopyLink: (file: StoredFile) => void;
}

export function rowMenuItems(file: StoredFile, actions: RowActions, vault: ReturnType<typeof useVault>): MenuItem[] {
  if (vault.scope === 'trash') {
    return [
      { label: 'Restore', onSelect: () => void vault.restore([file.id]) },
      { label: 'Delete permanently', danger: true, separated: true, onSelect: () => void vault.purge([file.id]) },
    ];
  }
  return [
    { label: file.previewable ? 'Preview' : 'Open details', hint: 'Space', onSelect: () => actions.onPreview(file) },
    { label: 'Download', onSelect: () => window.open(fileContentUrl(file.id, 'attachment'), '_blank') },
    { label: 'Share…', hint: 'S', separated: true, onSelect: () => actions.onShare(file) },
    ...(file.publicUrl ? [{ label: 'Copy public link', onSelect: () => actions.onCopyLink(file) }] : []),
    { label: 'Rename…', hint: 'R', separated: true, onSelect: () => actions.onRename(file) },
    { label: 'Move to…', hint: 'M', onSelect: () => actions.onMove([file.id]) },
    { label: file.starred ? 'Remove star' : 'Star', onSelect: () => void vault.star([file.id], !file.starred) },
    { label: 'File details', onSelect: () => actions.onDetails(file) },
    { label: 'Move to trash', danger: true, separated: true, onSelect: () => void vault.trash([file.id]) },
  ];
}

export function FileRow({ file, actions }: { file: StoredFile; actions: RowActions }) {
  const vault = useVault();
  const selected = vault.isSelected(file.id);
  const { stem } = splitName(file.name);
  const openMenu = useRef<(() => void) | null>(null);

  const dragIds = selected && vault.selected.length > 1 ? vault.selected : [file.id];

  return (
    <div
      role="row"
      tabIndex={0}
      aria-selected={selected}
      data-selected={selected}
      className="row grid cursor-default items-center gap-3 px-3 sm:px-5"
      style={{ gridTemplateColumns: 'auto 1fr auto', height: '2.75rem' }}
      draggable={vault.scope !== 'trash'}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-basalt-files', JSON.stringify(dragIds));
        event.dataTransfer.effectAllowed = 'move';
      }}
      onClick={(event) => {
        const mode = event.metaKey || event.ctrlKey ? 'toggle' : event.shiftKey ? 'range' : 'single';
        vault.toggleSelect(file.id, mode);
      }}
      onDoubleClick={() => actions.onPreview(file)}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!selected) vault.toggleSelect(file.id, 'single');
        openMenu.current?.();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') actions.onPreview(file);
      }}
    >
      <div className="flex items-center gap-3">
        <label className="flex h-full cursor-pointer items-center" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => vault.toggleSelect(file.id, 'toggle')}
            aria-label={`Select ${file.name}`}
            className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
          />
        </label>
        <KindGlyph kind={file.kind} size={26} />
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[0.8125rem] leading-none" title={file.name}>
          {stem}
        </span>
        <ExtensionChip extension={file.extension} kind={file.kind} />
        <Badges file={file} />
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-3">
        {vault.scope === 'trash' && file.purgeAfter ? (
          <span className="meta hidden sm:inline" title={`Deleted permanently ${formatDate(file.purgeAfter)}`}>
            purges {relativeTime(file.purgeAfter)}
          </span>
        ) : (
          <>
            <span className="meta hidden w-[4.5rem] text-right md:inline">{formatBytes(file.sizeBytes)}</span>
            <span className="meta hidden w-[6rem] text-right lg:inline" title={formatDate(file.updatedAt)}>
              {relativeTime(file.updatedAt)}
            </span>
            <span className="meta hidden w-[4.5rem] text-right xl:inline">{KIND_NOUN[file.kind]}</span>
          </>
        )}

        <button
          type="button"
          aria-label={file.starred ? 'Remove star' : 'Star'}
          className="btn btn-sm btn-ghost btn-icon"
          style={{ color: file.starred ? 'var(--color-clay)' : 'var(--text-faint)' }}
          onClick={(event) => {
            event.stopPropagation();
            void vault.star([file.id], !file.starred);
          }}
        >
          <IconStar size={13} filled={file.starred} />
        </button>

        <Menu
          width={13}
          items={rowMenuItems(file, actions, vault)}
          trigger={({ toggle, ref }) => {
            openMenu.current = toggle;
            return (
              <button
                ref={ref}
                type="button"
                aria-label={`Actions for ${file.name}`}
                className="btn btn-sm btn-ghost btn-icon"
                onClick={(event) => {
                  event.stopPropagation();
                  toggle();
                }}
              >
                <IconMore size={14} />
              </button>
            );
          }}
        />
      </div>
    </div>
  );
}

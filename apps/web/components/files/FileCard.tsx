'use client';

import { useRef } from 'react';
import { formatBytes, relativeTime, truncateMiddle } from '@/lib/format';
import { fileContentUrl } from '@/lib/api';
import { useVault } from '@/lib/vault-context';
import { Menu } from '@/components/ui/Menu';
import { IconMore, IconStar } from '@/components/ui/icons';
import type { StoredFile } from '@/lib/types';
import { Badges } from './Badges';
import { KindGlyph, ExtensionChip } from './KindGlyph';
import { rowMenuItems, type RowActions } from './FileRow';

/** Grid tile. Images show themselves; everything else shows its mark. */
export function FileCard({ file, actions }: { file: StoredFile; actions: RowActions }) {
  const vault = useVault();
  const selected = vault.isSelected(file.id);
  const openMenu = useRef<(() => void) | null>(null);
  const showThumb = file.kind === 'image' && file.previewable && file.sizeBytes < 8_000_000;
  const dragIds = selected && vault.selected.length > 1 ? vault.selected : [file.id];

  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-[8px] transition-colors"
      style={{
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--line)'}`,
        background: selected ? 'var(--accent-wash)' : 'var(--panel)',
      }}
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
    >
      <div
        className="relative flex h-[7.5rem] items-center justify-center overflow-hidden"
        style={{ background: 'var(--panel-2)', borderBottom: '1px solid var(--line)' }}
      >
        {showThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fileContentUrl(file.id, 'inline')}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            style={{ opacity: 0.94 }}
          />
        ) : (
          <KindGlyph kind={file.kind} size={44} />
        )}

        <div className="absolute top-1.5 left-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100" style={selected ? { opacity: 1 } : undefined}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => vault.toggleSelect(file.id, 'toggle')}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Select ${file.name}`}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
        </div>

        <div className="absolute top-1 right-1 flex items-center opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            aria-label={file.starred ? 'Remove star' : 'Star'}
            className="btn btn-sm btn-ghost btn-icon"
            style={{ color: file.starred ? 'var(--color-clay)' : 'var(--text-dim)' }}
            onClick={(event) => {
              event.stopPropagation();
              void vault.star([file.id], !file.starred);
            }}
          >
            <IconStar size={12} filled={file.starred} />
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
                  <IconMore size={13} />
                </button>
              );
            }}
          />
        </div>

        {file.starred && !selected ? (
          <span className="absolute top-2 right-2 group-hover:hidden" style={{ color: 'var(--color-clay)' }}>
            <IconStar size={12} filled />
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 p-2.5">
        <div className="flex items-start gap-1.5">
          <span className="min-w-0 flex-1 text-[0.75rem] leading-snug" title={file.name}>
            {truncateMiddle(file.name, 34)}
          </span>
          <Badges file={file} />
        </div>
        <div className="flex items-center gap-1.5">
          <ExtensionChip extension={file.extension} kind={file.kind} />
          <span className="meta">{formatBytes(file.sizeBytes)}</span>
          <span className="meta ml-auto">{relativeTime(file.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

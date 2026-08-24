'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useState } from 'react';
import { formatBytes } from '@/lib/format';
import { childFolders, useVault } from '@/lib/vault-context';
import { Menu } from '@/components/ui/Menu';
import { IconChevron, IconFolder, IconFolderOpen, IconMore, IconPencil, IconTrash } from '@/components/ui/icons';
import type { Folder } from '@/lib/types';

/**
 * The folder tree, with drop targets.
 *
 * Dragging rows onto a folder is the fastest way to file things, so every node
 * here is a drop zone as well as a link — including a node that is collapsed.
 */
export function FolderTree({ onRename }: { onRename: (folder: Folder) => void }) {
  const { folders } = useVault();
  const roots = childFolders(folders, null);

  if (roots.length === 0) {
    return (
      <p className="px-2 py-1.5 text-[0.75rem]" style={{ color: 'var(--text-faint)' }}>
        No folders yet.
      </p>
    );
  }

  return (
    <ul className="space-y-px">
      {roots.map((folder) => (
        <TreeNode key={folder.id} folder={folder} depth={0} onRename={onRename} />
      ))}
    </ul>
  );
}

function TreeNode({
  folder,
  depth,
  onRename,
}: {
  folder: Folder;
  depth: number;
  onRename: (folder: Folder) => void;
}) {
  const { folders, move, moveFolder, trashFolder } = useVault();
  const params = useParams<{ id?: string }>();
  const pathname = usePathname();
  const [open, setOpen] = useState(depth === 0);
  const [dropping, setDropping] = useState(false);

  const children = childFolders(folders, folder.id);
  const active = pathname.startsWith('/vault/folder') && params?.id === folder.id;

  return (
    <li>
      <div
        className="rail-link group"
        data-active={active}
        style={{
          paddingLeft: `${0.375 + depth * 0.75}rem`,
          ...(dropping
            ? { background: 'var(--accent-wash)', boxShadow: 'inset 0 0 0 1px var(--accent)' }
            : {}),
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('application/x-basalt-files') || event.dataTransfer.types.includes('application/x-basalt-folder')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDropping(true);
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDropping(false);
          const fileIds = event.dataTransfer.getData('application/x-basalt-files');
          if (fileIds) {
            void move(JSON.parse(fileIds) as string[], folder.id);
            return;
          }
          const dragged = event.dataTransfer.getData('application/x-basalt-folder');
          if (dragged && dragged !== folder.id) void moveFolder(dragged, folder.id);
        }}
      >
        <button
          type="button"
          aria-label={open ? 'Collapse' : 'Expand'}
          aria-expanded={open}
          className="-ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] hover:bg-[var(--line)]"
          style={{ visibility: children.length ? 'visible' : 'hidden' }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          <IconChevron size={11} dir={open ? 'down' : 'right'} />
        </button>

        <Link
          href={`/vault/folder/${folder.id}`}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('application/x-basalt-folder', folder.id);
            event.dataTransfer.effectAllowed = 'move';
          }}
          className="flex min-w-0 flex-1 items-center gap-2"
          title={`${folder.name} — ${folder.fileCount} file${folder.fileCount === 1 ? '' : 's'}, ${formatBytes(folder.sizeBytes)}`}
        >
          <span style={{ color: active ? 'var(--accent)' : 'var(--text-faint)' }}>
            {open && children.length ? <IconFolderOpen size={14} /> : <IconFolder size={14} />}
          </span>
          <span className="truncate">{folder.name}</span>
          {folder.fileCount > 0 ? (
            <span className="meta ml-auto shrink-0 group-hover:hidden">{folder.fileCount}</span>
          ) : null}
        </Link>

        <span className="ml-auto hidden shrink-0 group-hover:block">
          <Menu
            width={11}
            items={[
              { label: 'Rename', icon: <IconPencil size={13} />, onSelect: () => onRename(folder) },
              {
                label: 'Move to trash',
                icon: <IconTrash size={13} />,
                danger: true,
                separated: true,
                onSelect: () => void trashFolder(folder.id),
              },
            ]}
            trigger={({ toggle, ref }) => (
              <button
                ref={ref}
                type="button"
                aria-label={`Options for ${folder.name}`}
                className="btn btn-sm btn-ghost btn-icon h-5 w-5"
                onClick={(event) => {
                  event.preventDefault();
                  toggle();
                }}
              >
                <IconMore size={13} />
              </button>
            )}
          />
        </span>
      </div>

      {open && children.length ? (
        <ul className="space-y-px">
          {children.map((child) => (
            <TreeNode key={child.id} folder={child} depth={depth + 1} onRename={onRename} />
          ))}
        </ul>
      ) : null}

    </li>
  );
}

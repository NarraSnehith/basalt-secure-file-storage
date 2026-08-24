'use client';

import { useMemo, useState } from 'react';
import { pluralise } from '@/lib/format';
import { childFolders, useVault } from '@/lib/vault-context';
import { Modal } from '@/components/ui/Modal';
import { IconChevron, IconDrive, IconFolder, IconSearch } from '@/components/ui/icons';
import type { Folder } from '@/lib/types';

/** Destination picker. Flattens to a filtered list as soon as you type. */
export function MoveDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { folders, move, files } = useVault();
  const [target, setTarget] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const currentFolders = useMemo(
    () => new Set(files.filter((f) => ids.includes(f.id)).map((f) => f.folderId)),
    [files, ids],
  );

  const matches = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return null;
    return folders.filter((f) => f.name.toLowerCase().includes(term)).slice(0, 40);
  }, [filter, folders]);

  const submit = async () => {
    setBusy(true);
    try {
      await move(ids, target);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const sameFolder = currentFolders.size === 1 && currentFolders.has(target);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Move ${pluralise(ids.length, 'file')}`}
      description="Pick a destination folder."
      width={26}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || sameFolder}>
            {sameFolder ? 'Already here' : 'Move here'}
          </button>
        </>
      }
    >
      <div className="relative mb-2">
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2" style={{ color: 'var(--text-faint)' }}>
          <IconSearch size={13} />
        </span>
        <input
          className="field h-8 pl-8"
          placeholder="Filter folders"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>

      <div className="max-h-[16rem] overflow-y-auto rounded-md p-1" style={{ border: '1px solid var(--line)' }}>
        <Option
          label="Drive root"
          icon={<IconDrive size={14} />}
          selected={target === null}
          onSelect={() => setTarget(null)}
          depth={0}
        />
        {matches
          ? matches.map((folder) => (
              <Option
                key={folder.id}
                label={folder.name}
                icon={<IconFolder size={14} />}
                selected={target === folder.id}
                onSelect={() => setTarget(folder.id)}
                depth={0}
              />
            ))
          : childFolders(folders, null).map((folder) => (
              <Branch key={folder.id} folder={folder} depth={0} target={target} onSelect={setTarget} />
            ))}
      </div>
    </Modal>
  );
}

function Branch({
  folder,
  depth,
  target,
  onSelect,
}: {
  folder: Folder;
  depth: number;
  target: string | null;
  onSelect: (id: string) => void;
}) {
  const { folders } = useVault();
  const [open, setOpen] = useState(depth < 1);
  const children = childFolders(folders, folder.id);

  return (
    <>
      <Option
        label={folder.name}
        icon={<IconFolder size={14} />}
        selected={target === folder.id}
        onSelect={() => onSelect(folder.id)}
        depth={depth}
        expandable={children.length > 0}
        expanded={open}
        onToggle={() => setOpen((v) => !v)}
        count={folder.fileCount}
      />
      {open
        ? children.map((child) => (
            <Branch key={child.id} folder={child} depth={depth + 1} target={target} onSelect={onSelect} />
          ))
        : null}
    </>
  );
}

function Option({
  label,
  icon,
  selected,
  onSelect,
  depth,
  expandable,
  expanded,
  onToggle,
  count,
}: {
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  onSelect: () => void;
  depth: number;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  count?: number;
}) {
  return (
    <div
      className="flex items-center gap-1 rounded-[4px]"
      style={{
        paddingLeft: `${depth * 0.875}rem`,
        background: selected ? 'var(--accent-wash)' : undefined,
        boxShadow: selected ? 'inset 0 0 0 1px color-mix(in oklab, var(--accent) 35%, transparent)' : undefined,
      }}
    >
      <button
        type="button"
        aria-label={expanded ? 'Collapse' : 'Expand'}
        className="flex h-7 w-4 items-center justify-center"
        style={{ visibility: expandable ? 'visible' : 'hidden' }}
        onClick={onToggle}
      >
        <IconChevron size={11} dir={expanded ? 'down' : 'right'} />
      </button>
      <button type="button" className="flex h-7 min-w-0 flex-1 items-center gap-2 text-left text-[0.8125rem]" onClick={onSelect}>
        <span style={{ color: selected ? 'var(--accent)' : 'var(--text-faint)' }}>{icon}</span>
        <span className="truncate">{label}</span>
        {count ? <span className="meta ml-auto pr-2">{count}</span> : null}
      </button>
    </div>
  );
}

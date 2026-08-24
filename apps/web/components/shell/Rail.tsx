'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme';
import { useVault } from '@/lib/vault-context';
import { onUiEvent } from '@/lib/ui-events';
import { pluralise } from '@/lib/format';
import { Wordmark } from '@/components/brand/Logo';
import { Menu } from '@/components/ui/Menu';
import { Modal } from '@/components/ui/Modal';
import {
  IconActivity, IconClock, IconDrive, IconFilter, IconFolder, IconPlus, IconSettings,
  IconShare, IconStar, IconTrash, IconUpload,
} from '@/components/ui/icons';
import { StorageCore } from './StorageCore';
import { FolderTree } from './FolderTree';
import type { Folder } from '@/lib/types';

const NAV = [
  { href: '/vault', label: 'Drive', icon: IconDrive, match: (p: string) => p === '/vault' || p.startsWith('/vault/folder') },
  { href: '/vault/recent', label: 'Recent', icon: IconClock },
  { href: '/vault/starred', label: 'Starred', icon: IconStar },
  { href: '/vault/shared', label: 'Shared', icon: IconShare },
  { href: '/vault/requests', label: 'Upload links', icon: IconUpload },
  { href: '/vault/insights', label: 'Insights', icon: IconFilter },
  { href: '/vault/activity', label: 'Activity', icon: IconActivity },
  { href: '/vault/trash', label: 'Trash', icon: IconTrash },
] as const;

export function Rail({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const { stats, upload, createFolder, renameFolder, folderId } = useVault();
  const { theme, toggle } = useTheme();
  const fileInput = useRef<HTMLInputElement>(null);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [renaming, setRenaming] = useState<Folder | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);

  // The palette and the keyboard both raise these; the inputs live here.
  useEffect(() => {
    const offUpload = onUiEvent('upload', () => fileInput.current?.click());
    const offFolder = onUiEvent('newFolder', () => setNewFolderOpen(true));
    return () => {
      offUpload();
      offFolder();
    };
  }, []);

  const submitNewFolder = async () => {
    if (!folderName.trim() || busy) return;
    setBusy(true);
    try {
      await createFolder(folderName.trim(), folderId);
      setNewFolderOpen(false);
      setFolderName('');
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async () => {
    if (!renaming || !renameValue.trim() || busy) return;
    setBusy(true);
    try {
      await renameFolder(renaming.id, renameValue.trim());
      setRenaming(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      className="flex h-full w-[15rem] shrink-0 flex-col"
      style={{ background: 'var(--panel)', borderRight: '1px solid var(--line)' }}
    >
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/vault" onClick={onClose} className="transition-opacity hover:opacity-80">
          <Wordmark />
        </Link>
        {onClose ? (
          <button type="button" className="btn btn-sm btn-ghost lg:hidden" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>

      <div className="flex gap-1.5 px-3 pb-3">
        <button type="button" className="btn btn-primary flex-1" onClick={() => fileInput.current?.click()}>
          <IconUpload size={14} />
          Upload
        </button>
        <Menu
          width={12}
          align="start"
          items={[
            { label: 'Upload files…', icon: <IconUpload size={13} />, hint: 'U', onSelect: () => fileInput.current?.click() },
            { label: 'New folder…', icon: <IconFolder size={13} />, hint: 'N', onSelect: () => setNewFolderOpen(true) },
          ]}
          trigger={({ toggle: openMenu, ref }) => (
            <button ref={ref} type="button" className="btn btn-outline btn-icon" onClick={openMenu} aria-label="New">
              <IconPlus size={14} />
            </button>
          )}
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            if (chosen.length) upload(chosen);
            event.target.value = '';
            onClose?.();
          }}
        />
      </div>

      <nav className="px-3">
        <ul className="space-y-px">
          {NAV.map((item) => {
            const active = 'match' in item && item.match ? item.match(pathname) : pathname === item.href;
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link href={item.href} className="rail-link" data-active={active} onClick={onClose}>
                  <Icon size={14} style={{ color: active ? 'var(--accent)' : 'var(--text-faint)' }} />
                  <span className="flex-1">{item.label}</span>
                  {item.label === 'Shared' && stats?.publicCount ? (
                    <span className="meta">{stats.publicCount}</span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-5 flex min-h-0 flex-1 flex-col px-3">
        <div className="flex items-center justify-between px-1.5 pb-1.5">
          <span className="eyebrow">Folders</span>
          <button
            type="button"
            className="btn btn-sm btn-ghost btn-icon h-5 w-5"
            aria-label="New folder"
            onClick={() => setNewFolderOpen(true)}
          >
            <IconPlus size={12} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <FolderTree
            onRename={(folder) => {
              setRenaming(folder);
              setRenameValue(folder.name);
            }}
          />
        </div>
      </div>

      <div className="px-4 py-3.5" style={{ borderTop: '1px solid var(--line)' }}>
        <Link href="/vault/settings" className="block transition-opacity hover:opacity-85" onClick={onClose}>
          <StorageCore stats={stats} compact />
        </Link>
      </div>

      <div className="p-2" style={{ borderTop: '1px solid var(--line)' }}>
        <Menu
          width={13}
          align="start"
          items={[
            { label: 'Settings', icon: <IconSettings size={13} />, onSelect: () => { window.location.href = '/vault/settings'; } },
            { label: theme === 'dark' ? 'Light theme' : 'Dark theme', onSelect: toggle },
            { label: 'Sign out', danger: true, separated: true, onSelect: () => void signOut() },
          ]}
          trigger={({ toggle: openMenu, ref }) => (
            <button
              ref={ref}
              type="button"
              onClick={openMenu}
              className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-[var(--hover)]"
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[0.75rem] font-medium"
                style={{ background: 'var(--accent-wash)', color: 'var(--accent)', border: '1px solid color-mix(in oklab, var(--accent) 24%, transparent)' }}
              >
                {(user?.displayName ?? '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.8125rem] leading-tight">{user?.displayName}</span>
                <span className="meta block truncate">{user?.email}</span>
              </span>
            </button>
          )}
        />
      </div>

      <Modal
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        title="New folder"
        description={folderId ? 'Created inside the folder you are viewing.' : 'Created at the root of your drive.'}
        width={24}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setNewFolderOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!folderName.trim() || busy} onClick={submitNewFolder}>
              Create
            </button>
          </>
        }
      >
        <input
          className="field"
          placeholder="Folder name"
          value={folderName}
          maxLength={255}
          onChange={(event) => setFolderName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submitNewFolder();
          }}
        />
      </Modal>

      <Modal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename folder"
        width={24}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setRenaming(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!renameValue.trim() || busy} onClick={submitRename}>
              Rename
            </button>
          </>
        }
      >
        <input
          className="field"
          value={renameValue}
          maxLength={255}
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submitRename();
          }}
        />
        {renaming && renaming.fileCount > 0 ? (
          <p className="mt-2 text-[0.75rem]" style={{ color: 'var(--text-faint)' }}>
            Holds {pluralise(renaming.fileCount, 'file')}.
          </p>
        ) : null}
      </Modal>
    </aside>
  );
}

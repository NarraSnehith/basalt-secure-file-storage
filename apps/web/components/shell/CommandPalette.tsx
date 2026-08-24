'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme';
import { useVault } from '@/lib/vault-context';
import { KindGlyph } from '@/components/files/KindGlyph';
import {
  IconActivity, IconClock, IconDrive, IconFolder, IconSearch, IconSettings,
  IconShare, IconStar, IconTrash, IconUpload,
} from '@/components/ui/icons';
import type { FileListResponse, StoredFile } from '@/lib/types';

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
  group: 'Files' | 'Folders' | 'Go to' | 'Actions';
}

/**
 * ⌘K. Searches the drive over the API (so it finds files that are not in the
 * current view), jumps to folders, and runs the handful of actions that would
 * otherwise mean three clicks.
 */
export function CommandPalette({ onUpload, onNewFolder }: { onUpload: () => void; onNewFolder: () => void }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const [hits, setHits] = useState<StoredFile[]>([]);
  const [searching, setSearching] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { folders } = useVault();
  const { signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const debounced = useDebounced(term, 200);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setTerm('');
      setHits([]);
      setActive(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    const query = debounced.trim();
    if (!open || query.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    void api
      .get<FileListResponse>(`/files?scope=all&limit=8&q=${encodeURIComponent(query)}`)
      .then((data) => {
        if (!cancelled) setHits(data.items);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, open]);

  const commands = useMemo<Command[]>(() => {
    const term_ = term.trim().toLowerCase();
    const list: Command[] = [];

    for (const file of hits) {
      list.push({
        id: `file-${file.id}`,
        label: file.name,
        hint: formatBytes(file.sizeBytes),
        icon: <KindGlyph kind={file.kind} size={18} />,
        group: 'Files',
        run: () => router.push(file.folderId ? `/vault/folder/${file.folderId}` : '/vault'),
      });
    }

    for (const folder of folders.filter((f) => !term_ || f.name.toLowerCase().includes(term_)).slice(0, 5)) {
      list.push({
        id: `folder-${folder.id}`,
        label: folder.name,
        hint: `${folder.fileCount} files`,
        icon: <IconFolder size={15} />,
        group: 'Folders',
        run: () => router.push(`/vault/folder/${folder.id}`),
      });
    }

    const pages: Array<[string, string, React.ReactNode]> = [
      ['Drive', '/vault', <IconDrive key="d" size={15} />],
      ['Recent', '/vault/recent', <IconClock key="r" size={15} />],
      ['Starred', '/vault/starred', <IconStar key="s" size={15} />],
      ['Shared links', '/vault/shared', <IconShare key="sh" size={15} />],
      ['Upload links', '/vault/requests', <IconUpload key="ul" size={15} />],
      ['Insights', '/vault/insights', <IconSettings key="in" size={15} />],
      ['Activity', '/vault/activity', <IconActivity key="a" size={15} />],
      ['Trash', '/vault/trash', <IconTrash key="t" size={15} />],
      ['Settings', '/vault/settings', <IconSettings key="se" size={15} />],
    ];
    for (const [label, href, icon] of pages) {
      if (!term_ || label.toLowerCase().includes(term_)) {
        list.push({ id: `go-${href}`, label, icon, group: 'Go to', run: () => router.push(href) });
      }
    }

    const actions: Command[] = [
      { id: 'act-upload', label: 'Upload files', hint: 'U', icon: <IconUpload size={15} />, group: 'Actions', run: onUpload },
      { id: 'act-folder', label: 'New folder', hint: 'N', icon: <IconFolder size={15} />, group: 'Actions', run: onNewFolder },
      { id: 'act-theme', label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`, icon: <IconSettings size={15} />, group: 'Actions', run: toggle },
      { id: 'act-signout', label: 'Sign out', icon: <IconTrash size={15} />, group: 'Actions', run: () => void signOut() },
    ];
    for (const action of actions) {
      if (!term_ || action.label.toLowerCase().includes(term_)) list.push(action);
    }

    return list;
  }, [hits, folders, term, router, onUpload, onNewFolder, theme, toggle, signOut]);

  useEffect(() => setActive(0), [commands.length]);

  if (!open) return null;

  const grouped = commands.reduce<Record<string, Command[]>>((acc, command) => {
    (acc[command.group] ??= []).push(command);
    return acc;
  }, {});

  const run = (command: Command) => {
    command.run();
    setOpen(false);
  };

  return (
    <div
      className="animate-fade fixed inset-0 z-[85] flex items-start justify-center p-4 pt-[12vh]"
      style={{ background: 'color-mix(in oklab, var(--page) 70%, transparent)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="sheet animate-rise w-full max-w-[34rem] overflow-hidden" role="dialog" aria-label="Command palette">
        <div className="flex items-center gap-2.5 px-3.5" style={{ height: '3rem', borderBottom: '1px solid var(--line)' }}>
          <span style={{ color: 'var(--text-faint)' }}>
            <IconSearch size={15} />
          </span>
          <input
            ref={input}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search files, jump to a folder, run a command…"
            className="flex-1 bg-transparent text-[0.875rem] outline-none placeholder:text-[var(--text-faint)]"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((i) => (i + 1) % Math.max(1, commands.length));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((i) => (i - 1 + commands.length) % Math.max(1, commands.length));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const command = commands[active];
                if (command) run(command);
              } else if (event.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          {searching ? <span className="meta">searching…</span> : <span className="kbd">esc</span>}
        </div>

        <div className="max-h-[24rem] overflow-y-auto p-1.5">
          {commands.length === 0 ? (
            <p className="px-2 py-6 text-center text-[0.8125rem]" style={{ color: 'var(--text-faint)' }}>
              Nothing matches “{term}”.
            </p>
          ) : (
            Object.entries(grouped).map(([group, entries]) => (
              <div key={group} className="mb-1">
                <p className="eyebrow px-2 pt-1.5 pb-1">{group}</p>
                {entries.map((command) => {
                  const index = commands.indexOf(command);
                  return (
                    <button
                      key={command.id}
                      type="button"
                      className="flex w-full items-center gap-2.5 rounded-[5px] px-2 py-1.5 text-left"
                      style={index === active ? { background: 'var(--hover)' } : undefined}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => run(command)}
                    >
                      <span className="shrink-0" style={{ color: 'var(--text-faint)' }}>
                        {command.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[0.8125rem]">{command.label}</span>
                      {command.hint ? <span className="meta shrink-0">{command.hint}</span> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

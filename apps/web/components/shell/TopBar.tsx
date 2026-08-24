'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { folderTrail, useVault, type SortBy } from '@/lib/vault-context';
import { pluralise } from '@/lib/format';
import { KIND_LABEL, KIND_ORDER, kindColor } from '@/lib/kinds';
import { Menu } from '@/components/ui/Menu';
import {
  IconChevron, IconClose, IconFilter, IconGrid, IconList, IconSearch, IconSort,
} from '@/components/ui/icons';

const SCOPE_TITLE: Record<string, { title: string; blurb: string }> = {
  recent: { title: 'Recent', blurb: 'Everything you have added lately, newest first.' },
  starred: { title: 'Starred', blurb: 'The files you marked to keep close.' },
  shared: { title: 'Shared', blurb: 'Files reachable by anyone holding a link.' },
  trash: { title: 'Trash', blurb: 'Recoverable for 30 days, then removed for good.' },
  activity: { title: 'Activity', blurb: 'Every action on your account, newest first.' },
  requests: { title: 'Upload links', blurb: 'Let other people send files into your folders.' },
  insights: { title: 'Insights', blurb: 'What is using your space, and what you could reclaim.' },
  settings: { title: 'Settings', blurb: 'Profile, password, devices and storage.' },
};

/** Pages that show a file list — the only ones the toolbar controls apply to. */
const FILE_VIEWS = new Set(['', 'folder', 'recent', 'starred', 'trash']);

const SORT_LABEL: Record<SortBy, string> = {
  name: 'Name',
  size: 'Size',
  created: 'Date added',
  updated: 'Last modified',
};

export function TopBar({ onOpenNav }: { onOpenNav: () => void }) {
  const pathname = usePathname();
  // On a phone the search field would eat the whole header, so it lives one row
  // down and is opened from the toolbar.
  const [mobileSearch, setMobileSearch] = useState(false);
  const {
    scope, folderId, folders, files, total, query, setQuery, kinds, toggleKind, clearKinds,
    sortBy, sortDir, setSort, view, setView,
  } = useVault();
  const search = useRef<HTMLInputElement>(null);

  // "/" focuses search the way it does in every tool people already use.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const segment = pathname.split('/')[2] ?? '';
  const scopeInfo = SCOPE_TITLE[segment];
  const trail = folderTrail(folders, folderId);
  // The share table and the activity feed are not file lists; showing them a
  // type filter and a grid toggle that do nothing would just be noise.
  const isFileView = FILE_VIEWS.has(segment);

  return (
    <header className="sticky top-0 z-30" style={{ background: 'color-mix(in oklab, var(--page) 88%, transparent)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--line)' }}>
      <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
        <button type="button" className="btn btn-ghost btn-icon lg:hidden" onClick={onOpenNav} aria-label="Open navigation">
          <IconList size={16} />
        </button>

        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[0.875rem]">
          {scopeInfo ? (
            <span className="font-medium">{scopeInfo.title}</span>
          ) : (
            <>
              <Link href="/vault" className="shrink-0 transition-colors hover:text-[var(--text)]" style={{ color: trail.length ? 'var(--text-dim)' : 'var(--text)' }}>
                Drive
              </Link>
              {trail.map((folder, index) => (
                <span key={folder.id} className="flex min-w-0 items-center gap-1">
                  <IconChevron size={12} style={{ color: 'var(--text-faint)' }} />
                  {index === trail.length - 1 ? (
                    <span className="truncate font-medium">{folder.name}</span>
                  ) : (
                    <Link href={`/vault/folder/${folder.id}`} className="truncate transition-colors hover:text-[var(--text)]" style={{ color: 'var(--text-dim)' }}>
                      {folder.name}
                    </Link>
                  )}
                </span>
              ))}
            </>
          )}
          {total !== null && isFileView ? (
            <span className="meta ml-2 hidden shrink-0 sm:inline">
              {query.trim() ? `${pluralise(files.length, 'match', 'matches')}` : pluralise(total, 'file')}
            </span>
          ) : null}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          {isFileView ? (
            <>
          <button
            type="button"
            className="btn btn-sm btn-ghost btn-icon sm:hidden"
            aria-label="Search files"
            aria-expanded={mobileSearch}
            onClick={() => setMobileSearch((v) => !v)}
          >
            <IconSearch size={14} />
          </button>
          <div className="relative hidden sm:block">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2" style={{ color: 'var(--text-faint)' }}>
              <IconSearch size={13} />
            </span>
            <input
              ref={search}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setQuery('');
                  event.currentTarget.blur();
                }
              }}
              placeholder="Search files"
              aria-label="Search files"
              className="field h-8 w-[9rem] pl-8 transition-[width] focus:w-[16rem]"
              style={{ transitionDuration: '200ms' }}
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                className="absolute top-1/2 right-1.5 -translate-y-1/2 p-1"
                style={{ color: 'var(--text-faint)' }}
                onClick={() => setQuery('')}
              >
                <IconClose size={11} />
              </button>
            ) : (
              <span className="kbd pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">/</span>
            )}
          </div>

          <Menu
            width={13}
            items={KIND_ORDER.map((kind) => ({
              label: KIND_LABEL[kind],
              icon: (
                <span
                  className="block h-2.5 w-2.5 rounded-[2px]"
                  style={{ background: kinds.includes(kind) ? kindColor(kind) : 'transparent', border: `1px solid ${kindColor(kind)}` }}
                />
              ),
              onSelect: () => toggleKind(kind),
            })).concat(
              kinds.length
                ? [{ label: 'Clear filters', icon: <IconClose size={12} />, separated: true, onSelect: clearKinds } as never]
                : [],
            )}
            trigger={({ toggle, ref }) => (
              <button
                ref={ref}
                type="button"
                onClick={toggle}
                className={`btn btn-sm ${kinds.length ? 'btn-outline' : 'btn-ghost'}`}
                aria-label="Filter by type"
              >
                <IconFilter size={13} />
                <span className="hidden md:inline">{kinds.length ? `${kinds.length} type${kinds.length > 1 ? 's' : ''}` : 'Type'}</span>
              </button>
            )}
          />

          <Menu
            width={14}
            items={(Object.keys(SORT_LABEL) as SortBy[]).map((key) => ({
              label: SORT_LABEL[key],
              hint: sortBy === key ? (sortDir === 'asc' ? '↑' : '↓') : undefined,
              onSelect: () => setSort(key),
            }))}
            trigger={({ toggle, ref }) => (
              <button ref={ref} type="button" onClick={toggle} className="btn btn-sm btn-ghost" aria-label="Sort">
                <IconSort size={13} />
                <span className="hidden md:inline">{SORT_LABEL[sortBy]}</span>
              </button>
            )}
          />

          <div className="flex overflow-hidden rounded-[5px]" style={{ border: '1px solid var(--line)' }}>
            {(['list', 'grid'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-label={`${mode} view`}
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
                className="flex h-7 w-7 items-center justify-center transition-colors"
                style={{
                  background: view === mode ? 'var(--hover)' : 'transparent',
                  color: view === mode ? 'var(--text)' : 'var(--text-faint)',
                }}
              >
                {mode === 'list' ? <IconList size={13} /> : <IconGrid size={13} />}
              </button>
            ))}
          </div>
            </>
          ) : null}
        </div>
      </div>

      {mobileSearch && isFileView ? (
        <div className="relative px-3 pb-2.5 sm:hidden">
          <span className="pointer-events-none absolute top-1/2 left-5.5 -translate-y-1/2" style={{ color: 'var(--text-faint)' }}>
            <IconSearch size={13} />
          </span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search every folder"
            aria-label="Search files"
            className="field h-9 pl-9"
          />
        </div>
      ) : null}

      {scopeInfo || (kinds.length && isFileView) ? (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 sm:px-5">
          {scopeInfo ? (
            <p className="text-[0.75rem]" style={{ color: 'var(--text-faint)' }}>
              {scopeInfo.blurb}
            </p>
          ) : null}
          {(isFileView ? kinds : []).map((kind) => (
            <button
              key={kind}
              type="button"
              className="chip gap-1"
              style={{ color: kindColor(kind), background: `color-mix(in oklab, ${kindColor(kind)} 12%, transparent)` }}
              onClick={() => toggleKind(kind)}
            >
              {KIND_LABEL[kind as keyof typeof KIND_LABEL] ?? kind}
              <IconClose size={9} />
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}

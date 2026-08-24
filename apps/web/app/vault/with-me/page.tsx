'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatBytes, pluralise, relativeTime } from '@/lib/format';
import { EmptyState } from '@/components/files/EmptyState';
import { IconChevron, IconFolder, IconShield } from '@/components/ui/icons';
import type { CollaboratorRole, SharedFolder } from '@/lib/types';

const ROLE_BLURB: Record<CollaboratorRole, string> = {
  viewer: 'You can open and download',
  contributor: 'You can add files, and manage your own',
  editor: 'You can reorganise anything here',
};

/**
 * Folders other people have shared with you.
 *
 * Kept deliberately separate from your own drive: someone else's folder is
 * somewhere you visit, not something you own, and blending the two is how people
 * lose track of whose quota they are spending.
 */
export default function SharedWithMePage() {
  const [folders, setFolders] = useState<SharedFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { folders: list } = await api.get<{ folders: SharedFolder[] }>('/collab/shared-with-me');
      setFolders(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load what has been shared with you.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className="p-8 text-center" style={{ color: 'var(--color-rust)' }}>{error}</div>;

  if (folders === null) {
    return (
      <div className="space-y-2 p-5">
        {[0, 1].map((i) => (
          <div key={i} className="skeleton h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  if (folders.length === 0) {
    return (
      <EmptyState
        title="Nothing has been shared with you"
        body="When somebody shares a folder with your email address, it appears here — and stays out of your own drive."
        seed={83}
      />
    );
  }

  return (
    <div className="overflow-y-auto pb-24">
      <div className="mx-auto max-w-[52rem] px-4 py-5 sm:px-6">
        <ul className="space-y-2">
          {folders.map((folder) => (
            <li key={folder.id}>
              <Link
                href={`/vault/folder/${folder.id}`}
                className="panel flex items-center gap-3 p-3.5 transition-colors hover:bg-[var(--hover)]"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
                  style={{ background: 'var(--panel-2)', color: 'var(--accent)', border: '1px solid var(--line)' }}
                >
                  <IconFolder size={16} />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[0.9375rem]">{folder.name}</span>
                    <span className="chip" style={{ color: 'var(--text-dim)', background: 'var(--hover)' }}>
                      {folder.role}
                    </span>
                  </span>
                  <span className="meta mt-1 block truncate">
                    {folder.ownerName} · {pluralise(folder.fileCount, 'file')} ·{' '}
                    {formatBytes(folder.sizeBytes)} · shared {relativeTime(folder.sharedAt)}
                  </span>
                  <span className="meta mt-0.5 block">{ROLE_BLURB[folder.role]}.</span>
                </span>

                <IconChevron size={13} style={{ color: 'var(--text-faint)' }} />
              </Link>
            </li>
          ))}
        </ul>

        <p className="meta mt-4 flex items-start gap-2 leading-relaxed">
          <IconShield size={12} className="mt-px shrink-0" />
          Anything you add to a shared folder belongs to its owner and counts against their space, not
          yours — and it is credited to you.
        </p>
      </div>
    </div>
  );
}

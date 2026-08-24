'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatBytes, formatDateTime, relativeTime } from '@/lib/format';
import { useCopy } from '@/lib/hooks';
import { useToast } from '@/lib/toast';
import { useVault } from '@/lib/vault-context';
import { EmptyState } from '@/components/files/EmptyState';
import { KindGlyph } from '@/components/files/KindGlyph';
import { Confirm } from '@/components/ui/Confirm';
import {
  IconCheck, IconClock, IconDownload, IconEye, IconLink, IconLock, IconSpinner, IconTrash,
} from '@/components/ui/icons';
import type { ShareWithFile } from '@/lib/types';

/**
 * Every live link in one table — the page you open when you want to answer
 * "what of mine is reachable from the internet right now?" and shut some of it
 * off.
 */
export default function SharedPage() {
  const [shares, setShares] = useState<ShareWithFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ShareWithFile | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [, copy] = useCopy();
  const toast = useToast();
  const { refresh } = useVault();

  const load = useCallback(async () => {
    try {
      const { shares: list } = await api.get<{ shares: ShareWithFile[] }>('/shares');
      setShares(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your links.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (share: ShareWithFile) => {
    try {
      await api.del(`/shares/${share.id}`);
      setShares((current) => (current ?? []).filter((s) => s.id !== share.id));
      toast.success('Link revoked', 'Anyone holding it now gets a 404.');
      void refresh();
    } catch (err) {
      toast.error('Could not revoke', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (error) {
    return (
      <div className="p-8 text-center">
        <p style={{ color: 'var(--color-rust)' }}>{error}</p>
      </div>
    );
  }

  if (!shares) {
    return (
      <div className="space-y-2 p-5">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  if (shares.length === 0) {
    return (
      <EmptyState
        title="Nothing is shared"
        body="Every file in your drive is private. Turn on a public link from a file’s share sheet, or issue a link with a password and an expiry."
        seed={41}
      />
    );
  }

  return (
    <div className="overflow-y-auto p-3 pb-20 sm:p-5">
      <ul className="space-y-2">
        {shares.map((share) => {
          const dead = share.expired || share.exhausted;
          return (
            <li
              key={share.id}
              className="panel flex flex-col gap-3 p-3 sm:flex-row sm:items-center"
              style={{ opacity: dead ? 0.65 : 1 }}
            >
              <KindGlyph kind={share.file.kind} size={32} />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[0.875rem]">{share.file.name}</p>
                  {share.hasPassword ? (
                    <span title="Password protected" style={{ color: 'var(--color-clay)' }}>
                      <IconLock size={12} />
                    </span>
                  ) : null}
                  {share.kind === 'toggle' ? (
                    <span className="chip" style={{ color: 'var(--accent)', background: 'var(--accent-wash)' }}>
                      public
                    </span>
                  ) : null}
                  {share.label ? <span className="meta">{share.label}</span> : null}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="meta">{formatBytes(share.file.sizeBytes)}</span>
                  <span className="meta flex items-center gap-1">
                    <IconDownload size={10} />
                    {share.maxDownloads !== null
                      ? `${share.downloadCount}/${share.maxDownloads}`
                      : share.downloadCount}
                  </span>
                  {share.expiresAt ? (
                    <span
                      className="meta flex items-center gap-1"
                      style={{ color: share.expired ? 'var(--color-rust)' : undefined }}
                      title={formatDateTime(share.expiresAt)}
                    >
                      <IconClock size={10} />
                      {share.expired ? 'expired' : `expires ${relativeTime(share.expiresAt)}`}
                    </span>
                  ) : (
                    <span className="meta">no expiry</span>
                  )}
                  {share.exhausted ? (
                    <span className="meta" style={{ color: 'var(--color-rust)' }}>
                      limit reached
                    </span>
                  ) : null}
                  {share.lastAccessedAt ? (
                    <span className="meta flex items-center gap-1">
                      <IconEye size={10} />
                      {relativeTime(share.lastAccessedAt)}
                    </span>
                  ) : (
                    <span className="meta">never opened</span>
                  )}
                  {!share.allowPreview ? <span className="meta">download only</span> : null}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <code className="meta hidden max-w-[12rem] truncate rounded px-1.5 py-1 lg:block" style={{ background: 'var(--panel-2)' }}>
                  /f/{share.slug}
                </code>
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => {
                    void copy(share.url);
                    setCopiedId(share.id);
                    setTimeout(() => setCopiedId(null), 1600);
                  }}
                >
                  {copiedId === share.id ? <IconCheck size={12} /> : <IconLink size={12} />}
                  {copiedId === share.id ? 'Copied' : 'Copy'}
                </button>
                <a className="btn btn-sm btn-ghost" href={share.url} target="_blank" rel="noreferrer">
                  Open
                </a>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost btn-icon"
                  onClick={() => setRevoking(share)}
                  aria-label="Revoke link"
                >
                  <IconTrash size={13} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="meta mt-4 flex items-center gap-2">
        <IconSpinner size={11} style={{ opacity: 0 }} />
        Revoking a link takes effect immediately — no cache, no grace period.
      </p>

      {revoking ? (
        <Confirm
          open
          onClose={() => setRevoking(null)}
          onConfirm={() => revoke(revoking)}
          title="Revoke this link?"
          body={
            <>
              Anyone holding the address for <strong style={{ color: 'var(--text)' }}>{revoking.file.name}</strong> will
              get a 404 on their next request. The file itself is untouched, and you can publish a new link at any time.
            </>
          }
          confirmLabel="Revoke link"
          danger
        />
      ) : null}
    </div>
  );
}

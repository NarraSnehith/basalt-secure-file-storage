'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, relativeTime } from '@/lib/format';
import { EmptyState } from '@/components/files/EmptyState';
import {
  IconCheck, IconDownload, IconEye, IconGlobe, IconLink, IconLock, IconMove, IconPencil,
  IconRestore, IconShield, IconSpinner, IconTrash, IconUpload, IconWarn,
} from '@/components/ui/icons';
import type { ActivityEvent } from '@/lib/types';

/**
 * The audit trail, in plain language.
 *
 * A log is only useful if a person can read it, so each event becomes a sentence
 * with the actor implied ("you") and anonymous share traffic called out
 * explicitly — that is the line that matters when a link leaks.
 */
const DESCRIPTOR: Record<string, { icon: React.ReactNode; text: (event: ActivityEvent) => string; tone?: string }> = {
  'file.upload': { icon: <IconUpload size={13} />, text: (e) => `Uploaded ${e.fileName ?? 'a file'}` },
  'file.download': { icon: <IconDownload size={13} />, text: (e) => `Downloaded ${e.fileName ?? 'a file'}` },
  'file.rename': { icon: <IconPencil size={13} />, text: (e) => `Renamed to ${e.fileName ?? 'a new name'}` },
  'file.move': { icon: <IconMove size={13} />, text: (e) => `Moved ${e.fileName ?? 'a file'}` },
  'file.trash': { icon: <IconTrash size={13} />, text: (e) => `Moved ${e.fileName ?? 'a file'} to trash` },
  'file.restore': { icon: <IconRestore size={13} />, text: (e) => `Restored ${e.fileName ?? 'a file'}` },
  'file.purge': { icon: <IconTrash size={13} />, text: (e) => `Permanently deleted ${e.subject ?? 'a file'}`, tone: 'var(--color-rust)' },
  'file.visibility': {
    icon: <IconGlobe size={13} />,
    text: (e) => `Made ${e.fileName ?? 'a file'} ${String((e.metadata as { to?: string }).to ?? 'private')}`,
    tone: 'var(--accent)',
  },
  'folder.create': { icon: <IconCheck size={13} />, text: (e) => `Created folder ${e.subject ?? ''}`.trim() },
  'folder.rename': { icon: <IconPencil size={13} />, text: (e) => `Renamed folder to ${e.subject ?? ''}`.trim() },
  'folder.trash': { icon: <IconTrash size={13} />, text: () => 'Moved a folder to trash' },
  'folder.restore': { icon: <IconRestore size={13} />, text: () => 'Restored a folder' },
  'share.create': { icon: <IconLink size={13} />, text: (e) => `Created a share link for ${e.fileName ?? 'a file'}`, tone: 'var(--accent)' },
  'share.update': { icon: <IconPencil size={13} />, text: () => 'Updated a share link' },
  'share.revoke': { icon: <IconLock size={13} />, text: (e) => `Revoked a link for ${e.fileName ?? 'a file'}` },
  'share.view': { icon: <IconEye size={13} />, text: (e) => `Someone opened the link to ${e.fileName ?? 'a file'}`, tone: 'var(--color-lapis)' },
  'share.download': { icon: <IconDownload size={13} />, text: (e) => `Someone downloaded ${e.fileName ?? 'a file'} via a link`, tone: 'var(--color-lapis)' },
  'share.denied': { icon: <IconWarn size={13} />, text: () => 'Wrong password on a share link', tone: 'var(--color-clay)' },
  'auth.login': { icon: <IconShield size={13} />, text: () => 'Signed in' },
  'auth.login_failed': { icon: <IconWarn size={13} />, text: () => 'Failed sign-in attempt', tone: 'var(--color-clay)' },
  'auth.logout': { icon: <IconShield size={13} />, text: () => 'Signed out' },
  'auth.register': { icon: <IconShield size={13} />, text: () => 'Account created' },
  'auth.password_changed': { icon: <IconLock size={13} />, text: () => 'Password changed', tone: 'var(--accent)' },
  'auth.refresh_reuse': { icon: <IconWarn size={13} />, text: () => 'A retired session token was replayed — sessions revoked', tone: 'var(--color-rust)' },
  'auth.session_revoked': { icon: <IconShield size={13} />, text: () => 'Signed a device out' },
};

const dayLabel = (iso: string): string => {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(date, today)) return 'Today';
  if (same(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
};

export default function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (before?: string) => {
    try {
      const params = new URLSearchParams({ limit: '60' });
      if (before) params.set('before', before);
      const data = await api.get<{ items: ActivityEvent[]; nextCursor: string | null }>(`/activity?${params}`);
      setEvents((current) => (before ? [...current, ...data.items] : data.items));
      setCursor(data.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load activity.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-2 p-5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-10 rounded-md" />
        ))}
      </div>
    );
  }

  if (error) return <div className="p-8 text-center" style={{ color: 'var(--color-rust)' }}>{error}</div>;
  if (events.length === 0) {
    return <EmptyState title="No activity yet" body="Uploads, downloads and share-link visits will show up here." seed={47} />;
  }

  let lastDay = '';

  return (
    <div className="overflow-y-auto pb-20">
      <div className="mx-auto max-w-[52rem] px-4 py-5 sm:px-6">
        <ol className="space-y-px">
          {events.map((event) => {
            const descriptor = DESCRIPTOR[event.type];
            const day = dayLabel(event.createdAt);
            const newDay = day !== lastDay;
            lastDay = day;
            const anonymous = event.type.startsWith('share.') && event.type !== 'share.create' && event.type !== 'share.revoke' && event.type !== 'share.update';

            return (
              <li key={event.id}>
                {newDay ? (
                  <p className="eyebrow px-1 pt-5 pb-2 first:pt-0">{day}</p>
                ) : null}
                <div className="flex items-start gap-3 rounded-md px-1 py-2 transition-colors hover:bg-[var(--hover)]">
                  <span
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                    style={{
                      background: 'var(--panel-2)',
                      border: '1px solid var(--line)',
                      color: descriptor?.tone ?? 'var(--text-faint)',
                    }}
                  >
                    {descriptor?.icon ?? <IconCheck size={13} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.8125rem] leading-snug">
                      {descriptor ? descriptor.text(event) : event.type}
                      {event.fileDeleted ? (
                        <span className="meta ml-2" title="The file no longer exists">
                          deleted since
                        </span>
                      ) : null}
                    </p>
                    <p className="meta mt-0.5 flex flex-wrap items-center gap-x-2">
                      <span title={formatDateTime(event.createdAt)}>{relativeTime(event.createdAt)}</span>
                      {anonymous ? <span>· anonymous visitor</span> : null}
                      {event.ip ? <span>· {event.ip}</span> : null}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {cursor ? (
          <button type="button" className="btn btn-outline mt-6 w-full" onClick={() => void load(cursor)}>
            <IconSpinner size={12} style={{ opacity: 0 }} />
            Load older activity
          </button>
        ) : (
          <p className="meta mt-6 text-center">That is the beginning of the record.</p>
        )}
      </div>
    </div>
  );
}

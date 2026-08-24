'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatBytes, pluralise, relativeTime, shortHash, splitBytes } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { useVault } from '@/lib/vault-context';
import { StorageCore } from '@/components/shell/StorageCore';
import { Confirm } from '@/components/ui/Confirm';
import { IconCheck, IconClock, IconSpinner, IconTrash, IconWarn } from '@/components/ui/icons';
import type { Insights } from '@/lib/types';

/**
 * Insights.
 *
 * "You are out of space" is not actionable, and neither is a pie chart. These
 * are the four questions someone actually has at that moment — what is biggest,
 * what is duplicated, what have I never opened, and what is version history
 * costing me — each with the rows behind it and a way to act.
 *
 * It also reports what content addressing has *saved*, which is the only place
 * in the interface where that work is visible.
 */
export default function InsightsPage() {
  const { stats, emptyTrash, trash, refresh } = useVault();
  const toast = useToast();
  const [report, setReport] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setReport(await api.get<Insights>('/insights'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not build the report.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const trashStale = async (ids: string[]) => {
    setBusy(true);
    try {
      await trash(ids);
      await Promise.all([load(), refresh()]);
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return <div className="p-8 text-center" style={{ color: 'var(--color-rust)' }}>{error}</div>;
  }

  if (!report) {
    return (
      <div className="mx-auto max-w-[52rem] space-y-3 px-4 py-6 sm:px-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-28 rounded-lg" />
        ))}
      </div>
    );
  }

  const saved = splitBytes(report.dedupSavedBytes);
  const reclaimable = report.reclaimable.trashBytes + report.reclaimable.unreferencedBytes;

  return (
    <div className="overflow-y-auto pb-24">
      <div className="mx-auto max-w-[52rem] space-y-6 px-4 py-6 sm:px-6">
        {/* ── the shape of the account ── */}
        <section className="panel p-4">
          <div className="flex flex-wrap items-start gap-8">
            <StorageCore stats={stats} />
            <dl className="grid grow grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <dt className="label mb-0.5">Saved by de-duplication</dt>
                <dd className="flex items-baseline gap-1">
                  <span className="tnum text-[1.25rem] leading-none" style={{ color: 'var(--color-moss)' }}>
                    {saved.value}
                  </span>
                  <span className="meta">{saved.unit}</span>
                </dd>
                <p className="meta mt-1">bytes you would have paid for twice</p>
              </div>
              <div>
                <dt className="label mb-0.5">Version history</dt>
                <dd className="tnum text-[1.25rem] leading-none">{formatBytes(report.reclaimable.versionBytes)}</dd>
                <p className="meta mt-1">superseded revisions still kept</p>
              </div>
              <div>
                <dt className="label mb-0.5">In the trash</dt>
                <dd className="tnum text-[1.25rem] leading-none">{formatBytes(report.reclaimable.trashBytes)}</dd>
                <p className="meta mt-1">{pluralise(report.reclaimable.trashCount, 'file')}, recoverable</p>
              </div>
              <div>
                <dt className="label mb-0.5">Reclaimable now</dt>
                <dd className="tnum text-[1.25rem] leading-none" style={{ color: reclaimable > 0 ? 'var(--accent)' : undefined }}>
                  {formatBytes(reclaimable)}
                </dd>
                {report.reclaimable.trashCount > 0 ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline mt-1.5"
                    onClick={() => setConfirmEmpty(true)}
                  >
                    <IconTrash size={11} />
                    Empty trash
                  </button>
                ) : (
                  <p className="meta mt-1">nothing waiting</p>
                )}
              </div>
            </dl>
          </div>
        </section>

        {/* ── largest ── */}
        <Panel title="Biggest files" hint="The ten files using the most space.">
          {report.largest.length === 0 ? (
            <Empty>Nothing stored yet.</Empty>
          ) : (
            <ul>
              {report.largest.map((file) => (
                <Row key={file.id} left={file.name} right={formatBytes(file.sizeBytes)} sub={`added ${relativeTime(file.createdAt)}`} />
              ))}
            </ul>
          )}
        </Panel>

        {/* ── duplicates ── */}
        <Panel
          title="The same file, more than once"
          hint="Stored once and pointed at twice, so these cost nothing extra — but they are still clutter."
        >
          {report.duplicates.length === 0 ? (
            <Empty>No duplicated contents.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {report.duplicates.map((group) => (
                <li key={group.checksum}>
                  <div className="flex items-baseline gap-2">
                    <span className="meta">{shortHash(group.checksum, 6)}</span>
                    <span className="text-[0.8125rem]">{formatBytes(group.sizeBytes)}</span>
                    <span className="meta">× {group.files.length} names</span>
                    <span
                      className="meta ml-auto flex items-center gap-1"
                      style={{ color: 'var(--color-moss)' }}
                      title="Content addressing means the extra copies used no additional space"
                    >
                      <IconCheck size={10} />
                      no extra space used
                    </span>
                  </div>
                  <ul className="mt-1 ml-3 space-y-0.5">
                    {group.files.map((file) => (
                      <li key={file.id} className="flex items-center gap-2 text-[0.8125rem]">
                        <span className="h-1 w-1 rounded-full" style={{ background: 'var(--text-faint)' }} />
                        <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-dim)' }}>
                          {file.name}
                        </span>
                        <span className="meta shrink-0">{relativeTime(file.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ── version-heavy ── */}
        <Panel title="Files with the most history" hint="Older revisions you could prune from a file's history panel.">
          {report.versionHeavy.length === 0 ? (
            <Empty>No file has a superseded revision.</Empty>
          ) : (
            <ul>
              {report.versionHeavy.map((file) => (
                <Row
                  key={file.id}
                  left={file.name}
                  right={formatBytes(file.historyBytes)}
                  sub={`${file.versionCount} revisions`}
                />
              ))}
            </ul>
          )}
        </Panel>

        {/* ── stale ── */}
        <Panel
          title="Untouched for 90 days"
          hint="Never downloaded since it arrived, and old enough that you have probably forgotten it."
          action={
            report.stale.length > 0 ? (
              <button
                type="button"
                className="btn btn-sm btn-outline"
                disabled={busy}
                onClick={() => void trashStale(report.stale.map((f) => f.id))}
              >
                {busy ? <IconSpinner size={11} /> : <IconTrash size={11} />}
                Move all to trash
              </button>
            ) : null
          }
        >
          {report.stale.length === 0 ? (
            <Empty>Everything here has been opened recently.</Empty>
          ) : (
            <ul>
              {report.stale.map((file) => (
                <Row
                  key={file.id}
                  left={file.name}
                  right={formatBytes(file.sizeBytes)}
                  sub={file.lastAccessedAt ? `last opened ${relativeTime(file.lastAccessedAt)}` : 'never opened'}
                />
              ))}
            </ul>
          )}
        </Panel>

        {report.reclaimable.unreferencedBytes > 0 ? (
          <p className="meta flex items-start gap-2 leading-relaxed">
            <IconWarn size={12} className="mt-px shrink-0" />
            {formatBytes(report.reclaimable.unreferencedBytes)} of orphaned content is waiting for the next
            housekeeping pass. It no longer counts against your quota.
          </p>
        ) : null}

        <p className="meta flex items-start gap-2 leading-relaxed">
          <IconClock size={12} className="mt-px shrink-0" />
          Trashed files are purged automatically after 30 days.{' '}
          <Link href="/vault/trash" className="link">
            Open the trash
          </Link>
        </p>
      </div>

      <Confirm
        open={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        onConfirm={async () => {
          await emptyTrash();
          await load();
        }}
        title="Empty the trash?"
        body={`${formatBytes(report.reclaimable.trashBytes)} across ${pluralise(report.reclaimable.trashCount, 'file')} will be deleted from storage immediately. This cannot be undone.`}
        confirmLabel="Empty trash"
        requirePhrase="empty trash"
        danger
      />
    </div>
  );
}

function Panel({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[0.9375rem] font-medium">{title}</h2>
          <p className="mt-0.5 max-w-[34rem] text-[0.75rem] leading-snug" style={{ color: 'var(--text-dim)' }}>
            {hint}
          </p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Row({ left, right, sub }: { left: string; right: string; sub: string }) {
  return (
    <li className="flex items-center gap-3 py-1.5" style={{ borderTop: '1px solid var(--line)' }}>
      <span className="min-w-0 flex-1 truncate text-[0.8125rem]">{left}</span>
      <span className="meta shrink-0">{sub}</span>
      <span className="tnum w-[4.5rem] shrink-0 text-right text-[0.8125rem]">{right}</span>
    </li>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[0.8125rem]" style={{ color: 'var(--text-faint)' }}>
    {children}
  </p>
);

'use client';

import { useState } from 'react';
import { formatBytes, formatDuration, formatRate, truncateMiddle } from '@/lib/format';
import { summarise, type Transfer } from '@/lib/upload-manager';
import { useVault } from '@/lib/vault-context';
import { IconCheck, IconChevron, IconClose, IconRestore, IconUpload, IconWarn } from '@/components/ui/icons';

/**
 * Transfer dock.
 *
 * Modelled on a download manager rather than a toast: uploads of 100 MB+ take
 * long enough that people leave the page, come back, and need to know what
 * happened. Every transfer keeps its own rate, ETA, cancel and retry, and the
 * throughput sparkline makes a stalled connection obvious at a glance.
 */
export function TransferDock() {
  const { transfers, cancelTransfer, retryTransfer, dismissTransfer, clearFinishedTransfers } = useVault();
  const [collapsed, setCollapsed] = useState(false);

  if (transfers.length === 0) return null;
  const totals = summarise(transfers);

  return (
    <div className="fixed right-4 bottom-4 z-50 w-[min(21rem,calc(100vw-2rem))]">
      <div className="sheet animate-rise overflow-hidden">
        <header
          className="flex h-9 items-center gap-2 px-3"
          style={{ borderBottom: collapsed ? 'none' : '1px solid var(--line)', background: 'var(--panel-2)' }}
        >
          <span style={{ color: totals.active ? 'var(--accent)' : 'var(--text-faint)' }}>
            <IconUpload size={13} />
          </span>
          <p className="flex-1 text-[0.75rem]">
            {totals.active > 0 ? (
              <>
                Uploading {totals.active}
                <span className="meta ml-2">
                  {formatRate(totals.rate)}
                  {totals.etaSeconds !== null ? ` · ${formatDuration(totals.etaSeconds)} left` : ''}
                </span>
              </>
            ) : totals.failed > 0 ? (
              <span style={{ color: 'var(--color-rust)' }}>
                {totals.failed} failed{totals.done ? `, ${totals.done} done` : ''}
              </span>
            ) : (
              <>
                {totals.done} uploaded
                <span className="meta ml-2">all done</span>
              </>
            )}
          </p>
          {totals.active === 0 ? (
            <button type="button" className="btn btn-sm btn-ghost" onClick={clearFinishedTransfers}>
              Clear
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-sm btn-ghost btn-icon"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand transfers' : 'Collapse transfers'}
          >
            <IconChevron size={12} dir={collapsed ? 'up' : 'down'} />
          </button>
        </header>

        {totals.active > 0 ? (
          <div className="h-0.5 w-full" style={{ background: 'var(--line)' }}>
            <div
              className="h-full transition-[width]"
              style={{ width: `${totals.percent}%`, background: 'var(--accent)', transitionDuration: '260ms' }}
            />
          </div>
        ) : null}

        {!collapsed ? (
          <ul className="max-h-[17rem] overflow-y-auto">
            {transfers.map((transfer) => (
              <li key={transfer.id} className="px-3 py-2" style={{ borderBottom: '1px solid var(--line)' }}>
                <TransferRow
                  transfer={transfer}
                  onCancel={() => cancelTransfer(transfer.id)}
                  onRetry={() => retryTransfer(transfer.id)}
                  onDismiss={() => dismissTransfer(transfer.id)}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function TransferRow({
  transfer,
  onCancel,
  onRetry,
  onDismiss,
}: {
  transfer: Transfer;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const percent = transfer.size > 0 ? Math.min(100, (transfer.loaded / transfer.size) * 100) : 0;
  const remaining = transfer.rate > 0 ? (transfer.size - transfer.loaded) / transfer.rate : null;

  return (
    <div>
      <div className="flex items-center gap-2">
        <StatusMark status={transfer.status} />
        <span className="min-w-0 flex-1 truncate text-[0.75rem]" title={transfer.name}>
          {truncateMiddle(transfer.name, 30)}
        </span>
        <span className="meta shrink-0">{formatBytes(transfer.size)}</span>
        {transfer.status === 'uploading' || transfer.status === 'queued' ? (
          <button type="button" className="btn btn-sm btn-ghost btn-icon h-5 w-5" onClick={onCancel} aria-label="Cancel">
            <IconClose size={11} />
          </button>
        ) : transfer.status === 'error' ? (
          <button type="button" className="btn btn-sm btn-ghost btn-icon h-5 w-5" onClick={onRetry} aria-label="Retry">
            <IconRestore size={11} />
          </button>
        ) : (
          <button type="button" className="btn btn-sm btn-ghost btn-icon h-5 w-5" onClick={onDismiss} aria-label="Dismiss">
            <IconClose size={11} />
          </button>
        )}
      </div>

      {transfer.status === 'uploading' ? (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: 'var(--line)' }}>
            <div
              className="h-full rounded-full transition-[width]"
              style={{ width: `${percent}%`, background: 'var(--accent)', transitionDuration: '220ms' }}
            />
          </div>
          <Sparkline samples={transfer.samples} />
          <span className="meta w-[3.75rem] text-right">{formatRate(transfer.rate)}</span>
          <span className="meta w-[2.75rem] text-right">{remaining !== null ? formatDuration(remaining) : '—'}</span>
        </div>
      ) : null}

      {transfer.status === 'error' && transfer.error ? (
        <p className="mt-1 text-[0.6875rem] leading-snug" style={{ color: 'var(--color-rust)' }}>
          {transfer.error}
        </p>
      ) : null}

      {transfer.status === 'queued' ? <p className="meta mt-1">waiting</p> : null}
      {transfer.status === 'cancelled' ? <p className="meta mt-1">cancelled</p> : null}
    </div>
  );
}

function StatusMark({ status }: { status: Transfer['status'] }) {
  if (status === 'done') return <span style={{ color: 'var(--color-moss)' }}><IconCheck size={12} /></span>;
  if (status === 'error') return <span style={{ color: 'var(--color-rust)' }}><IconWarn size={12} /></span>;
  if (status === 'cancelled') return <span style={{ color: 'var(--text-faint)' }}><IconClose size={12} /></span>;
  return (
    <span
      className="block h-2 w-2 shrink-0 rounded-full"
      style={{
        background: status === 'uploading' ? 'var(--accent)' : 'var(--text-faint)',
        animation: status === 'uploading' ? 'pulse-line 1.1s ease-in-out infinite' : undefined,
      }}
    />
  );
}

/** Throughput over the last few seconds — flat means stalled. */
function Sparkline({ samples }: { samples: number[] }) {
  if (samples.length < 2) return <span className="w-10" />;
  const peak = Math.max(...samples, 1);
  const points = samples
    .slice(-20)
    .map((value, index, list) => `${(index / Math.max(1, list.length - 1)) * 40},${10 - (value / peak) * 9}`)
    .join(' ');

  return (
    <svg width="40" height="10" className="shrink-0" aria-hidden>
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1" opacity="0.75" />
    </svg>
  );
}

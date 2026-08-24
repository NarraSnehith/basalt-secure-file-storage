'use client';

import { useRef, useState } from 'react';
import { formatBytes, formatDuration, formatRate, truncateMiddle } from '@/lib/format';
import { summarise, type Transfer } from '@/lib/upload-manager';
import { useVault } from '@/lib/vault-context';
import {
  IconCheck, IconChevron, IconClose, IconRestore, IconUpload, IconWarn,
} from '@/components/ui/icons';

/**
 * Transfer dock.
 *
 * Modelled on a download manager rather than a toast, because an upload of any
 * real size outlives the user's attention. Each transfer shows what stage it is
 * in — hashing, sending, paused, finished — with its own rate, ETA, throughput
 * sparkline, and its own pause, resume and cancel.
 *
 * Two states here exist only because the upload is resumable:
 *
 *  · **paused** after a network failure. Nothing is lost; the server is holding
 *    every chunk that arrived, and resuming asks it what is still missing.
 *  · **interrupted**, for a session that outlived the page. The browser will not
 *    hand back a file's contents without a fresh gesture, so this one asks for
 *    the file again — and then sends only the part that never made it.
 */
export function TransferDock() {
  const {
    transfers, cancelTransfer, retryTransfer, pauseTransfer, resumeTransfer,
    attachTransferFile, dismissTransfer, clearFinishedTransfers,
  } = useVault();
  const [collapsed, setCollapsed] = useState(false);
  const repick = useRef<HTMLInputElement>(null);
  const repickFor = useRef<string | null>(null);

  if (transfers.length === 0) return null;
  const totals = summarise(transfers);

  return (
    <div className="fixed right-4 bottom-4 z-50 w-[min(23rem,calc(100vw-2rem))]">
      <input
        ref={repick}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          const id = repickFor.current;
          if (file && id) attachTransferFile(id, file);
          event.target.value = '';
          repickFor.current = null;
        }}
      />

      <div className="sheet animate-rise overflow-hidden">
        <header
          className="flex h-9 items-center gap-2 px-3"
          style={{
            borderBottom: collapsed ? 'none' : '1px solid var(--line)',
            background: 'var(--panel-2)',
          }}
        >
          <span style={{ color: totals.active ? 'var(--accent)' : 'var(--text-faint)' }}>
            <IconUpload size={13} />
          </span>
          <p className="flex-1 truncate text-[0.75rem]">
            {totals.active > 0 ? (
              <>
                Uploading {totals.active}
                <span className="meta ml-2">
                  {formatRate(totals.rate)}
                  {totals.etaSeconds !== null ? ` · ${formatDuration(totals.etaSeconds)} left` : ''}
                </span>
              </>
            ) : totals.paused > 0 ? (
              <span style={{ color: 'var(--color-clay)' }}>
                {totals.paused} paused{totals.done ? `, ${totals.done} done` : ''}
              </span>
            ) : totals.failed > 0 ? (
              <span style={{ color: 'var(--color-rust)' }}>
                {totals.failed} failed{totals.done ? `, ${totals.done} done` : ''}
              </span>
            ) : (
              <>
                {totals.done} uploaded
                {totals.instant > 0 ? (
                  <span className="meta ml-2">{totals.instant} already had</span>
                ) : (
                  <span className="meta ml-2">all done</span>
                )}
              </>
            )}
          </p>
          {totals.active === 0 && totals.paused === 0 ? (
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
          <ul className="max-h-[19rem] overflow-y-auto">
            {transfers.map((transfer) => (
              <li key={transfer.id} className="px-3 py-2" style={{ borderBottom: '1px solid var(--line)' }}>
                <TransferRow
                  transfer={transfer}
                  onCancel={() => cancelTransfer(transfer.id)}
                  onRetry={() => retryTransfer(transfer.id)}
                  onPause={() => pauseTransfer(transfer.id)}
                  onResume={() => resumeTransfer(transfer.id)}
                  onDismiss={() => dismissTransfer(transfer.id)}
                  onRepick={() => {
                    repickFor.current = transfer.id;
                    repick.current?.click();
                  }}
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
  onPause,
  onResume,
  onDismiss,
  onRepick,
}: {
  transfer: Transfer;
  onCancel: () => void;
  onRetry: () => void;
  onPause: () => void;
  onResume: () => void;
  onDismiss: () => void;
  onRepick: () => void;
}) {
  const percent = transfer.size > 0 ? Math.min(100, (transfer.loaded / transfer.size) * 100) : 0;
  const remaining = transfer.rate > 0 ? (transfer.size - transfer.loaded) / transfer.rate : null;
  const active = transfer.status === 'uploading' || transfer.status === 'hashing';

  return (
    <div>
      <div className="flex items-center gap-2">
        <StatusMark status={transfer.status} instant={transfer.instant} />
        <span className="min-w-0 flex-1 truncate text-[0.75rem]" title={transfer.name}>
          {truncateMiddle(transfer.name, 28)}
        </span>
        <span className="meta shrink-0">{formatBytes(transfer.size)}</span>

        {active ? (
          <>
            <button
              type="button"
              className="btn btn-sm btn-ghost btn-icon h-5 w-5"
              onClick={onPause}
              aria-label="Pause"
              title="Pause"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <rect x="1.5" y="1" width="2.5" height="8" rx="0.8" fill="currentColor" />
                <rect x="6" y="1" width="2.5" height="8" rx="0.8" fill="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost btn-icon h-5 w-5"
              onClick={onCancel}
              aria-label="Cancel"
            >
              <IconClose size={11} />
            </button>
          </>
        ) : transfer.status === 'paused' ? (
          <>
            <button
              type="button"
              className="btn btn-sm btn-outline h-5 px-1.5 text-[0.625rem]"
              onClick={transfer.needsFile ? onRepick : onResume}
            >
              {transfer.needsFile ? 'Choose file' : 'Resume'}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost btn-icon h-5 w-5"
              onClick={onCancel}
              aria-label="Cancel"
            >
              <IconClose size={11} />
            </button>
          </>
        ) : transfer.status === 'error' ? (
          <>
            <button
              type="button"
              className="btn btn-sm btn-ghost btn-icon h-5 w-5"
              onClick={onRetry}
              aria-label="Try again"
            >
              <IconRestore size={11} />
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost btn-icon h-5 w-5"
              onClick={onDismiss}
              aria-label="Dismiss"
            >
              <IconClose size={11} />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-ghost btn-icon h-5 w-5"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            <IconClose size={11} />
          </button>
        )}
      </div>

      {transfer.status === 'hashing' ? (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: 'var(--line)' }}>
            <div
              className="h-full rounded-full transition-[width]"
              style={{
                width: `${transfer.hashProgress * 100}%`,
                background: 'var(--color-lapis)',
                transitionDuration: '220ms',
              }}
            />
          </div>
          <span className="meta shrink-0">checking if you already have it</span>
        </div>
      ) : null}

      {transfer.status === 'uploading' ? (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: 'var(--line)' }}>
            <div
              className="h-full rounded-full transition-[width]"
              style={{ width: `${percent}%`, background: 'var(--accent)', transitionDuration: '220ms' }}
            />
          </div>
          <Sparkline samples={transfer.samples} />
          <span className="meta w-[3.5rem] text-right">{formatRate(transfer.rate)}</span>
          <span className="meta w-[2.5rem] text-right">{remaining !== null ? formatDuration(remaining) : '—'}</span>
        </div>
      ) : null}

      {transfer.status === 'paused' ? (
        <div className="mt-1.5">
          <div className="h-[3px] w-full overflow-hidden rounded-full" style={{ background: 'var(--line)' }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${percent}%`, background: 'var(--color-clay)' }}
            />
          </div>
          <p className="meta mt-1">
            {transfer.chunkCount > 0
              ? `${transfer.chunksDone} of ${transfer.chunkCount} parts sent · ${transfer.error ?? 'paused'}`
              : (transfer.error ?? 'paused')}
          </p>
        </div>
      ) : null}

      {transfer.status === 'done' ? (
        <p className="meta mt-1">
          {transfer.instant
            ? 'already in your drive — nothing to upload'
            : transfer.deduped
              ? 'stored without using extra space'
              : transfer.versioned
                ? `saved as version ${transfer.version}`
                : 'stored'}
        </p>
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

function StatusMark({ status, instant }: { status: Transfer['status']; instant: boolean }) {
  if (status === 'done') {
    return (
      <span style={{ color: instant ? 'var(--color-lapis)' : 'var(--color-moss)' }} title={instant ? 'Already stored' : 'Uploaded'}>
        <IconCheck size={12} />
      </span>
    );
  }
  if (status === 'error') return <span style={{ color: 'var(--color-rust)' }}><IconWarn size={12} /></span>;
  if (status === 'cancelled') return <span style={{ color: 'var(--text-faint)' }}><IconClose size={12} /></span>;
  if (status === 'paused') {
    return (
      <span className="block h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--color-clay)' }} />
    );
  }
  return (
    <span
      className="block h-2 w-2 shrink-0 rounded-full"
      style={{
        background: status === 'hashing' ? 'var(--color-lapis)' : status === 'uploading' ? 'var(--accent)' : 'var(--text-faint)',
        animation: status === 'uploading' || status === 'hashing' ? 'pulse-line 1.1s ease-in-out infinite' : undefined,
      }}
    />
  );
}

/** Throughput over the last few seconds — flat means stalled. */
function Sparkline({ samples }: { samples: number[] }) {
  if (samples.length < 2) return <span className="w-9" />;
  const peak = Math.max(...samples, 1);
  const points = samples
    .slice(-20)
    .map((value, index, list) => `${(index / Math.max(1, list.length - 1)) * 36},${10 - (value / peak) * 9}`)
    .join(' ');

  return (
    <svg width="36" height="10" className="shrink-0" aria-hidden>
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1" opacity="0.75" />
    </svg>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatBytes, formatDateTime, relativeTime } from '@/lib/format';
import { useCopy } from '@/lib/hooks';
import { useToast } from '@/lib/toast';
import { useLiveFile, useVault } from '@/lib/vault-context';
import { Modal } from '@/components/ui/Modal';
import { Switch } from '@/components/ui/Switch';
import {
  IconCheck, IconClose, IconEye, IconGlobe, IconLink, IconLock, IconPlus, IconSpinner, IconTrash,
} from '@/components/ui/icons';
import type { ShareLink, ShareReceipt, StoredFile } from '@/lib/types';

const EXPIRY_PRESETS = [
  { label: 'Never', hours: null },
  { label: '1 hour', hours: 1 },
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
] as const;

/**
 * Sharing, in one sheet.
 *
 * The switch at the top is the simple case people actually want: public or not.
 * Underneath it are links with their own password, expiry and download budget —
 * because "public" and "one download for the lawyer, expiring Friday" are
 * different problems and one control cannot honestly do both.
 */
export function ShareSheet({ file: snapshot, onClose }: { file: StoredFile; onClose: () => void }) {
  const { setVisibility, patchFile } = useVault();
  // Read through to the store so the switch and the header follow every change.
  const file = useLiveFile(snapshot);
  const toast = useToast();
  const [shares, setShares] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const isPublic = file.visibility === 'public';

  const load = useCallback(async () => {
    try {
      const { shares: list } = await api.get<{ shares: ShareLink[] }>(`/shares/for/${file.id}`);
      setShares(list);
    } catch (err) {
      if (err instanceof ApiError) toast.error('Could not load links', err.message);
    } finally {
      setLoading(false);
    }
  }, [file.id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const togglePublic = async (next: boolean) => {
    setBusy(true);
    try {
      const updated = await setVisibility(file.id, next ? 'public' : 'private');
      setShares(updated);
      toast.success(next ? 'Anyone with the link can now download this' : 'File is private again — every link was revoked');
    } catch (err) {
      toast.error('Could not change visibility', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (share: ShareLink) => {
    setBusy(true);
    try {
      await api.del(`/shares/${share.id}`);
      const remaining = shares.filter((s) => s.id !== share.id);
      setShares(remaining);
      if (remaining.length === 0) patchFile({ ...file, visibility: 'private', publicUrl: null, shareCount: 0 });
      else patchFile({ ...file, shareCount: remaining.length });
      toast.success('Link revoked');
    } catch (err) {
      toast.error('Could not revoke the link', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const toggleLink = shares.find((s) => s.kind === 'toggle');
  const customLinks = shares.filter((s) => s.kind === 'custom');

  return (
    <Modal open onClose={onClose} title="Share" description={file.name} width={34}>
      <div
        className="flex items-start gap-3 rounded-md p-3"
        style={{ background: isPublic ? 'var(--accent-wash)' : 'var(--panel-2)', border: `1px solid ${isPublic ? 'color-mix(in oklab, var(--accent) 22%, transparent)' : 'var(--line)'}` }}
      >
        <span className="mt-0.5" style={{ color: isPublic ? 'var(--accent)' : 'var(--text-faint)' }}>
          {isPublic ? <IconGlobe size={15} /> : <IconLock size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-medium">{isPublic ? 'Public link is on' : 'Private to you'}</p>
          <p className="mt-0.5 text-[0.75rem] leading-snug" style={{ color: 'var(--text-dim)' }}>
            {isPublic
              ? 'Anyone with the address can download it. No account needed.'
              : 'Only your signed-in account can open this file.'}
          </p>
        </div>
        <Switch checked={isPublic} onChange={togglePublic} busy={busy} label="Public link" />
      </div>

      {toggleLink ? (
        <div className="mt-3">
          <LinkRow share={toggleLink} onRevoke={() => void togglePublic(false)} />
        </div>
      ) : null}

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[0.8125rem] font-medium">Links with conditions</p>
            <p className="mt-0.5 text-[0.75rem]" style={{ color: 'var(--text-dim)' }}>
              Add a password, an expiry, or a download budget.
            </p>
          </div>
          {!creating ? (
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setCreating(true)}>
              <IconPlus size={12} />
              New link
            </button>
          ) : null}
        </div>

        {creating ? (
          <CreateLinkForm
            fileId={file.id}
            onCancel={() => setCreating(false)}
            onCreated={(share) => {
              setShares((current) => [share, ...current]);
              setCreating(false);
              patchFile({ ...file, visibility: 'public', shareCount: shares.length + 1 });
              toast.success('Link created');
            }}
          />
        ) : null}

        <div className="mt-3 space-y-2">
          {loading ? <div className="skeleton h-14 rounded-md" /> : null}
          {!loading && customLinks.length === 0 && !creating ? (
            <p className="py-3 text-center text-[0.75rem]" style={{ color: 'var(--text-faint)' }}>
              No conditional links yet.
            </p>
          ) : null}
          {customLinks.map((share) => (
            <LinkRow key={share.id} share={share} onRevoke={() => void revoke(share)} detailed />
          ))}
        </div>
      </div>

      <p className="mt-5 flex items-start gap-2 text-[0.75rem] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        <IconEye size={13} className="mt-px shrink-0" />
        Every visit and download is recorded. Open a link’s receipts to see who has been.
      </p>
    </Modal>
  );
}

function LinkRow({ share, onRevoke, detailed }: { share: ShareLink; onRevoke: () => void; detailed?: boolean }) {
  const [copied, copy] = useCopy();
  const [receipts, setReceipts] = useState<ShareReceipt[] | null>(null);
  const [showReceipts, setShowReceipts] = useState(false);
  const dead = share.expired || share.exhausted;

  const openReceipts = async () => {
    setShowReceipts((v) => !v);
    if (receipts !== null) return;
    try {
      const { receipts: list } = await api.get<{ receipts: ShareReceipt[] }>(`/shares/${share.id}/receipts`);
      setReceipts(list);
    } catch {
      setReceipts([]);
    }
  };

  return (
    <div className="rounded-md p-2.5" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', opacity: dead ? 0.6 : 1 }}>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={share.url}
          onFocus={(event) => event.currentTarget.select()}
          className="field h-7 flex-1 text-[0.75rem]"
          style={{ fontFamily: 'var(--font-mono)' }}
          aria-label="Share link"
        />
        <button type="button" className="btn btn-sm btn-outline shrink-0" onClick={() => void copy(share.url)}>
          {copied ? <IconCheck size={12} /> : <IconLink size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="btn btn-sm btn-ghost btn-icon shrink-0" onClick={onRevoke} aria-label="Revoke link" title="Revoke">
          <IconTrash size={13} />
        </button>
      </div>

      {detailed || share.hasPassword || share.expiresAt || share.maxDownloads ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {share.label ? <span className="text-[0.75rem]">{share.label}</span> : null}
          {share.hasPassword ? (
            <span className="meta flex items-center gap-1" style={{ color: 'var(--color-clay)' }}>
              <IconLock size={10} /> password
            </span>
          ) : null}
          {share.expiresAt ? (
            <span className="meta" style={{ color: share.expired ? 'var(--color-rust)' : undefined }} title={formatDateTime(share.expiresAt)}>
              {share.expired ? 'expired' : `expires ${relativeTime(share.expiresAt)}`}
            </span>
          ) : null}
          {share.maxDownloads !== null ? (
            <span className="meta" style={{ color: share.exhausted ? 'var(--color-rust)' : undefined }}>
              {share.downloadCount}/{share.maxDownloads} downloads
            </span>
          ) : (
            <span className="meta">{share.downloadCount} downloads</span>
          )}
          {!share.allowPreview ? <span className="meta">download only</span> : null}
          {share.lastAccessedAt ? <span className="meta">last opened {relativeTime(share.lastAccessedAt)}</span> : null}
          <button
            type="button"
            className="meta ml-auto underline decoration-[var(--line-strong)] underline-offset-2 transition-colors hover:text-[var(--text)]"
            onClick={() => void openReceipts()}
          >
            {showReceipts ? 'hide receipts' : 'receipts'}
          </button>
        </div>
      ) : null}

      {showReceipts ? (
        <div className="animate-rise mt-2 rounded-md p-2" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
          {receipts === null ? (
            <div className="skeleton h-8 rounded" />
          ) : receipts.length === 0 ? (
            <p className="text-[0.75rem]" style={{ color: 'var(--text-faint)' }}>
              Nobody has opened this link yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {receipts.slice(0, 12).map((receipt) => (
                <li key={receipt.id} className="flex items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      background:
                        receipt.type === 'share.download'
                          ? 'var(--color-moss)'
                          : receipt.type === 'share.denied'
                            ? 'var(--color-rust)'
                            : 'var(--color-lapis)',
                    }}
                  />
                  <span className="flex-1 truncate text-[0.75rem]">
                    {receipt.type === 'share.download'
                      ? 'Downloaded'
                      : receipt.type === 'share.denied'
                        ? 'Wrong password'
                        : 'Opened'}
                    {receipt.anonymous ? '' : ' by you'}
                  </span>
                  <span className="meta shrink-0" title={formatDateTime(receipt.createdAt)}>
                    {relativeTime(receipt.createdAt)}
                  </span>
                  <span className="meta w-[6rem] shrink-0 truncate text-right">{receipt.ip ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CreateLinkForm({
  fileId,
  onCancel,
  onCreated,
}: {
  fileId: string;
  onCancel: () => void;
  onCreated: (share: ShareLink) => void;
}) {
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [expiryHours, setExpiryHours] = useState<number | null>(24 * 7);
  const [maxDownloads, setMaxDownloads] = useState('');
  const [allowPreview, setAllowPreview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { share } = await api.post<{ share: ShareLink }>('/shares', {
        fileId,
        label: label.trim() || null,
        password: password.trim() || null,
        expiresAt: expiryHours ? new Date(Date.now() + expiryHours * 3_600_000).toISOString() : null,
        maxDownloads: maxDownloads.trim() ? Number(maxDownloads) : null,
        allowPreview,
      });
      onCreated(share);
    } catch (err) {
      setError(err instanceof ApiError ? (err.field('password') ?? err.message) : 'Could not create the link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-rise mt-3 rounded-md p-3" style={{ background: 'var(--panel-2)', border: '1px solid var(--line-strong)' }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Label (optional)</label>
          <input className="field h-8" placeholder="For the auditor" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div>
          <label className="label">Password (optional)</label>
          <input
            className="field h-8"
            type="text"
            placeholder="6+ characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="label">Expires</label>
        <div className="flex flex-wrap gap-1.5">
          {EXPIRY_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={`btn btn-sm ${expiryHours === preset.hours ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setExpiryHours(preset.hours)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Download limit</label>
          <input
            className="field h-8"
            inputMode="numeric"
            placeholder="Unlimited"
            value={maxDownloads}
            onChange={(e) => setMaxDownloads(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </div>
        <div className="flex items-end">
          <label className="flex cursor-pointer items-center gap-2 pb-1.5 text-[0.8125rem]">
            <Switch checked={allowPreview} onChange={setAllowPreview} label="Allow preview" />
            Allow in-browser preview
          </label>
        </div>
      </div>

      {error ? (
        <p className="mt-2.5 text-[0.75rem]" style={{ color: 'var(--color-rust)' }}>
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel} disabled={busy}>
          <IconClose size={12} />
          Cancel
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={submit} disabled={busy}>
          {busy ? <IconSpinner size={12} /> : <IconLink size={12} />}
          Create link
        </button>
      </div>
    </div>
  );
}

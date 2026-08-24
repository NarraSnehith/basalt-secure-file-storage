'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatBytes, formatDateTime, relativeTime } from '@/lib/format';
import { useCopy } from '@/lib/hooks';
import { useToast } from '@/lib/toast';
import { childFolders, useVault } from '@/lib/vault-context';
import { EmptyState } from '@/components/files/EmptyState';
import { Confirm } from '@/components/ui/Confirm';
import { Modal } from '@/components/ui/Modal';
import { Switch } from '@/components/ui/Switch';
import {
  IconCheck, IconChevron, IconClock, IconFolder, IconLink, IconLock, IconPlus,
  IconSpinner, IconTrash, IconUpload,
} from '@/components/ui/icons';
import type { FileRequest, RequestSubmission } from '@/lib/types';

const EXPIRY_PRESETS = [
  { label: 'Never', days: null },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
] as const;

/**
 * Upload links.
 *
 * The inverse of sharing: instead of handing someone a file, you hand them a
 * way to give you one. The frustration this removes is "please email me those
 * files" — attachment limits, no integrity check, no idea what arrived — and
 * unlike the equivalent elsewhere, the sender needs no account at all.
 */
export default function RequestsPage() {
  const { folders, refresh } = useVault();
  const toast = useToast();
  const [requests, setRequests] = useState<FileRequest[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<FileRequest | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { requests: list } = await api.get<{ requests: FileRequest[] }>('/requests');
      setRequests(list);
    } catch (err) {
      if (err instanceof ApiError) toast.error('Could not load your links', err.message);
      setRequests([]);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (request: FileRequest) => {
    try {
      await api.del(`/requests/${request.id}`);
      setRequests((current) => (current ?? []).filter((r) => r.id !== request.id));
      toast.success('Link closed', 'Anyone holding it now gets a 404.');
    } catch (err) {
      toast.error('Could not close the link', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <div className="overflow-y-auto pb-24">
      <div className="mx-auto max-w-[52rem] px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[1.375rem] tracking-[-0.015em]" style={{ fontFamily: 'var(--font-display)' }}>
              Upload links
            </h1>
            <p className="mt-1 max-w-[34rem] text-[0.875rem] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
              Give someone a link and they can send files straight into one of your folders — no
              account, no attachment limit. You set the caps and can close it at any time.
            </p>
          </div>
          <button type="button" className="btn btn-primary shrink-0" onClick={() => setCreating(true)}>
            <IconPlus size={14} />
            New link
          </button>
        </header>

        {requests === null ? (
          <div className="mt-6 space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="skeleton h-24 rounded-lg" />
            ))}
          </div>
        ) : requests.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No upload links yet"
              body="Create one, send it to whoever owes you files, and watch them arrive in the folder you chose."
              seed={67}
              action={
                <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                  <IconPlus size={14} />
                  Create a link
                </button>
              }
            />
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {requests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                expanded={open === request.id}
                onToggle={() => setOpen(open === request.id ? null : request.id)}
                onRevoke={() => setRevoking(request)}
              />
            ))}
          </ul>
        )}
      </div>

      {creating ? (
        <CreateRequest
          folders={childFolders(folders, null).length ? folders : folders}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setRequests((current) => [created, ...(current ?? [])]);
            setCreating(false);
            setOpen(created.id);
            void refresh();
            toast.success('Link ready', 'Copy it and send it on.');
          }}
        />
      ) : null}

      {revoking ? (
        <Confirm
          open
          onClose={() => setRevoking(null)}
          onConfirm={() => revoke(revoking)}
          title="Close this link?"
          body={
            <>
              Nobody will be able to upload through <strong style={{ color: 'var(--text)' }}>{revoking.title}</strong>{' '}
              again. Files already sent stay exactly where they are.
            </>
          }
          confirmLabel="Close link"
          danger
        />
      ) : null}
    </div>
  );
}

function RequestCard({
  request,
  expanded,
  onToggle,
  onRevoke,
}: {
  request: FileRequest;
  expanded: boolean;
  onToggle: () => void;
  onRevoke: () => void;
}) {
  const [copied, copy] = useCopy();
  const [submissions, setSubmissions] = useState<RequestSubmission[] | null>(null);

  useEffect(() => {
    if (!expanded || submissions !== null) return;
    void api
      .get<{ submissions: RequestSubmission[] }>(`/requests/${request.id}/submissions`)
      .then((data) => setSubmissions(data.submissions))
      .catch(() => setSubmissions([]));
  }, [expanded, submissions, request.id]);

  const closed = request.expired || request.full;

  return (
    <li className="panel overflow-hidden" style={{ opacity: closed ? 0.7 : 1 }}>
      <div className="p-3.5">
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
            style={{
              background: closed ? 'var(--panel-2)' : 'var(--accent-wash)',
              color: closed ? 'var(--text-faint)' : 'var(--accent)',
              border: '1px solid var(--line)',
            }}
          >
            <IconUpload size={15} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[0.9375rem]">{request.title}</h2>
              {request.hasPassword ? (
                <span title="Password protected" style={{ color: 'var(--color-clay)' }}>
                  <IconLock size={12} />
                </span>
              ) : null}
              {request.expired ? (
                <span className="chip" style={{ color: 'var(--color-rust)', background: 'color-mix(in oklab, var(--color-rust) 14%, transparent)' }}>
                  expired
                </span>
              ) : request.full ? (
                <span className="chip" style={{ color: 'var(--color-clay)', background: 'color-mix(in oklab, var(--color-clay) 14%, transparent)' }}>
                  full
                </span>
              ) : null}
            </div>

            {request.message ? (
              <p className="mt-1 text-[0.8125rem] leading-snug" style={{ color: 'var(--text-dim)' }}>
                {request.message}
              </p>
            ) : null}

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="meta flex items-center gap-1">
                <IconFolder size={10} />
                {request.folderName ?? 'a folder'}
              </span>
              <span className="meta">
                {request.submissionCount} received · {formatBytes(request.receivedBytes)}
              </span>
              {request.maxFiles !== null ? (
                <span className="meta">{request.remainingFiles} of {request.maxFiles} slots left</span>
              ) : null}
              {request.maxBytes !== null ? (
                <span className="meta">{formatBytes(request.remainingBytes ?? 0)} of space left</span>
              ) : null}
              {request.expiresAt ? (
                <span className="meta flex items-center gap-1" title={formatDateTime(request.expiresAt)}>
                  <IconClock size={10} />
                  {request.expired ? 'expired' : `closes ${relativeTime(request.expiresAt)}`}
                </span>
              ) : (
                <span className="meta">no expiry</span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" className="btn btn-sm btn-outline" onClick={() => void copy(request.url)}>
              {copied ? <IconCheck size={12} /> : <IconLink size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <a className="btn btn-sm btn-ghost" href={request.url} target="_blank" rel="noreferrer">
              Open
            </a>
            <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={onRevoke} aria-label="Close link">
              <IconTrash size={13} />
            </button>
          </div>
        </div>

        <button
          type="button"
          className="mt-3 flex items-center gap-1.5 text-[0.75rem] transition-colors hover:text-[var(--text)]"
          style={{ color: 'var(--text-dim)' }}
          onClick={onToggle}
          aria-expanded={expanded}
        >
          <IconChevron size={11} dir={expanded ? 'down' : 'right'} />
          {expanded ? 'Hide' : 'Show'} what has arrived
        </button>
      </div>

      {expanded ? (
        <div className="animate-rise px-3.5 pb-3.5" style={{ borderTop: '1px solid var(--line)' }}>
          {submissions === null ? (
            <div className="skeleton mt-3 h-12 rounded-md" />
          ) : submissions.length === 0 ? (
            <p className="mt-3 text-[0.8125rem]" style={{ color: 'var(--text-faint)' }}>
              Nothing has arrived through this link yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-1">
              {submissions.map((submission) => (
                <li key={submission.id} className="flex items-center gap-2 py-1">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: submission.present ? 'var(--color-moss)' : 'var(--text-faint)' }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem]">{submission.filename}</span>
                  <span className="meta shrink-0">{formatBytes(submission.sizeBytes)}</span>
                  <span className="meta w-[7rem] shrink-0 truncate text-right">
                    {submission.submitter ?? 'anonymous'}
                  </span>
                  <span className="meta w-[5rem] shrink-0 text-right" title={formatDateTime(submission.createdAt)}>
                    {relativeTime(submission.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}

function CreateRequest({
  folders,
  onClose,
  onCreated,
}: {
  folders: ReturnType<typeof useVault>['folders'];
  onClose: () => void;
  onCreated: (request: FileRequest) => void;
}) {
  const [title, setTitle] = useState('Send me your files');
  const [message, setMessage] = useState('');
  const [folderId, setFolderId] = useState(folders[0]?.id ?? '');
  const [password, setPassword] = useState('');
  const [maxFiles, setMaxFiles] = useState('20');
  const [maxMb, setMaxMb] = useState('500');
  const [expiryDays, setExpiryDays] = useState<number | null>(30);
  const [limitFiles, setLimitFiles] = useState(true);
  const [limitSize, setLimitSize] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!folderId) {
      setError('Create a folder first — uploads have to land somewhere.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { request } = await api.post<{ request: FileRequest }>('/requests', {
        folderId,
        title: title.trim(),
        message: message.trim() || null,
        password: password.trim() || null,
        maxFiles: limitFiles && maxFiles ? Number(maxFiles) : null,
        maxBytes: limitSize && maxMb ? Number(maxMb) * 1024 * 1024 : null,
        expiresAt: expiryDays ? new Date(Date.now() + expiryDays * 86_400_000).toISOString() : null,
      });
      onCreated(request);
    } catch (err) {
      setError(err instanceof ApiError ? (err.field('folderId') ?? err.message) : 'Could not create the link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New upload link"
      description="Anyone with the address can send files into the folder you pick."
      width={32}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !title.trim()}>
            {busy ? <IconSpinner size={13} /> : <IconLink size={13} />}
            Create link
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">What are you asking for?</label>
          <input className="field" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div>
          <label className="label">Note for the sender (optional)</label>
          <textarea
            className="field h-16 py-2"
            style={{ height: 'auto' }}
            rows={2}
            maxLength={500}
            placeholder="PDF please, by Friday."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Where should it land?</label>
          <select className="field" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            {folders.length === 0 ? <option value="">No folders yet</option> : null}
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[0.75rem]" style={{ color: 'var(--text-faint)' }}>
            Uploads count against your quota, and a sender can never overwrite a file you already have.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="flex cursor-pointer items-center gap-2 pb-1.5 text-[0.8125rem]">
              <Switch checked={limitFiles} onChange={setLimitFiles} label="Limit file count" />
              Cap the number of files
            </label>
            <input
              className="field h-8"
              inputMode="numeric"
              disabled={!limitFiles}
              value={maxFiles}
              onChange={(e) => setMaxFiles(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </div>
          <div>
            <label className="flex cursor-pointer items-center gap-2 pb-1.5 text-[0.8125rem]">
              <Switch checked={limitSize} onChange={setLimitSize} label="Limit total size" />
              Cap the total size (MB)
            </label>
            <input
              className="field h-8"
              inputMode="numeric"
              disabled={!limitSize}
              value={maxMb}
              onChange={(e) => setMaxMb(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
        </div>

        <div>
          <label className="label">Closes after</label>
          <div className="flex flex-wrap gap-1.5">
            {EXPIRY_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={`btn btn-sm ${expiryDays === preset.days ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setExpiryDays(preset.days)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Password (optional)</label>
          <input
            className="field h-8"
            placeholder="6+ characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
          />
        </div>

        {error ? (
          <p className="text-[0.8125rem]" style={{ color: 'var(--color-rust)' }} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

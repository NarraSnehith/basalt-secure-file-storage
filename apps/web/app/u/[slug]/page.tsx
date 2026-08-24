'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, ApiError, request as apiRequest } from '@/lib/api';
import { putChunkXhr, sendChunks } from '@/lib/chunked';
import { formatBytes, formatRate, relativeTime, truncateMiddle } from '@/lib/format';
import { hashFile } from '@/lib/sha256';
import { ColumnArt } from '@/components/brand/ColumnArt';
import { Wordmark } from '@/components/brand/Logo';
import {
  IconCheck, IconClock, IconClose, IconLock, IconSpinner, IconUpload, IconWarn,
} from '@/components/ui/icons';

interface RequestView {
  slug: string;
  requiresPassword: boolean;
  unlocked?: boolean;
  title?: string;
  message?: string | null;
  ownerName: string;
  maxFiles?: number | null;
  maxBytes?: number | null;
  remainingFiles?: number | null;
  remainingBytes?: number | null;
  expiresAt?: string | null;
  full?: boolean;
}

type SendStatus = 'hashing' | 'sending' | 'done' | 'error';

interface Send {
  id: string;
  name: string;
  size: number;
  status: SendStatus;
  loaded: number;
  rate: number;
  error: string | null;
  instant: boolean;
}

/**
 * The page a sender sees.
 *
 * They have no account and no reason to trust this address, so it says who is
 * asking, what for, and what the limits are — then gets out of the way. Uploads
 * here are the same resumable, hashed, chunked transfers the owner's own dock
 * makes: a stranger sending a 2 GB video over hotel wifi deserves that at least
 * as much as the owner does.
 */
export default function UploadLinkPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? '';

  const [view, setView] = useState<RequestView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [grant, setGrant] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [sender, setSender] = useState('');
  const [sends, setSends] = useState<Send[]>([]);
  const [dropping, setDropping] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (withGrant?: string) => {
      try {
        const data = await apiRequest<{ request: RequestView }>(
          `/r/${slug}${withGrant ? `?g=${encodeURIComponent(withGrant)}` : ''}`,
        );
        setView(data.request);
        setError(null);
      } catch (err) {
        if (err instanceof ApiError) setError(err);
      }
    },
    [slug],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    setUnlocking(true);
    setUnlockError(null);
    try {
      const data = await apiRequest<{ grant: string }>(`/r/${slug}/unlock`, {
        method: 'POST',
        body: { password },
      });
      setGrant(data.grant);
      await load(data.grant);
    } catch (err) {
      setUnlockError(err instanceof ApiError ? err.message : 'Could not unlock this link.');
    } finally {
      setUnlocking(false);
    }
  };

  const patch = (id: string, changes: Partial<Send>) =>
    setSends((current) => current.map((s) => (s.id === id ? { ...s, ...changes } : s)));

  const sendFile = useCallback(
    async (file: File) => {
      seq.current += 1;
      const id = `s${seq.current}`;
      setSends((current) => [
        ...current,
        { id, name: file.name, size: file.size, status: 'hashing', loaded: 0, rate: 0, error: null, instant: false },
      ]);

      const headers: Record<string, string> = grant ? { 'X-Request-Grant': grant } : {};
      const controller = new AbortController();

      try {
        // Hash first: if they already hold these bytes there is nothing to send.
        const checksum = file.size <= 512 * 1024 * 1024 ? await hashFile(file) : null;

        const opened = await postJson<{ instant: boolean; session?: SessionShape }>(
          `/r/${slug}/uploads`,
          { filename: file.name, size: file.size, declaredMime: file.type || null, checksum, submitter: sender.trim() || null },
          headers,
        );

        if (opened.instant) {
          patch(id, { status: 'done', loaded: file.size, instant: true });
          void load(grant ?? undefined);
          return;
        }

        const session = opened.session!;
        patch(id, { status: 'sending' });

        let lastAt = Date.now();
        let lastLoaded = 0;
        await sendChunks({
          file,
          chunkSize: session.chunkSize,
          missing: session.missing,
          concurrency: 3,
          signal: controller.signal,
          put: (index, blob, onProgress) =>
            putChunkXhr(
              `${API_BASE}/r/${slug}/uploads/${session.id}/chunks/${index}`,
              blob,
              headers,
              controller.signal,
              onProgress,
            ),
          onProgress: (confirmed, inflight) => {
            const loaded = Math.min(file.size, confirmed * session.chunkSize + inflight);
            const now = Date.now();
            if (now - lastAt >= 250) {
              const instant = ((loaded - lastLoaded) / (now - lastAt)) * 1000;
              lastAt = now;
              lastLoaded = loaded;
              patch(id, { loaded, rate: instant });
            } else {
              patch(id, { loaded });
            }
          },
        });

        await postJson(`/r/${slug}/uploads/${session.id}/complete`, { submitter: sender.trim() || null }, headers);
        patch(id, { status: 'done', loaded: file.size, rate: 0 });
        void load(grant ?? undefined);
      } catch (err) {
        patch(id, {
          status: 'error',
          rate: 0,
          error: err instanceof Error ? err.message : 'Upload failed.',
        });
      }
    },
    [grant, load, sender, slug],
  );

  const queue = (files: File[]) => {
    for (const file of files) void sendFile(file);
  };

  const locked = view?.requiresPassword && !view.unlocked;
  const closed = view?.full;
  const delivered = sends.filter((s) => s.status === 'done').length;

  return (
    <main
      className="relative flex min-h-dvh flex-col"
      onDragOver={(event) => {
        if (!locked && !closed && event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropping(false);
      }}
      onDrop={(event) => {
        if (locked || closed) return;
        event.preventDefault();
        setDropping(false);
        queue(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[20rem] opacity-70" style={{ color: 'var(--line)' }} aria-hidden>
        <ColumnArt seed={71} columns={32} className="h-full w-full" />
      </div>

      <header className="relative mx-auto flex h-16 w-full max-w-[60rem] items-center justify-between px-5">
        <Link href="/" className="transition-opacity hover:opacity-80">
          <Wordmark />
        </Link>
        <span className="meta hidden sm:inline">upload link</span>
      </header>

      <div className="relative flex flex-1 items-start justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-[34rem]">
          {error ? (
            <Unavailable error={error} />
          ) : !view ? (
            <div className="panel flex h-48 items-center justify-center">
              <IconSpinner size={20} style={{ color: 'var(--text-faint)' }} />
            </div>
          ) : locked ? (
            <form onSubmit={unlock} className="panel p-6 text-center">
              <span
                className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg"
                style={{ background: 'var(--accent-wash)', color: 'var(--accent)', border: '1px solid color-mix(in oklab, var(--accent) 24%, transparent)' }}
              >
                <IconLock size={18} />
              </span>
              <h1 className="mt-4 text-[1.25rem]" style={{ fontFamily: 'var(--font-display)' }}>
                This upload link needs a password
              </h1>
              <p className="mt-1.5 text-[0.8125rem]" style={{ color: 'var(--text-dim)' }}>
                {view.ownerName} protected it.
              </p>
              <input
                type="password"
                autoFocus
                className={`field mt-5 text-center ${unlockError ? 'field-error' : ''}`}
                placeholder="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="off"
              />
              {unlockError ? (
                <p className="mt-2 text-[0.75rem]" style={{ color: 'var(--color-rust)' }} role="alert">
                  {unlockError}
                </p>
              ) : null}
              <button type="submit" className="btn btn-primary mt-3 h-10 w-full" disabled={unlocking || !password}>
                {unlocking ? <IconSpinner size={14} /> : null}
                Unlock
              </button>
            </form>
          ) : (
            <>
              <div className="panel p-6">
                <p className="eyebrow">{view.ownerName} is asking for files</p>
                <h1 className="mt-3 text-[1.5rem] leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
                  {view.title}
                </h1>
                {view.message ? (
                  <p className="mt-2 text-[0.875rem] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
                    {view.message}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {view.remainingFiles !== null && view.remainingFiles !== undefined ? (
                    <span className="meta">{view.remainingFiles} files accepted</span>
                  ) : (
                    <span className="meta">no file limit</span>
                  )}
                  {view.remainingBytes !== null && view.remainingBytes !== undefined ? (
                    <span className="meta">{formatBytes(view.remainingBytes)} of space left</span>
                  ) : null}
                  {view.expiresAt ? (
                    <span className="meta flex items-center gap-1">
                      <IconClock size={10} />
                      closes {relativeTime(view.expiresAt)}
                    </span>
                  ) : null}
                </div>

                {closed ? (
                  <p
                    className="mt-4 rounded-md px-3 py-2 text-[0.8125rem]"
                    style={{ background: 'color-mix(in oklab, var(--color-clay) 12%, transparent)', color: 'var(--color-clay)' }}
                  >
                    This link has taken everything it can accept. Ask {view.ownerName} for another.
                  </p>
                ) : (
                  <>
                    <div className="mt-5">
                      <label className="label">Your name (optional)</label>
                      <input
                        className="field h-9"
                        placeholder="So they know who sent it"
                        value={sender}
                        maxLength={80}
                        onChange={(event) => setSender(event.target.value)}
                      />
                    </div>

                    <button
                      type="button"
                      className="mt-4 flex w-full flex-col items-center justify-center rounded-lg py-8 transition-colors"
                      style={{
                        border: `1.5px dashed ${dropping ? 'var(--accent)' : 'var(--line-strong)'}`,
                        background: dropping ? 'color-mix(in oklab, var(--accent) 8%, transparent)' : 'transparent',
                      }}
                      onClick={() => input.current?.click()}
                    >
                      <IconUpload size={20} style={{ color: dropping ? 'var(--accent)' : 'var(--text-faint)' }} />
                      <span className="mt-2 text-[0.875rem]">Drop files here, or choose them</span>
                      <span className="meta mt-1">
                        large files are sent in parts and survive a dropped connection
                      </span>
                    </button>
                    <input
                      ref={input}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        queue(Array.from(event.target.files ?? []));
                        event.target.value = '';
                      }}
                    />
                  </>
                )}
              </div>

              {sends.length > 0 ? (
                <div className="panel animate-rise mt-3 p-3">
                  <p className="eyebrow mb-2">
                    {delivered} of {sends.length} sent
                  </p>
                  <ul className="space-y-2">
                    {sends.map((send) => (
                      <li key={send.id}>
                        <div className="flex items-center gap-2">
                          <SendMark status={send.status} instant={send.instant} />
                          <span className="min-w-0 flex-1 truncate text-[0.8125rem]">
                            {truncateMiddle(send.name, 32)}
                          </span>
                          <span className="meta shrink-0">{formatBytes(send.size)}</span>
                        </div>
                        {send.status === 'sending' ? (
                          <div className="mt-1 flex items-center gap-2">
                            <div className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: 'var(--line)' }}>
                              <div
                                className="h-full rounded-full transition-[width]"
                                style={{
                                  width: `${Math.min(100, (send.loaded / send.size) * 100)}%`,
                                  background: 'var(--accent)',
                                  transitionDuration: '220ms',
                                }}
                              />
                            </div>
                            <span className="meta w-[4rem] text-right">{formatRate(send.rate)}</span>
                          </div>
                        ) : null}
                        {send.status === 'hashing' ? <p className="meta mt-1">preparing</p> : null}
                        {send.status === 'done' ? (
                          <p className="meta mt-1" style={{ color: 'var(--color-moss)' }}>
                            {send.instant ? 'they already had this one' : 'delivered'}
                          </p>
                        ) : null}
                        {send.status === 'error' ? (
                          <p className="mt-1 text-[0.75rem]" style={{ color: 'var(--color-rust)' }}>
                            {send.error}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <p className="meta mt-5 leading-relaxed">
                Files go straight to {view.ownerName}’s storage. You cannot see anything else in it, and
                nothing you send can replace a file they already have.
              </p>
            </>
          )}
        </div>
      </div>

      <footer className="relative mx-auto w-full max-w-[60rem] px-5 py-8">
        <p className="meta">
          Powered by Basalt ·{' '}
          <Link href="/register" className="link">
            store your own files
          </Link>
        </p>
      </footer>
    </main>
  );
}

interface SessionShape {
  id: string;
  chunkSize: number;
  chunkCount: number;
  missing: number[];
}

/** Anonymous JSON POST: no CSRF token, because there is no session to ride on. */
async function postJson<T>(path: string, body: unknown, headers: Record<string, string>): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? `Request failed (${res.status}).`);
  }
  return (await res.json()) as T;
}

function SendMark({ status, instant }: { status: SendStatus; instant: boolean }) {
  if (status === 'done') {
    return (
      <span style={{ color: instant ? 'var(--color-lapis)' : 'var(--color-moss)' }}>
        <IconCheck size={13} />
      </span>
    );
  }
  if (status === 'error') return <span style={{ color: 'var(--color-rust)' }}><IconClose size={13} /></span>;
  return (
    <span
      className="block h-2 w-2 shrink-0 rounded-full"
      style={{ background: 'var(--accent)', animation: 'pulse-line 1.1s ease-in-out infinite' }}
    />
  );
}

function Unavailable({ error }: { error: ApiError }) {
  const copy =
    error.code === 'share_expired'
      ? { title: 'This link has closed', body: 'The person who created it set an end date, and it has passed.' }
      : error.code === 'share_exhausted'
        ? { title: 'This link is full', body: 'It has already taken everything it was set up to accept.' }
        : { title: 'This link is not available', body: 'It may have been closed, or the address may be mistyped.' };

  return (
    <div className="panel p-8 text-center">
      <span
        className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg"
        style={{ background: 'var(--panel-2)', color: 'var(--color-clay)', border: '1px solid var(--line)' }}
      >
        <IconWarn size={18} />
      </span>
      <h1 className="mt-4 text-[1.25rem]" style={{ fontFamily: 'var(--font-display)' }}>
        {copy.title}
      </h1>
      <p className="mx-auto mt-2 max-w-[24rem] text-[0.8125rem] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
        {copy.body}
      </p>
      <Link href="/" className="btn btn-outline mt-6">
        Go to Basalt
      </Link>
    </div>
  );
}

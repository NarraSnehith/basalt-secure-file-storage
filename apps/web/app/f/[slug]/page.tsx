'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, request, shareContentUrl } from '@/lib/api';
import { formatBytes, formatDate, relativeTime, shortHash } from '@/lib/format';
import { useCopy } from '@/lib/hooks';
import { previewMode, type FileKind } from '@/lib/kinds';
import { ColumnArt } from '@/components/brand/ColumnArt';
import { Wordmark } from '@/components/brand/Logo';
import { KindGlyph } from '@/components/files/KindGlyph';
import {
  IconCheck, IconClock, IconDownload, IconEye, IconLink, IconLock, IconSpinner, IconWarn,
} from '@/components/ui/icons';

interface SharePayload {
  slug: string;
  requiresPassword: boolean;
  unlocked?: boolean;
  ownerName: string;
  createdAt: string;
  expiresAt: string | null;
  maxDownloads?: number | null;
  downloadCount?: number;
  remainingDownloads?: number | null;
  allowPreview?: boolean;
  file?: { name: string; kind: FileKind; mimeType: string; sizeBytes: number; checksum: string };
}

/**
 * What a recipient sees. No account, no sign-up wall — a page about one file,
 * with everything needed to decide whether to trust it: who shared it, how big
 * it is, its content hash, and any conditions attached to the link.
 */
export default function SharePage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? '';
  const [share, setShare] = useState<SharePayload | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [grant, setGrant] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [copied, copy] = useCopy();

  const load = useCallback(
    async (withGrant?: string) => {
      try {
        const data = await request<{ share: SharePayload }>(
          `/s/${slug}${withGrant ? `?g=${encodeURIComponent(withGrant)}` : ''}`,
        );
        setShare(data.share);
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
      const data = await request<{ grant: string }>(`/s/${slug}/unlock`, {
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

  return (
    <main className="relative flex min-h-dvh flex-col">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[22rem] opacity-70" style={{ color: 'var(--line)' }} aria-hidden>
        <ColumnArt seed={53} columns={34} className="h-full w-full" />
      </div>

      <header className="relative mx-auto flex h-16 w-full max-w-[60rem] items-center justify-between px-5">
        <Link href="/" className="transition-opacity hover:opacity-80">
          <Wordmark />
        </Link>
        <span className="meta hidden sm:inline">shared file</span>
      </header>

      <div className="relative flex flex-1 items-start justify-center px-4 py-8 sm:py-14">
        <div className="w-full max-w-[34rem]">
          {error ? (
            <UnavailableCard error={error} />
          ) : !share ? (
            <div className="panel flex h-56 items-center justify-center">
              <IconSpinner size={20} style={{ color: 'var(--text-faint)' }} />
            </div>
          ) : share.requiresPassword && !share.unlocked ? (
            <form onSubmit={unlock} className="panel p-6 text-center">
              <span
                className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg"
                style={{ background: 'var(--accent-wash)', color: 'var(--accent)', border: '1px solid color-mix(in oklab, var(--accent) 24%, transparent)' }}
              >
                <IconLock size={18} />
              </span>
              <h1 className="mt-4 text-[1.25rem]" style={{ fontFamily: 'var(--font-display)' }}>
                This link needs a password
              </h1>
              <p className="mt-1.5 text-[0.8125rem]" style={{ color: 'var(--text-dim)' }}>
                {share.ownerName} protected it. Nothing about the file is shown until it is entered.
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
              {share.expiresAt ? (
                <p className="meta mt-4">link expires {relativeTime(share.expiresAt)}</p>
              ) : null}
            </form>
          ) : share.file ? (
            <>
              <article className="panel overflow-hidden">
                <div className="flex items-start gap-4 p-6">
                  <KindGlyph kind={share.file.kind} size={52} />
                  <div className="min-w-0 flex-1">
                    <h1 className="text-[1.375rem] leading-tight break-words" style={{ fontFamily: 'var(--font-display)' }}>
                      {share.file.name}
                    </h1>
                    <p className="meta mt-2">
                      {formatBytes(share.file.sizeBytes)} · {share.file.mimeType}
                    </p>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-px" style={{ background: 'var(--line)' }}>
                  <Cell label="Shared by" value={share.ownerName} />
                  <Cell label="Added" value={formatDate(share.createdAt)} />
                  <Cell
                    label="Expires"
                    value={share.expiresAt ? relativeTime(share.expiresAt) : 'Never'}
                    tone={share.expiresAt ? 'warn' : undefined}
                  />
                  <Cell
                    label="Downloads left"
                    value={
                      share.remainingDownloads === null || share.remainingDownloads === undefined
                        ? 'Unlimited'
                        : String(share.remainingDownloads)
                    }
                    tone={share.remainingDownloads !== null && (share.remainingDownloads ?? 1) <= 1 ? 'warn' : undefined}
                  />
                </dl>

                <div className="flex flex-col gap-2 p-4 sm:flex-row" style={{ borderTop: '1px solid var(--line)' }}>
                  <a
                    className="btn btn-primary h-10 flex-1"
                    href={shareContentUrl(slug, 'attachment', grant)}
                    download={share.file.name}
                  >
                    <IconDownload size={14} />
                    Download {formatBytes(share.file.sizeBytes)}
                  </a>
                  {share.allowPreview && previewMode(share.file.mimeType, share.file.kind) ? (
                    <button type="button" className="btn btn-outline h-10" onClick={() => setShowPreview((v) => !v)}>
                      <IconEye size={14} />
                      {showPreview ? 'Hide preview' : 'Preview'}
                    </button>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-4">
                  <button
                    type="button"
                    className="meta flex items-center gap-1.5 transition-colors hover:text-[var(--text)]"
                    onClick={() => void copy(share.file!.checksum)}
                    title="Copy the SHA-256 digest to verify the download"
                  >
                    sha256 {shortHash(share.file.checksum, 8)}
                    {copied ? <IconCheck size={11} /> : <IconLink size={11} />}
                  </button>
                  <span className="meta">· verify your download matches</span>
                </div>
              </article>

              {showPreview ? <SharePreview slug={slug} grant={grant} file={share.file} /> : null}

              <p className="meta mt-5 flex items-start gap-2 leading-relaxed">
                <IconEye size={12} className="mt-px shrink-0" />
                The owner can see that this link was opened and downloaded, with the time and address.
              </p>
            </>
          ) : null}
        </div>
      </div>

      <footer className="relative mx-auto w-full max-w-[60rem] px-5 py-8">
        <p className="meta">
          Stored on Basalt ·{' '}
          <Link href="/register" className="link">
            store your own files
          </Link>
        </p>
      </footer>
    </main>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="p-4" style={{ background: 'var(--panel)' }}>
      <dt className="label mb-1">{label}</dt>
      <dd className="text-[0.8125rem]" style={{ color: tone === 'warn' ? 'var(--color-clay)' : 'var(--text)' }}>
        {value}
      </dd>
    </div>
  );
}

function SharePreview({
  slug,
  grant,
  file,
}: {
  slug: string;
  grant: string | null;
  file: { name: string; kind: FileKind; mimeType: string };
}) {
  const url = shareContentUrl(slug, 'inline', grant);
  const mode = previewMode(file.mimeType, file.kind);

  return (
    <div className="panel animate-rise mt-3 overflow-hidden p-2">
      {mode === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={file.name} className="mx-auto max-h-[60vh] rounded-md object-contain" />
      ) : mode === 'video' ? (
        <video src={url} controls className="w-full rounded-md" />
      ) : mode === 'audio' ? (
        <audio src={url} controls className="w-full" />
      ) : mode === 'pdf' ? (
        <iframe src={url} title={file.name} className="h-[70vh] w-full rounded-md" style={{ background: 'var(--panel-2)' }} />
      ) : mode === 'text' ? (
        <iframe src={url} title={file.name} className="h-[50vh] w-full rounded-md" style={{ background: 'var(--panel-2)' }} />
      ) : null}
    </div>
  );
}

function UnavailableCard({ error }: { error: ApiError }) {
  const gone = error.code === 'share_expired' || error.code === 'share_exhausted';
  const copy =
    error.code === 'share_expired'
      ? { title: 'This link has expired', body: 'The person who shared it set an expiry date, and that date has passed. Ask them for a fresh link.' }
      : error.code === 'share_exhausted'
        ? { title: 'This link is used up', body: 'It was limited to a set number of downloads and has reached it. Ask the owner for another.' }
        : { title: 'This link is not available', body: 'It may have been revoked, the file may have been deleted, or the address may be mistyped.' };

  return (
    <div className="panel p-8 text-center">
      <span
        className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg"
        style={{
          background: gone ? 'color-mix(in oklab, var(--color-clay) 14%, transparent)' : 'var(--panel-2)',
          color: gone ? 'var(--color-clay)' : 'var(--text-faint)',
          border: '1px solid var(--line)',
        }}
      >
        {gone ? <IconClock size={18} /> : <IconWarn size={18} />}
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

'use client';

import { useCallback, useEffect, useState } from 'react';
import { fileContentUrl } from '@/lib/api';
import { formatBytes, formatDateTime, relativeTime, shortHash } from '@/lib/format';
import { KIND_NOUN, previewMode } from '@/lib/kinds';
import { useCopy } from '@/lib/hooks';
import { useLiveFile, useVault } from '@/lib/vault-context';
import {
  IconCheck, IconChevron, IconClose, IconDownload, IconLink, IconShare, IconSpinner, IconStar,
} from '@/components/ui/icons';
import type { StoredFile } from '@/lib/types';
import { Badges } from './Badges';
import { KindGlyph, ExtensionChip } from './KindGlyph';
import { VersionHistory } from './VersionHistory';

/**
 * Full-screen preview.
 *
 * Only formats we are willing to render in-page get rendered; anything else
 * (including any upload whose bytes contradicted its extension) shows its
 * details and a download button instead of being handed to the browser to
 * interpret. Arrow keys walk the current list without leaving the overlay.
 */
export function PreviewOverlay({
  file,
  onClose,
  onShare,
}: {
  file: StoredFile;
  onClose: () => void;
  onShare: (file: StoredFile) => void;
}) {
  const { files, star } = useVault();
  const [copied, copy] = useCopy();
  const index = files.findIndex((f) => f.id === file.id);
  const [shown, setShown] = useState(file);
  // Arrow keys change which file is shown; the store owns what that file *is*.
  const current = useLiveFile(shown);

  useEffect(() => setShown(file), [file]);

  const step = useCallback(
    (delta: number) => {
      const at = files.findIndex((f) => f.id === current.id);
      const next = files[at + delta];
      if (next) setShown(next);
    },
    [files, current.id],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, step]);

  const mode = current.previewable ? previewMode(current.mimeType, current.kind) : null;

  return (
    <div className="animate-fade fixed inset-0 z-[70] flex flex-col" style={{ background: 'color-mix(in oklab, var(--page) 96%, black)' }}>
      <header className="flex h-14 shrink-0 items-center gap-3 px-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <KindGlyph kind={current.kind} size={26} />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="truncate text-[0.875rem]">{current.name}</h2>
          <ExtensionChip extension={current.extension} kind={current.kind} />
          <Badges file={current} />
        </div>

        {index >= 0 && files.length > 1 ? (
          <div className="hidden items-center gap-1 sm:flex">
            <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => step(-1)} aria-label="Previous file">
              <IconChevron size={13} dir="left" />
            </button>
            <span className="meta w-[4.5rem] text-center">
              {files.findIndex((f) => f.id === current.id) + 1} of {files.length}
            </span>
            <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => step(1)} aria-label="Next file">
              <IconChevron size={13} />
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className="btn btn-sm btn-ghost btn-icon"
          style={{ color: current.starred ? 'var(--color-clay)' : undefined }}
          onClick={() => void star([current.id], !current.starred)}
          aria-label={current.starred ? 'Remove star' : 'Star'}
        >
          <IconStar size={14} filled={current.starred} />
        </button>
        <button type="button" className="btn btn-sm btn-outline" onClick={() => onShare(current)}>
          <IconShare size={13} />
          <span className="hidden sm:inline">Share</span>
        </button>
        <a className="btn btn-sm btn-primary" href={fileContentUrl(current.id, 'attachment')} download>
          <IconDownload size={13} />
          <span className="hidden sm:inline">Download</span>
        </a>
        <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={onClose} aria-label="Close preview">
          <IconClose size={14} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4 sm:p-8">
          <PreviewBody file={current} mode={mode} />
        </div>

        <aside
          className="w-full shrink-0 overflow-y-auto p-4 lg:w-[19rem]"
          style={{ borderTop: '1px solid var(--line)', background: 'var(--panel)' }}
        >
          <p className="eyebrow mb-3">Details</p>
          <dl className="space-y-2.5">
            <Detail label="Type" value={`${KIND_NOUN[current.kind]} · ${current.mimeType}`} />
            {current.mimeMismatch && current.declaredMime ? (
              <Detail label="Declared as" value={current.declaredMime} tone="warn" />
            ) : null}
            <Detail label="Size" value={`${formatBytes(current.sizeBytes)} · ${current.sizeBytes.toLocaleString()} bytes`} />
            <Detail label="Added" value={formatDateTime(current.createdAt)} />
            <Detail label="Modified" value={relativeTime(current.updatedAt)} />
            <Detail label="Downloads" value={String(current.downloadCount)} />
            {current.versionCount > 1 ? (
              <Detail label="Revision" value={`${current.version} of ${current.versionCount}`} />
            ) : null}
            {current.searchable ? <Detail label="Indexed" value="Contents are searchable" /> : null}
            <Detail label="Visibility" value={current.visibility === 'public' ? `Public · ${current.shareCount} link${current.shareCount === 1 ? '' : 's'}` : 'Private'} />
            <div>
              <dt className="label mb-1">SHA-256</dt>
              <dd>
                <button
                  type="button"
                  className="meta flex items-center gap-1.5 transition-colors hover:text-[var(--text)]"
                  onClick={() => void copy(current.checksum)}
                  title="Copy the full digest"
                >
                  {shortHash(current.checksum, 10)}
                  {copied ? <IconCheck size={11} /> : <IconLink size={11} />}
                </button>
              </dd>
            </div>
          </dl>

          {current.versionCount > 1 ? (
            <div className="mt-5">
              <p className="eyebrow mb-1">
                History · {current.versionCount} revisions
              </p>
              <VersionHistory file={current} />
            </div>
          ) : null}

          {current.publicUrl ? (
            <div className="mt-4 rounded-md p-2.5" style={{ background: 'var(--accent-wash)', border: '1px solid color-mix(in oklab, var(--accent) 22%, transparent)' }}>
              <p className="text-[0.75rem]" style={{ color: 'var(--text-dim)' }}>
                Anyone with this link can download it.
              </p>
              <button
                type="button"
                className="btn btn-sm btn-outline mt-2 w-full"
                onClick={() => void copy(current.publicUrl!)}
              >
                {copied ? <IconCheck size={12} /> : <IconLink size={12} />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Detail({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div>
      <dt className="label mb-0.5">{label}</dt>
      <dd className="text-[0.8125rem] break-words" style={{ color: tone === 'warn' ? 'var(--color-clay)' : 'var(--text-dim)' }}>
        {value}
      </dd>
    </div>
  );
}

function PreviewBody({ file, mode }: { file: StoredFile; mode: ReturnType<typeof previewMode> }) {
  // The revision is part of the URL so restoring an older one re-fetches
  // instead of showing whatever the browser still had cached.
  const inline = `${fileContentUrl(file.id, 'inline')}&r=${file.version}`;

  if (mode === 'image') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={inline} alt={file.name} className="max-h-full max-w-full rounded-md object-contain" style={{ boxShadow: 'var(--shadow-lift)' }} />;
  }
  if (mode === 'video') {
    return <video src={inline} controls preload="metadata" className="max-h-full max-w-full rounded-md" style={{ boxShadow: 'var(--shadow-lift)' }} />;
  }
  if (mode === 'audio') {
    return (
      <div className="w-full max-w-md text-center">
        <KindGlyph kind="audio" size={72} />
        <p className="mt-4 text-[0.875rem]">{file.name}</p>
        <audio src={inline} controls className="mt-4 w-full" />
      </div>
    );
  }
  if (mode === 'pdf') {
    return (
      <iframe
        src={inline}
        title={file.name}
        className="h-full w-full rounded-md"
        style={{ border: '1px solid var(--line)', minHeight: '70vh', background: 'var(--panel)' }}
      />
    );
  }
  if (mode === 'text') return <TextPreview url={inline} />;

  return (
    <div className="max-w-sm text-center">
      <KindGlyph kind={file.kind} size={72} />
      <p className="mt-4 text-[0.875rem]">No in-page preview for this type</p>
      <p className="mt-1.5 text-[0.8125rem]" style={{ color: 'var(--text-dim)' }}>
        {file.mimeMismatch
          ? 'This file’s contents did not match its extension, so it is only ever served as a download.'
          : 'Download it to open in the right application.'}
      </p>
      <a className="btn btn-primary mt-4" href={fileContentUrl(file.id, 'attachment')} download>
        <IconDownload size={13} />
        Download {formatBytes(file.sizeBytes)}
      </a>
    </div>
  );
}

const TEXT_PREVIEW_LIMIT = 200_000;

function TextPreview({ url }: { url: string }) {
  const [state, setState] = useState<{ text: string; truncated: boolean } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // 'include', because the API may be on a different port than the app.
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.text();
        if (!cancelled) {
          setState({ text: body.slice(0, TEXT_PREVIEW_LIMIT), truncated: body.length > TEXT_PREVIEW_LIMIT });
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) return <p className="text-[0.8125rem]" style={{ color: 'var(--text-dim)' }}>Could not read this file.</p>;
  if (!state) return <IconSpinner size={20} />;

  return (
    <div className="h-full w-full max-w-4xl overflow-auto rounded-md p-4" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
      <pre className="text-[0.75rem] leading-relaxed whitespace-pre-wrap" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
        {state.text}
      </pre>
      {state.truncated ? (
        <p className="meta mt-3">Preview truncated at 200 KB — download for the whole file.</p>
      ) : null}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, fileContentUrl } from '@/lib/api';
import { formatBytes, formatDateTime, relativeTime, shortHash } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { useVault } from '@/lib/vault-context';
import { Confirm } from '@/components/ui/Confirm';
import { IconCheck, IconDownload, IconRestore, IconSpinner, IconTrash } from '@/components/ui/icons';
import type { FileVersion, StoredFile } from '@/lib/types';

const SOURCE_LABEL: Record<FileVersion['source'], string> = {
  upload: 'uploaded',
  request: 'received via a request link',
  restore: 'restored',
};

/**
 * Version history for one file.
 *
 * Every revision is downloadable on its own, and restoring appends rather than
 * rewinds — so the list only ever grows and "put it back the way it was" is
 * itself undoable. Deleting a revision is the only destructive action here, and
 * it says up front whether the space will actually come back: if another file
 * shares those exact bytes, it will not.
 */
export function VersionHistory({ file, onPreviewVersion }: { file: StoredFile; onPreviewVersion?: (version: number) => void }) {
  const { refresh, patchFile } = useVault();
  const toast = useToast();
  const [versions, setVersions] = useState<FileVersion[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<FileVersion | null>(null);

  const load = useCallback(async () => {
    try {
      const { versions: list } = await api.get<{ versions: FileVersion[] }>(`/files/${file.id}/versions`);
      setVersions(list);
    } catch (err) {
      if (err instanceof ApiError) toast.error('Could not load history', err.message);
      setVersions([]);
    }
  }, [file.id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (version: number) => {
    setBusy(version);
    try {
      const { file: updated } = await api.post<{ file: StoredFile }>(
        `/files/${file.id}/versions/${version}/restore`,
      );
      patchFile(updated);
      await load();
      toast.success(`Version ${version} is current again`, `Kept as version ${updated.version}.`);
    } catch (err) {
      toast.error('Could not restore', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (version: FileVersion) => {
    setBusy(version.version);
    try {
      const { freedBytes } = await api.del<{ freedBytes: number }>(
        `/files/${file.id}/versions/${version.version}`,
      );
      await load();
      await refresh();
      toast.success(
        `Version ${version.version} deleted`,
        freedBytes > 0 ? `${formatBytes(freedBytes)} returned to your quota.` : 'No space freed — another file shares those bytes.',
      );
    } catch (err) {
      toast.error('Could not delete that version', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  if (versions === null) return <div className="skeleton mt-2 h-16 rounded-md" />;
  if (versions.length <= 1) {
    return (
      <p className="mt-1 text-[0.75rem]" style={{ color: 'var(--text-faint)' }}>
        One revision. Uploading this file again keeps the old one here instead of making a numbered copy.
      </p>
    );
  }

  return (
    <>
      <ol className="mt-2 space-y-1.5">
        {versions.map((version) => (
          <li
            key={version.id}
            className="rounded-md p-2"
            style={{
              background: version.current ? 'var(--accent-wash)' : 'var(--panel-2)',
              border: `1px solid ${version.current ? 'color-mix(in oklab, var(--accent) 24%, transparent)' : 'var(--line)'}`,
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="chip shrink-0"
                style={{
                  color: version.current ? 'var(--accent)' : 'var(--text-dim)',
                  background: version.current ? 'color-mix(in oklab, var(--accent) 14%, transparent)' : 'var(--hover)',
                }}
              >
                v{version.version}
              </span>
              <span className="meta flex-1">{formatBytes(version.sizeBytes)}</span>
              {version.current ? (
                <span className="meta flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                  <IconCheck size={10} /> current
                </span>
              ) : busy === version.version ? (
                <IconSpinner size={12} />
              ) : (
                <span className="flex items-center gap-0.5">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost btn-icon h-5 w-5"
                    title="Restore this version"
                    aria-label={`Restore version ${version.version}`}
                    onClick={() => void restore(version.version)}
                  >
                    <IconRestore size={11} />
                  </button>
                  <a
                    className="btn btn-sm btn-ghost btn-icon h-5 w-5"
                    href={`${fileContentUrl(file.id, 'attachment')}&version=${version.version}`}
                    title="Download this version"
                    aria-label={`Download version ${version.version}`}
                  >
                    <IconDownload size={11} />
                  </a>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost btn-icon h-5 w-5"
                    title="Delete this version"
                    aria-label={`Delete version ${version.version}`}
                    onClick={() => setConfirmDelete(version)}
                  >
                    <IconTrash size={11} />
                  </button>
                </span>
              )}
            </div>

            <p className="meta mt-1">
              {SOURCE_LABEL[version.source]} {relativeTime(version.createdAt)}
              {version.shared ? ' · bytes shared with another file' : ''}
            </p>
            <button
              type="button"
              className="meta mt-0.5 block transition-colors hover:text-[var(--text)]"
              title={`${formatDateTime(version.createdAt)} · ${version.name}`}
              onClick={() => onPreviewVersion?.(version.version)}
            >
              {shortHash(version.checksum, 6)}
            </button>
          </li>
        ))}
      </ol>

      {confirmDelete ? (
        <Confirm
          open
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => remove(confirmDelete)}
          title={`Delete version ${confirmDelete.version}?`}
          body={
            confirmDelete.shared
              ? 'Another file points at these exact bytes, so nothing will be freed — only this entry in the history goes.'
              : `${formatBytes(confirmDelete.sizeBytes)} will be returned to your quota. This cannot be undone.`
          }
          confirmLabel="Delete version"
          danger
        />
      ) : null}
    </>
  );
}

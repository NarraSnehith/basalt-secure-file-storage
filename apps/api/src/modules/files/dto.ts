import { env } from '../../config/env.js';
import type { FileRow, ShareLinkRow } from '../../db/types.js';
import { classify, dispositionFor, type FileKind } from '../../lib/mime.js';

export interface ShareDTO {
  id: string;
  slug: string;
  url: string;
  kind: 'toggle' | 'custom';
  label: string | null;
  hasPassword: boolean;
  expiresAt: string | null;
  maxDownloads: number | null;
  downloadCount: number;
  allowPreview: boolean;
  createdAt: string;
  lastAccessedAt: string | null;
  expired: boolean;
  exhausted: boolean;
}

export interface FileDTO {
  id: string;
  name: string;
  extension: string | null;
  mimeType: string;
  declaredMime: string | null;
  mimeMismatch: boolean;
  kind: FileKind;
  sizeBytes: number;
  checksum: string;
  folderId: string | null;
  visibility: 'private' | 'public';
  starred: boolean;
  downloadCount: number;
  previewable: boolean;
  /** Current revision number; 1 for a file uploaded once. */
  version: number;
  versionCount: number;
  /** Set when the file arrived through a file request rather than the owner. */
  requestId: string | null;
  /** True once the contents have been read into the search index. */
  searchable: boolean;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
  deletedAt: string | null;
  purgeAfter: string | null;
  /** The public/private toggle's link, when the file is public. */
  publicUrl: string | null;
  shareCount: number;
}

export const shareUrl = (slug: string): string => `${env.WEB_ORIGIN}/f/${slug}`;

export function toShareDTO(row: ShareLinkRow): ShareDTO {
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  return {
    id: row.id,
    slug: row.slug,
    url: shareUrl(row.slug),
    kind: row.kind,
    label: row.label,
    hasPassword: Boolean(row.password_hash),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    maxDownloads: row.max_downloads,
    downloadCount: row.download_count,
    allowPreview: row.allow_preview,
    createdAt: new Date(row.created_at).toISOString(),
    lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at).toISOString() : null,
    expired: Boolean(expiresAt && expiresAt.getTime() <= Date.now()),
    exhausted: Boolean(row.max_downloads !== null && row.download_count >= row.max_downloads),
  };
}

export function toFileDTO(
  row: FileRow,
  extra: { publicSlug?: string | null; shareCount?: number } = {},
): FileDTO {
  const kind = (row.kind as FileKind) || classify(row.mime_type, row.extension);
  return {
    id: row.id,
    name: row.name,
    extension: row.extension,
    mimeType: row.mime_type,
    declaredMime: row.declared_mime,
    mimeMismatch: row.mime_mismatch,
    kind,
    sizeBytes: Number(row.size_bytes),
    checksum: Buffer.from(row.checksum_sha256).toString('hex'),
    folderId: row.folder_id,
    visibility: row.visibility,
    starred: row.starred,
    downloadCount: row.download_count,
    previewable: dispositionFor(row.mime_type, row.mime_mismatch) === 'inline',
    version: row.version,
    versionCount: row.version_count,
    requestId: row.request_id,
    searchable: row.content_indexed && row.content_text !== null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at).toISOString() : null,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    purgeAfter: row.purge_after ? new Date(row.purge_after).toISOString() : null,
    publicUrl: extra.publicSlug ? shareUrl(extra.publicSlug) : null,
    shareCount: extra.shareCount ?? 0,
  };
}

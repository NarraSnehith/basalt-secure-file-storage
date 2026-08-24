import type { FileKind } from './kinds';

export interface User {
  id: string;
  email: string;
  displayName: string;
  accent: string;
  quotaBytes: number;
  storageUsedBytes: number;
  createdAt: string;
}

export interface StoredFile {
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
  version: number;
  versionCount: number;
  /** Set when the file arrived through a request link rather than the owner. */
  requestId: string | null;
  /** True once the contents were read into the search index. */
  searchable: boolean;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
  deletedAt: string | null;
  purgeAfter: string | null;
  publicUrl: string | null;
  shareCount: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  fileCount: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShareLink {
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

export interface ShareWithFile extends ShareLink {
  file: { id: string; name: string; kind: FileKind; sizeBytes: number };
}

export interface StorageStats {
  quotaBytes: number;
  usedBytes: number;
  trashBytes: number;
  fileCount: number;
  folderCount: number;
  publicCount: number;
  strata: Array<{ kind: string; bytes: number; count: number }>;
  /** Bytes held by revisions that are no longer current. */
  versionBytes: number;
  /** What content addressing has saved this account. */
  dedupSavedBytes: number;
  unreferencedBytes: number;
}

export interface FileVersion {
  id: string;
  version: number;
  name: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  source: 'upload' | 'request' | 'restore';
  note: string | null;
  createdAt: string;
  current: boolean;
  /** These exact bytes are referenced somewhere else too. */
  shared: boolean;
}

export interface FileRequest {
  id: string;
  slug: string;
  url: string;
  title: string;
  message: string | null;
  folderId: string;
  folderName: string | null;
  hasPassword: boolean;
  maxFiles: number | null;
  maxBytes: number | null;
  expiresAt: string | null;
  submissionCount: number;
  receivedBytes: number;
  remainingFiles: number | null;
  remainingBytes: number | null;
  expired: boolean;
  full: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface RequestSubmission {
  id: string;
  fileId: string | null;
  filename: string;
  sizeBytes: number;
  submitter: string | null;
  ip: string | null;
  createdAt: string;
  present: boolean;
}

export interface ShareReceipt {
  id: string;
  type: 'share.view' | 'share.download' | 'share.denied' | string;
  createdAt: string;
  ip: string | null;
  userAgent: string | null;
  anonymous: boolean;
}

export interface Insights {
  largest: Array<{ id: string; name: string; kind: string; sizeBytes: number; createdAt: string }>;
  duplicates: Array<{
    checksum: string;
    sizeBytes: number;
    files: Array<{ id: string; name: string; folderId: string | null; createdAt: string }>;
    wastedBytes: number;
  }>;
  stale: Array<{ id: string; name: string; sizeBytes: number; createdAt: string; lastAccessedAt: string | null }>;
  versionHeavy: Array<{ id: string; name: string; versionCount: number; historyBytes: number }>;
  reclaimable: {
    trashBytes: number;
    trashCount: number;
    versionBytes: number;
    unreferencedBytes: number;
  };
  dedupSavedBytes: number;
}

export interface ActivityEvent {
  id: string;
  type: string;
  fileId: string | null;
  shareId: string | null;
  fileName: string | null;
  fileDeleted: boolean;
  subject: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

export interface FileListResponse {
  items: StoredFile[];
  nextCursor: string | null;
  total: number | null;
}

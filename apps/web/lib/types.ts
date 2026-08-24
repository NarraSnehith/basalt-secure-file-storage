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

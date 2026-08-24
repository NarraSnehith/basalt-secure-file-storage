import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export type FileVisibility = 'private' | 'public';
export type ShareKind = 'toggle' | 'custom';
export type VersionSource = 'upload' | 'request' | 'restore';
export type UploadStatus = 'open' | 'completing' | 'complete' | 'aborted';
export type ConflictMode = 'version' | 'rename';
export type CollaboratorRole = 'viewer' | 'contributor' | 'editor';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  display_name: string;
  accent: Generated<string>;
  quota_bytes: ColumnType<string, number | string | undefined, number | string>;
  storage_used_bytes: ColumnType<string, number | string | undefined, number | string>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  family_id: string;
  token_hash: Buffer;
  user_agent: string | null;
  ip: string | null;
  created_at: Timestamp;
  last_used_at: Timestamp;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  revoked_reason: string | null;
  replaced_by: string | null;
}

export interface FoldersTable {
  id: Generated<string>;
  owner_id: string;
  parent_id: string | null;
  name: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
}

/** The bytes, addressed by their content hash. Shared by files and versions. */
export interface BlobsTable {
  id: Generated<string>;
  owner_id: string;
  checksum_sha256: Buffer;
  size_bytes: ColumnType<string, number | string, number | string>;
  storage_driver: string;
  storage_key: string;
  ref_count: Generated<number>;
  derivatives_checked: Generated<boolean>;
  created_at: Timestamp;
}

export interface FileVersionsTable {
  id: Generated<string>;
  file_id: string;
  version: number;
  blob_id: string;
  name: string;
  mime_type: string;
  declared_mime: string | null;
  mime_mismatch: Generated<boolean>;
  size_bytes: ColumnType<string, number | string, number | string>;
  source: Generated<VersionSource>;
  note: string | null;
  created_at: Timestamp;
  created_by: string | null;
}

export interface UploadSessionsTable {
  id: Generated<string>;
  owner_id: string;
  folder_id: string | null;
  filename: string;
  declared_mime: string | null;
  size_bytes: ColumnType<string, number | string, number | string>;
  expected_checksum: Buffer | null;
  chunk_size: number;
  chunk_count: number;
  received: Buffer;
  received_count: Generated<number>;
  spool_key: string;
  status: Generated<UploadStatus>;
  on_conflict: Generated<ConflictMode>;
  request_id: string | null;
  submitter: string | null;
  /** Who is uploading, which may differ from whose quota pays. */
  actor_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  expires_at: Timestamp;
}

export interface FileRequestsTable {
  id: Generated<string>;
  owner_id: string;
  folder_id: string;
  slug: string;
  title: string;
  message: string | null;
  password_hash: string | null;
  max_files: number | null;
  max_bytes: ColumnType<string, number | string | null, number | string | null> | null;
  expires_at: Timestamp | null;
  submission_count: Generated<number>;
  received_bytes: ColumnType<string, number | string | undefined, number | string>;
  revoked_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  last_used_at: Timestamp | null;
}

export interface RequestSubmissionsTable {
  id: Generated<string>;
  request_id: string;
  file_id: string | null;
  filename: string;
  size_bytes: ColumnType<string, number | string, number | string>;
  submitter: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: Timestamp;
}

export interface FolderCollaboratorsTable {
  id: Generated<string>;
  folder_id: string;
  granted_by: string;
  email: string;
  user_id: string | null;
  role: Generated<CollaboratorRole>;
  created_at: Timestamp;
  updated_at: Timestamp;
  accepted_at: Timestamp | null;
  last_seen_at: Timestamp | null;
  revoked_at: Timestamp | null;
}

export interface BlobDerivativesTable {
  id: Generated<string>;
  blob_id: string;
  kind: string;
  storage_key: string;
  mime_type: string;
  size_bytes: ColumnType<string, number | string, number | string>;
  width: number | null;
  height: number | null;
  created_at: Timestamp;
}

export interface FilesTable {
  id: Generated<string>;
  owner_id: string;
  folder_id: string | null;
  name: string;
  extension: string | null;
  mime_type: string;
  declared_mime: string | null;
  kind: Generated<string>;
  mime_mismatch: Generated<boolean>;
  size_bytes: ColumnType<string, number | string, number | string>;
  checksum_sha256: Buffer;
  blob_id: string;
  version: Generated<number>;
  version_count: Generated<number>;
  request_id: string | null;
  created_by: string | null;
  content_text: string | null;
  content_indexed: Generated<boolean>;
  visibility: Generated<FileVisibility>;
  starred: Generated<boolean>;
  download_count: Generated<number>;
  last_accessed_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
  purge_after: Timestamp | null;
}

export interface ShareLinksTable {
  id: Generated<string>;
  file_id: string;
  owner_id: string;
  slug: string;
  kind: Generated<ShareKind>;
  label: string | null;
  password_hash: string | null;
  expires_at: Timestamp | null;
  max_downloads: number | null;
  download_count: Generated<number>;
  allow_preview: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
  last_accessed_at: Timestamp | null;
  revoked_at: Timestamp | null;
}

export interface EventsTable {
  id: Generated<string>;
  type: string;
  actor_id: string | null;
  file_id: string | null;
  share_id: string | null;
  subject: string | null;
  ip: string | null;
  user_agent: string | null;
  metadata: Generated<Record<string, unknown>>;
  created_at: Timestamp;
}

export interface Database {
  users: UsersTable;
  blobs: BlobsTable;
  file_versions: FileVersionsTable;
  upload_sessions: UploadSessionsTable;
  file_requests: FileRequestsTable;
  folder_collaborators: FolderCollaboratorsTable;
  blob_derivatives: BlobDerivativesTable;
  request_submissions: RequestSubmissionsTable;
  sessions: SessionsTable;
  folders: FoldersTable;
  files: FilesTable;
  share_links: ShareLinksTable;
  events: EventsTable;
}

export type UserRow = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type SessionRow = Selectable<SessionsTable>;
export type FolderRow = Selectable<FoldersTable>;
export type FileRow = Selectable<FilesTable>;
export type ShareLinkRow = Selectable<ShareLinksTable>;
export type EventRow = Selectable<EventsTable>;
export type BlobRow = Selectable<BlobsTable>;
export type FileVersionRow = Selectable<FileVersionsTable>;
export type UploadSessionRow = Selectable<UploadSessionsTable>;
export type FileRequestRow = Selectable<FileRequestsTable>;
export type RequestSubmissionRow = Selectable<RequestSubmissionsTable>;
export type FolderCollaboratorRow = Selectable<FolderCollaboratorsTable>;
export type BlobDerivativeRow = Selectable<BlobDerivativesTable>;

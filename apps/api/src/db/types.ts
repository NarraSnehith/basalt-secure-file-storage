import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export type FileVisibility = 'private' | 'public';
export type ShareKind = 'toggle' | 'custom';

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
  storage_driver: string;
  storage_key: string;
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

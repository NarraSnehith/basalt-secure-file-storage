-- ─────────────────────────────────────────────────────────────────────────────
-- 003 — resumable uploads, and links that let other people upload *to* you
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE upload_status AS ENUM ('open', 'completing', 'complete', 'aborted');

/*
 * An upload session is the server's half of a resumable transfer. Chunks are
 * written into one sparse spool file at their byte offset, so there is no
 * reassembly step and no per-chunk file to clean up; which chunks have landed is
 * a bitmap, one bit per chunk, updated with set_bit() so a retried chunk is
 * idempotent rather than double-counted.
 */
CREATE TABLE upload_sessions (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id         uuid          REFERENCES folders(id) ON DELETE SET NULL,
  filename          text          NOT NULL,
  declared_mime     text,
  size_bytes        bigint        NOT NULL,
  -- What the client says the content hash is. Verified against the bytes we
  -- actually received before anything is persisted; never trusted before that.
  expected_checksum bytea,
  chunk_size        integer       NOT NULL,
  chunk_count       integer       NOT NULL,
  received          bytea         NOT NULL,
  received_count    integer       NOT NULL DEFAULT 0,
  spool_key         text          NOT NULL,
  status            upload_status NOT NULL DEFAULT 'open',
  -- What to do when the folder already holds this name.
  on_conflict       text          NOT NULL DEFAULT 'version',
  request_id        uuid,
  submitter         text,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  expires_at        timestamptz   NOT NULL,
  CONSTRAINT upload_size_nonneg   CHECK (size_bytes >= 0),
  CONSTRAINT upload_chunk_size    CHECK (chunk_size BETWEEN 65536 AND 67108864),
  CONSTRAINT upload_chunk_count   CHECK (chunk_count BETWEEN 1 AND 100000),
  CONSTRAINT upload_received_sane CHECK (received_count BETWEEN 0 AND chunk_count),
  CONSTRAINT upload_conflict_mode CHECK (on_conflict IN ('version', 'rename'))
);
CREATE INDEX upload_sessions_owner_idx  ON upload_sessions (owner_id, created_at DESC);
CREATE INDEX upload_sessions_expiry_idx ON upload_sessions (expires_at) WHERE status <> 'complete';

CREATE TRIGGER upload_sessions_touch BEFORE UPDATE ON upload_sessions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

/*
 * A file request is a share link pointing the other way: anyone holding it can
 * upload into one folder, without an account, under limits the owner sets. The
 * uploads land in the owner's drive and count against the owner's quota, so the
 * limits here are the only thing standing between a public link and a filled
 * disk — hence max_files, max_bytes and an expiry.
 */
CREATE TABLE file_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  folder_id        uuid        NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  slug             text        NOT NULL UNIQUE,
  title            text        NOT NULL,
  message          text,
  password_hash    text,
  max_files        integer,
  max_bytes        bigint,
  expires_at       timestamptz,
  submission_count integer     NOT NULL DEFAULT 0,
  received_bytes   bigint      NOT NULL DEFAULT 0,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_used_at     timestamptz,
  CONSTRAINT requests_slug_shape  CHECK (slug ~ '^[A-Za-z0-9_-]{8,64}$'),
  CONSTRAINT requests_title_len   CHECK (char_length(title) BETWEEN 1 AND 120),
  CONSTRAINT requests_message_len CHECK (message IS NULL OR char_length(message) <= 500),
  CONSTRAINT requests_max_files   CHECK (max_files IS NULL OR max_files > 0),
  CONSTRAINT requests_max_bytes   CHECK (max_bytes IS NULL OR max_bytes > 0)
);
CREATE INDEX file_requests_owner_idx  ON file_requests (owner_id, created_at DESC);
CREATE INDEX file_requests_folder_idx ON file_requests (folder_id) WHERE revoked_at IS NULL;

CREATE TRIGGER file_requests_touch BEFORE UPDATE ON file_requests
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Who sent what, so the owner has an inbox rather than a pile of new files.
CREATE TABLE request_submissions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     uuid        NOT NULL REFERENCES file_requests(id) ON DELETE CASCADE,
  file_id        uuid        REFERENCES files(id) ON DELETE SET NULL,
  filename       text        NOT NULL,
  size_bytes     bigint      NOT NULL,
  submitter      text,
  ip             inet,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX request_submissions_request_idx ON request_submissions (request_id, created_at DESC);
CREATE INDEX request_submissions_file_idx    ON request_submissions (file_id);

-- Provenance on the file itself, so a listing can say "arrived via a request".
ALTER TABLE files ADD COLUMN request_id uuid REFERENCES file_requests(id) ON DELETE SET NULL;
CREATE INDEX files_request_idx ON files (request_id) WHERE request_id IS NOT NULL;

ALTER TABLE upload_sessions
  ADD CONSTRAINT upload_sessions_request_fk
  FOREIGN KEY (request_id) REFERENCES file_requests(id) ON DELETE CASCADE;

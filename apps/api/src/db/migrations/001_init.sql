-- ─────────────────────────────────────────────────────────────────────────────
-- 001_init — core schema: identities, sessions, folders, files, shares, events
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive e-mail addresses
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- trigram index for filename search

-- ── users ───────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext      NOT NULL UNIQUE,
  password_hash       text        NOT NULL,
  display_name        text        NOT NULL,
  accent              text        NOT NULL DEFAULT 'ember',
  -- Quota is per-user so it can be lifted for an individual account.
  quota_bytes         bigint      NOT NULL DEFAULT 10737418240,
  -- Denormalised counter, mutated in the same transaction as every blob change
  -- (see files_storage_delta trigger). Reconcilable via SELECT SUM(size_bytes).
  storage_used_bytes  bigint      NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_shape      CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT users_quota_positive   CHECK (quota_bytes >= 0),
  CONSTRAINT users_storage_nonneg   CHECK (storage_used_bytes >= 0),
  CONSTRAINT users_name_length      CHECK (char_length(display_name) BETWEEN 1 AND 80)
);

-- ── sessions (refresh-token families, one row per issued refresh token) ──────
CREATE TABLE sessions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- All tokens rotated from the same login share a family_id. Replaying an
  -- already-rotated token revokes the whole family (stolen-token detection).
  family_id      uuid        NOT NULL,
  token_hash     bytea       NOT NULL UNIQUE,
  user_agent     text,
  ip             inet,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason text,
  replaced_by    uuid        REFERENCES sessions(id) ON DELETE SET NULL
);
CREATE INDEX sessions_user_active_idx ON sessions (user_id, revoked_at, expires_at DESC);
CREATE INDEX sessions_family_idx      ON sessions (family_id);
CREATE INDEX sessions_expiry_idx      ON sessions (expires_at) WHERE revoked_at IS NULL;

-- ── folders ─────────────────────────────────────────────────────────────────
CREATE TABLE folders (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  parent_id  uuid        REFERENCES folders(id)          ON DELETE CASCADE,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT folders_name_length CHECK (char_length(name) BETWEEN 1 AND 255),
  CONSTRAINT folders_name_clean  CHECK (name !~ '[/\\\x00]' AND name NOT IN ('.', '..')),
  CONSTRAINT folders_not_self    CHECK (id <> parent_id)
);
-- Sibling folder names are unique per owner, case-insensitively, ignoring trash.
CREATE UNIQUE INDEX folders_sibling_name_uniq
  ON folders (owner_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  WHERE deleted_at IS NULL;
CREATE INDEX folders_owner_parent_idx ON folders (owner_id, parent_id) WHERE deleted_at IS NULL;

-- ── files ───────────────────────────────────────────────────────────────────
CREATE TYPE file_visibility AS ENUM ('private', 'public');

CREATE TABLE files (
  id               uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid            NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  folder_id        uuid            REFERENCES folders(id)         ON DELETE SET NULL,
  name             text            NOT NULL,
  extension        text,
  -- mime_type is what we serve: derived from magic bytes when we can sniff it,
  -- never blindly echoed from the upload. declared_mime keeps the client claim
  -- for auditing and mismatch reporting.
  mime_type        text            NOT NULL,
  declared_mime    text,
  -- Coarse family (image/video/pdf/code/…) resolved once at upload time so the
  -- UI can filter on an index instead of pattern-matching MIME strings.
  kind             text            NOT NULL DEFAULT 'other',
  -- True when magic bytes contradicted the extension. Such files are always
  -- served as attachments and flagged in the UI.
  mime_mismatch    boolean         NOT NULL DEFAULT false,
  size_bytes       bigint          NOT NULL,
  checksum_sha256  bytea           NOT NULL,
  storage_driver   text            NOT NULL,
  storage_key      text            NOT NULL,
  visibility       file_visibility NOT NULL DEFAULT 'private',
  starred          boolean         NOT NULL DEFAULT false,
  download_count   integer         NOT NULL DEFAULT 0,
  last_accessed_at timestamptz,
  created_at       timestamptz     NOT NULL DEFAULT now(),
  updated_at       timestamptz     NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  purge_after      timestamptz,
  CONSTRAINT files_name_length  CHECK (char_length(name) BETWEEN 1 AND 255),
  CONSTRAINT files_name_clean   CHECK (name !~ '[/\\\x00]' AND name NOT IN ('.', '..')),
  CONSTRAINT files_size_nonneg  CHECK (size_bytes >= 0),
  CONSTRAINT files_trash_shape  CHECK ((deleted_at IS NULL) = (purge_after IS NULL))
);
CREATE UNIQUE INDEX files_storage_key_uniq ON files (storage_driver, storage_key);
CREATE UNIQUE INDEX files_sibling_name_uniq
  ON files (owner_id, COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  WHERE deleted_at IS NULL;
CREATE INDEX files_owner_recent_idx  ON files (owner_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX files_owner_folder_idx  ON files (owner_id, folder_id)       WHERE deleted_at IS NULL;
CREATE INDEX files_owner_starred_idx ON files (owner_id)                  WHERE starred AND deleted_at IS NULL;
CREATE INDEX files_trash_idx         ON files (owner_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX files_purge_idx         ON files (purge_after)               WHERE deleted_at IS NOT NULL;
CREATE INDEX files_owner_kind_idx    ON files (owner_id, kind)         WHERE deleted_at IS NULL;
CREATE INDEX files_owner_public_idx  ON files (owner_id, visibility)   WHERE deleted_at IS NULL;
CREATE INDEX files_name_trgm_idx     ON files USING gin (lower(name) gin_trgm_ops);
CREATE INDEX files_checksum_idx      ON files (checksum_sha256);

-- ── share links ─────────────────────────────────────────────────────────────
-- 'toggle' = the one link created by the public/private switch on a file.
-- 'custom' = extra links with their own password / expiry / download budget.
CREATE TYPE share_kind AS ENUM ('toggle', 'custom');

CREATE TABLE share_links (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id          uuid        NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  owner_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug             text        NOT NULL UNIQUE,
  kind             share_kind  NOT NULL DEFAULT 'custom',
  label            text,
  password_hash    text,
  expires_at       timestamptz,
  max_downloads    integer,
  download_count   integer     NOT NULL DEFAULT 0,
  allow_preview    boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz,
  revoked_at       timestamptz,
  CONSTRAINT shares_slug_shape     CHECK (slug ~ '^[A-Za-z0-9_-]{8,64}$'),
  CONSTRAINT shares_max_dl_pos     CHECK (max_downloads IS NULL OR max_downloads > 0),
  CONSTRAINT shares_label_length   CHECK (label IS NULL OR char_length(label) <= 80)
);
CREATE UNIQUE INDEX shares_one_toggle_per_file
  ON share_links (file_id) WHERE kind = 'toggle' AND revoked_at IS NULL;
CREATE INDEX shares_file_idx  ON share_links (file_id)  WHERE revoked_at IS NULL;
CREATE INDEX shares_owner_idx ON share_links (owner_id, created_at DESC);

-- ── events (append-only audit trail) ────────────────────────────────────────
CREATE TABLE events (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type       text        NOT NULL,
  actor_id   uuid        REFERENCES users(id)       ON DELETE SET NULL,
  file_id    uuid        REFERENCES files(id)       ON DELETE SET NULL,
  share_id   uuid        REFERENCES share_links(id) ON DELETE SET NULL,
  -- Kept denormalised so the trail still reads correctly after a hard delete.
  subject    text,
  ip         inet,
  user_agent text,
  metadata   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_actor_recent_idx ON events (actor_id, created_at DESC);
CREATE INDEX events_file_recent_idx  ON events (file_id, created_at DESC);
CREATE INDEX events_type_idx         ON events (type, created_at DESC);

-- ── keep updated_at honest ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_touch       BEFORE UPDATE ON users       FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER folders_touch     BEFORE UPDATE ON folders     FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER files_touch       BEFORE UPDATE ON files       FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER share_links_touch BEFORE UPDATE ON share_links FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── storage accounting ──────────────────────────────────────────────────────
-- Trash still occupies quota (it is recoverable); only a hard delete frees it.
CREATE OR REPLACE FUNCTION files_storage_delta() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE users SET storage_used_bytes = storage_used_bytes + NEW.size_bytes
     WHERE id = NEW.owner_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE users SET storage_used_bytes = GREATEST(0, storage_used_bytes - OLD.size_bytes)
     WHERE id = OLD.owner_id;
  ELSIF (TG_OP = 'UPDATE') AND (NEW.size_bytes <> OLD.size_bytes OR NEW.owner_id <> OLD.owner_id) THEN
    UPDATE users SET storage_used_bytes = GREATEST(0, storage_used_bytes - OLD.size_bytes)
     WHERE id = OLD.owner_id;
    UPDATE users SET storage_used_bytes = storage_used_bytes + NEW.size_bytes
     WHERE id = NEW.owner_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER files_storage_accounting
  AFTER INSERT OR UPDATE OR DELETE ON files
  FOR EACH ROW EXECUTE FUNCTION files_storage_delta();

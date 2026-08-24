-- ─────────────────────────────────────────────────────────────────────────────
-- 002_content_addressing — split "the bytes" from "the file that points at them"
--
-- Until now a file row owned its blob one-to-one, so storing the same 200 MB
-- video twice cost 400 MB. A blob is now addressed by its content hash and can
-- be referenced by many files and by many versions of a file, which is what
-- makes de-duplication, instant uploads and version history possible at all.
--
-- Deliberately scoped per owner: a shared address space would let anyone probe
-- whether a given file already exists on the service by watching for an instant
-- upload. That is an existence oracle over other people's data, and it is not
-- worth the disk it saves.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── blobs: content, and nothing that depends on a filename ──────────────────
CREATE TABLE blobs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checksum_sha256 bytea       NOT NULL,
  size_bytes      bigint      NOT NULL,
  storage_driver  text        NOT NULL,
  storage_key     text        NOT NULL,
  -- Number of file_versions pointing here. Dropping to zero frees the quota
  -- immediately; the object itself is swept a little later (see maintenance).
  ref_count       integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blobs_size_nonneg CHECK (size_bytes >= 0),
  CONSTRAINT blobs_refs_nonneg CHECK (ref_count >= 0)
);
CREATE UNIQUE INDEX blobs_owner_content_uniq ON blobs (owner_id, checksum_sha256);
CREATE UNIQUE INDEX blobs_storage_key_uniq   ON blobs (storage_driver, storage_key);
CREATE INDEX blobs_unreferenced_idx          ON blobs (created_at) WHERE ref_count = 0;

-- ── file_versions: one row per revision of a file ───────────────────────────
-- The name is recorded per version, so renaming a file does not rewrite its
-- history, and restoring an old version restores what it was actually called.
CREATE TYPE version_source AS ENUM ('upload', 'request', 'restore');

CREATE TABLE file_versions (
  id            uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id       uuid           NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  version       integer        NOT NULL,
  blob_id       uuid           NOT NULL REFERENCES blobs(id) ON DELETE RESTRICT,
  name          text           NOT NULL,
  mime_type     text           NOT NULL,
  declared_mime text,
  mime_mismatch boolean        NOT NULL DEFAULT false,
  size_bytes    bigint         NOT NULL,
  source        version_source NOT NULL DEFAULT 'upload',
  note          text,
  created_at    timestamptz    NOT NULL DEFAULT now(),
  created_by    uuid           REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT versions_positive CHECK (version > 0),
  CONSTRAINT versions_note_len CHECK (note IS NULL OR char_length(note) <= 200)
);
CREATE UNIQUE INDEX file_versions_uniq ON file_versions (file_id, version);
CREATE INDEX file_versions_blob_idx    ON file_versions (blob_id);
CREATE INDEX file_versions_recent_idx  ON file_versions (file_id, version DESC);

-- ── files now point at a blob and know their version ────────────────────────
ALTER TABLE files
  ADD COLUMN blob_id       uuid REFERENCES blobs(id) ON DELETE RESTRICT,
  ADD COLUMN version       integer NOT NULL DEFAULT 1,
  ADD COLUMN version_count integer NOT NULL DEFAULT 1;

-- ── carry the existing rows across ──────────────────────────────────────────
-- One blob per distinct (owner, content). Where an owner already had two copies
-- of the same bytes, the first wins and the second object becomes unreferenced;
-- the maintenance sweeper reclaims it.
INSERT INTO blobs (owner_id, checksum_sha256, size_bytes, storage_driver, storage_key, created_at)
SELECT DISTINCT ON (owner_id, checksum_sha256)
       owner_id, checksum_sha256, size_bytes, storage_driver, storage_key, created_at
  FROM files
 ORDER BY owner_id, checksum_sha256, created_at ASC;

UPDATE files f
   SET blob_id = b.id
  FROM blobs b
 WHERE b.owner_id = f.owner_id
   AND b.checksum_sha256 = f.checksum_sha256;

INSERT INTO file_versions
       (file_id, version, blob_id, name, mime_type, declared_mime, mime_mismatch,
        size_bytes, source, created_at, created_by)
SELECT id, 1, blob_id, name, mime_type, declared_mime, mime_mismatch,
       size_bytes, 'upload', created_at, owner_id
  FROM files;

ALTER TABLE files ALTER COLUMN blob_id SET NOT NULL;

UPDATE blobs b
   SET ref_count = (SELECT count(*) FROM file_versions v WHERE v.blob_id = b.id);

-- storage_key moves to the blob; a file no longer knows where its bytes live.
DROP INDEX files_storage_key_uniq;
ALTER TABLE files DROP COLUMN storage_driver, DROP COLUMN storage_key;

CREATE INDEX files_blob_idx ON files (blob_id);

-- ── quota accounting moves from files to blobs ──────────────────────────────
-- Charging per file would double-bill a de-duplicated copy; charging per
-- referenced blob is what the account actually occupies on disk.
DROP TRIGGER files_storage_accounting ON files;
DROP FUNCTION files_storage_delta();

CREATE OR REPLACE FUNCTION blobs_storage_delta() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.ref_count > 0 THEN
      UPDATE users SET storage_used_bytes = storage_used_bytes + NEW.size_bytes WHERE id = NEW.owner_id;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    IF OLD.ref_count > 0 THEN
      UPDATE users SET storage_used_bytes = GREATEST(0, storage_used_bytes - OLD.size_bytes) WHERE id = OLD.owner_id;
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    -- Only the 0 <-> non-zero transitions move the needle: a blob referenced
    -- once and a blob referenced five times occupy the same bytes.
    IF OLD.ref_count = 0 AND NEW.ref_count > 0 THEN
      UPDATE users SET storage_used_bytes = storage_used_bytes + NEW.size_bytes WHERE id = NEW.owner_id;
    ELSIF OLD.ref_count > 0 AND NEW.ref_count = 0 THEN
      UPDATE users SET storage_used_bytes = GREATEST(0, storage_used_bytes - OLD.size_bytes) WHERE id = OLD.owner_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER blobs_storage_accounting
  AFTER INSERT OR UPDATE OR DELETE ON blobs
  FOR EACH ROW EXECUTE FUNCTION blobs_storage_delta();

-- ── keep ref_count honest without the application having to remember ────────
CREATE OR REPLACE FUNCTION file_versions_refcount() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE blobs SET ref_count = ref_count + 1 WHERE id = NEW.blob_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE blobs SET ref_count = GREATEST(0, ref_count - 1) WHERE id = OLD.blob_id;
  ELSIF (TG_OP = 'UPDATE') AND NEW.blob_id <> OLD.blob_id THEN
    UPDATE blobs SET ref_count = GREATEST(0, ref_count - 1) WHERE id = OLD.blob_id;
    UPDATE blobs SET ref_count = ref_count + 1 WHERE id = NEW.blob_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER file_versions_refcounting
  AFTER INSERT OR UPDATE OR DELETE ON file_versions
  FOR EACH ROW EXECUTE FUNCTION file_versions_refcount();

-- Recompute the per-user counter from the truth, now that the rule has changed.
UPDATE users u
   SET storage_used_bytes = COALESCE(
         (SELECT sum(b.size_bytes) FROM blobs b WHERE b.owner_id = u.id AND b.ref_count > 0), 0);

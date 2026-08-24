-- ─────────────────────────────────────────────────────────────────────────────
-- 005 — folders shared with named people, and generated image derivatives
--
-- Phase two's share links are bearer tokens: possession is permission, and
-- revoking one revokes it for everybody who was ever sent it. That is the right
-- shape for "here is a file" and the wrong shape for "we work on this together".
--
-- A collaborator is an *identity*, not a token. You invite an email address; the
-- grant attaches to whichever account owns it, now or later; and revoking one
-- person leaves everyone else untouched.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE collaborator_role AS ENUM ('viewer', 'contributor', 'editor');

CREATE TABLE folder_collaborators (
  id          uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id   uuid              NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  -- The owner who granted it. Only an owner may manage collaborators, so this
  -- is also the audit trail for who let someone in.
  granted_by  uuid              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The invited identity. The address is always recorded; user_id is filled in
  -- once an account with that address exists, so an invitation can be sent
  -- before the person has signed up and still resolve when they do.
  email       citext            NOT NULL,
  user_id     uuid              REFERENCES users(id) ON DELETE CASCADE,
  role        collaborator_role NOT NULL DEFAULT 'viewer',
  created_at  timestamptz       NOT NULL DEFAULT now(),
  updated_at  timestamptz       NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  last_seen_at timestamptz,
  revoked_at  timestamptz,
  CONSTRAINT collaborators_email_shape CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

-- One live grant per person per folder; re-inviting updates the role instead.
CREATE UNIQUE INDEX folder_collaborators_uniq
  ON folder_collaborators (folder_id, email) WHERE revoked_at IS NULL;
CREATE INDEX folder_collaborators_folder_idx ON folder_collaborators (folder_id) WHERE revoked_at IS NULL;
CREATE INDEX folder_collaborators_user_idx   ON folder_collaborators (user_id)   WHERE revoked_at IS NULL;
CREATE INDEX folder_collaborators_email_idx  ON folder_collaborators (email)     WHERE revoked_at IS NULL AND user_id IS NULL;

CREATE TRIGGER folder_collaborators_touch BEFORE UPDATE ON folder_collaborators
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

/*
 * A pending invitation resolves the moment the invited address becomes an
 * account. Doing it in the database means it cannot be forgotten by a code path
 * that creates users some other way (a seed, a fixture, an admin tool).
 */
CREATE OR REPLACE FUNCTION resolve_pending_invitations() RETURNS trigger AS $$
BEGIN
  UPDATE folder_collaborators
     SET user_id = NEW.id
   WHERE email = NEW.email AND user_id IS NULL AND revoked_at IS NULL;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_resolve_invitations
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION resolve_pending_invitations();

-- ── who actually put the file there ─────────────────────────────────────────
-- owner_id stays the folder's owner (their quota, their drive); created_by
-- records the person who uploaded it, which is what a shared folder needs to
-- show, and what lets a contributor manage their own contributions.
ALTER TABLE files ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;
UPDATE files SET created_by = owner_id WHERE created_by IS NULL;
CREATE INDEX files_created_by_idx ON files (created_by) WHERE created_by IS NOT NULL;

-- ── generated derivatives ───────────────────────────────────────────────────
/*
 * Grid tiles were rendering the original image: fine for a 500 KB photograph,
 * wasteful for a 40 MB one. A derivative is generated once per blob and shared
 * by every file pointing at it — the same de-duplication that makes the second
 * copy of a file free also makes its thumbnail free.
 *
 * Derivatives are service overhead, not user data, so they deliberately do not
 * count against a quota.
 */
CREATE TABLE blob_derivatives (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  blob_id     uuid        NOT NULL REFERENCES blobs(id) ON DELETE CASCADE,
  kind        text        NOT NULL,
  storage_key text        NOT NULL,
  mime_type   text        NOT NULL,
  size_bytes  bigint      NOT NULL,
  width       integer,
  height      integer,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT derivatives_kind CHECK (kind IN ('thumb')),
  CONSTRAINT derivatives_size CHECK (size_bytes > 0)
);
CREATE UNIQUE INDEX blob_derivatives_uniq        ON blob_derivatives (blob_id, kind);
CREATE UNIQUE INDEX blob_derivatives_key_uniq    ON blob_derivatives (storage_key);

-- Records that a blob was examined, so a format we cannot thumbnail is not
-- retried on every request.
ALTER TABLE blobs ADD COLUMN derivatives_checked boolean NOT NULL DEFAULT false;

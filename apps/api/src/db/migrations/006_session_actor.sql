-- ─────────────────────────────────────────────────────────────────────────────
-- 006_session_actor — separate "who is uploading" from "whose quota pays"
--
-- A contributor uploading into a shared folder creates a session against the
-- *folder owner's* quota, but it is the contributor who must be allowed to send
-- its chunks and finish it. One column cannot answer both questions.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE upload_sessions
  ADD COLUMN actor_id uuid REFERENCES users(id) ON DELETE CASCADE;

UPDATE upload_sessions SET actor_id = owner_id WHERE actor_id IS NULL;

CREATE INDEX upload_sessions_actor_idx ON upload_sessions (actor_id, created_at DESC);

COMMENT ON COLUMN upload_sessions.owner_id IS
  'Whose quota the finished file counts against — the destination folder''s owner.';
COMMENT ON COLUMN upload_sessions.actor_id IS
  'Who is performing the upload, and therefore who may send chunks and complete it.';

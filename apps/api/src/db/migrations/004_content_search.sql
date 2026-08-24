-- ─────────────────────────────────────────────────────────────────────────────
-- 004_content_search — search that reads inside files, not just their names
--
-- `content_text` is filled by the extraction step at upload time (plain text,
-- markdown, code, CSV, JSON today; capped so one enormous log cannot dominate
-- the index). The vector is a generated column so it can never drift from the
-- columns it summarises, with the filename weighted above the contents: someone
-- searching "invoice" wants the file called invoice first.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE files
  ADD COLUMN content_text    text,
  ADD COLUMN content_indexed boolean NOT NULL DEFAULT false,
  ADD COLUMN search_vector   tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple',  coalesce(replace(name, '.', ' '), '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content_text, '')), 'B')
  ) STORED;

CREATE INDEX files_search_idx ON files USING gin (search_vector);

COMMENT ON COLUMN files.content_text IS
  'Extracted text, truncated at 256 KB. Present only for formats we can read.';

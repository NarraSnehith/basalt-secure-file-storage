Basalt — secure file storage. Register, upload, organise files in a personal
drive, control public/private per file, share with revocable links.

── SIGNING IN ───────────────────────────────────────────────────────────────
The sign-in page has a "Use the demo account" button, or type:

    demo@basalt.build / stone-and-ash-2026

The account is already populated: five folders, files of several types, two
live public links, one password-protected link (password: quartz-seam), and an
open file request. Nothing to set up.

A second account — colleague@basalt.build / quartz-and-slate-2026 — has two
folders shared with it, so you can see the permission model from the other side.

── TWO THINGS TO EXPECT ─────────────────────────────────────────────────────
1. Free instance, sleeps after 15 minutes idle. The FIRST request after a quiet
   spell takes ~50s while it wakes; everything after is immediate. Please don't
   read the first load as the app's performance.

2. Storage is deliberately capped — 1 GB per account, 6 GB service-wide, 512 MB
   per file — because the object store and database are on free plans and I
   didn't want this deployment able to generate a bill. Every feature is live:
   nothing stubbed, mocked or switched off. Uploads go to real S3 storage
   (Cloudflare R2), share links are real, and search genuinely reads inside
   files. Only volume is limited, and hitting the cap declines new uploads with
   a clear message while everything stored keeps working.

── WORTH TRYING ─────────────────────────────────────────────────────────────
• Drag in a large file and reload mid-transfer — it resumes from the last chunk
  that landed. I verified this on the live deployment with 120 MiB: my
  connection genuinely dropped at chunk 193 of 240, a fresh client asked the
  server what was missing, sent only the remaining 47, and the file returned
  byte-identical (SHA-256 matched).
• Upload the same file twice — instant the second time, and no quota spent.
  Files are addressed by the SHA-256 of their contents.
• Re-upload under a name you've used — you get a version, not an overwrite.
  Older versions stay downloadable; restoring adds on top rather than replacing.
• Search a word that's inside a document but not in its filename.
• Open a share link in a private window, then revoke it and refresh.
• Insights — what's duplicated, what version history costs, what the bin holds.
• Request another account's file by id: you get 404, not 403. A 403 would
  confirm the id exists.

── HOW IT'S BUILT ───────────────────────────────────────────────────────────
TypeScript throughout. Express + Kysely over PostgreSQL, Next.js App Router
front end. No ORM — the interesting parts here are the SQL, the streaming
upload path and the authorisation rules, and an ORM hides all three. No UI
library or component kit either: the icon set, type scale and brand art are all
in the repo. Schema is forward-only .sql migrations with an advisory lock and a
checksum ledger.

Auth is Argon2id at OWASP parameters, a short-lived access JWT plus rotating
opaque refresh tokens with family revocation on replay, in httpOnly __Host-
cookies, CSRF via origin check and double-submit cookie. Uploads are
type-sniffed from magic bytes, never the browser's claim. Downloads are
short-lived presigned URLs, so file bytes never occupy an API process.

The README is thorough — "What makes it different", the upload path, and the
Deployment section, which documents the mistakes this deployment actually hit
rather than an idealised version.

── TESTING ──────────────────────────────────────────────────────────────────
`npm test` — 119 tests against a real PostgreSQL database and the real Express
app. No mocked database, no mocked storage: uploads stream through busboy onto
disk and are read back byte-for-byte, and the resumable tests drive the real
chunk protocol. The suite also runs green against a real S3-compatible server,
which is how I found four bugs in that driver no unit test would have caught.

── NOT BUILT ────────────────────────────────────────────────────────────────
Thumbnail generation (schema supports it, generation isn't written), client-side
encryption, and email notification for expiring links — all three noted in the
README rather than left to be discovered.

# Basalt

A secure file storage service: register, upload, organise, and share files with
per-file access control, revocable links, and a readable audit trail.

Built as a full-stack engineering exercise. Two services in one repository — a
TypeScript/Express API over PostgreSQL, and a Next.js front end — with no
component library, no UI kit, and no generated boilerplate.

**Live demo:** <https://pennsylvania-passing-chuck-hand.trycloudflare.com>
Sign in with the demo button. (A tunnel to a development machine, so it is up
only while that machine is — see [Deployment](#deployment) for a permanent one.)

```
demo account   demo@basalt.build / stone-and-ash-2026
               (the sign-in page has a one-click button for it)

colleague      colleague@basalt.build / quartz-and-slate-2026
               two folders are shared with this account, so you can see the
               permission model from the other side
```

---

## Contents

- [Quick start](#quick-start)
- [What it does](#what-it-does)
- [What makes it different](#what-makes-it-different)
- [Architecture](#architecture)
- [Data model](#data-model)
- [Security](#security)
- [The upload path](#the-upload-path)
- [The sharing model](#the-sharing-model)
- [API reference](#api-reference)
- [Front end](#front-end)
- [Testing](#testing)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Engineering decisions](#engineering-decisions)
- [Known limits and what comes next](#known-limits-and-what-comes-next)

---

## Quick start

**Requires** Node 20.11+ and PostgreSQL 14+ on `localhost:5432`.

```bash
npm install
npm run setup     # writes .env with fresh secrets, creates + migrates + seeds the DB
npm run dev       # API on :4000, web on :3000
```

Open <http://localhost:3000> and use the demo button on the sign-in page.

`npm run setup` is idempotent — run it again any time. If you have no Postgres:

```bash
brew install postgresql@17 && brew services start postgresql@17
# or
docker run -d --name basalt-pg -p 5432:5432 \
  -e POSTGRES_USER=basalt -e POSTGRES_PASSWORD=basalt -e POSTGRES_DB=basalt postgres:17-alpine
```

### Or the whole thing in one command

```bash
cp .env.example .env    # then set ACCESS_TOKEN_SECRET and REFRESH_TOKEN_PEPPER
docker compose up --build
```

Brings up Postgres, the API and the web app, runs the migrations, and serves
everything on <http://localhost:3000> through a single origin — the shape this is
meant to be deployed in, where the browser only ever talks to one host and
session cookies stay first-party.

There is also a [`render.yaml`](render.yaml) blueprint for a one-click cloud
deploy; see [Deployment](#deployment).

| Command | Does |
| --- | --- |
| `npm run dev` | Both services with reload |
| `npm test` | API test suite (114 tests, real Postgres, no mocks) |
| `npm run typecheck` | `tsc --noEmit` across both workspaces |
| `npm run build` | Production build of both |
| `npm run db:migrate` / `db:reset` / `db:seed` | Schema and demo data |

---

## What it does

**Accounts** — register, sign in, change password, list and revoke signed-in
devices, delete the account and everything in it.

**Files** — drag-and-drop upload of many files at once, **resumable**: transfers
survive a dropped connection, a pause, or a page reload, and a file the account
already holds is stored instantly without sending a byte. Rename, move, star,
soft-delete, restore, purge, and **version history** — uploading over a file
keeps the old copy instead of making "report (2).pdf". Folders nest arbitrarily;
cycles are rejected. Search reads **inside** files as well as their names,
filter by twelve file families, sort by name, size or date, keyset-paginated.

**Sharing** — a switch per file makes it public. Beyond that, a file can carry
any number of links, each with its own optional password, expiry, download
budget and preview permission. Every link is revocable and takes effect on the
next request.

**Collaboration** — share a folder with **people** rather than a link: invite an
email address, pick viewer, contributor or editor, and revoke one person without
disturbing anyone else. Invitations sent before someone has an account resolve
themselves when they register. Files stay with the folder's owner and are
credited to whoever added them.

**Receiving** — **upload links** point the other way: give someone a link and
they can send files into one of your folders with no account, under a file cap,
a size cap, an expiry and an optional password. You get an inbox of who sent
what, and a sender can never overwrite something you already have.

**Visibility** — a preview overlay for images, video, audio, PDF and text; a
storage meter that shows what the space is made of; per-link **receipts** (who
opened it, when, from where); an **insights** page answering what is biggest,
what is duplicated, what you have never opened and what version history is
costing; and an activity feed recording uploads, downloads, renames, visibility
changes, link visits and failed password attempts, with time and address.

**Limits** — 512 MB per file and 10 GB per account by default, both
configurable. Uploads are streamed and chunked, so file size is bounded by disk,
not RAM. Verified with a 150 MB upload through the API and 117 MB through the
browser UI, plus a resumed transfer that survived a mid-flight failure.

---

## What makes it different

Six things about existing drives that annoy people, and what this does instead.
Each is a real mechanism, not a setting.

### 1. Two copies of a file cost space once

Blobs are addressed by their SHA-256. Upload the same 200 MB video twice under
two names and it occupies 200 MB, not 400. Quota is charged per *referenced
blob* and maintained by a database trigger, so it cannot drift, and the insights
page reports what this has saved you.

De-duplication is scoped **per owner**, deliberately. A shared content index
would let anyone test whether a given file already exists on the service by
watching for an instant upload — an existence oracle over other people's data,
which is not worth the disk it saves. There is a test asserting that one account
cannot get an instant upload for another account's content.

### 2. An upload that dies at 97% does not start over

Uploads go through a session. The client hashes the file, asks whether the server
already has it, and otherwise sends chunks — several at a time, in any order,
retrying an individual chunk rather than the file.

```
POST   /api/uploads              → { instant: true, file }   nothing to send
                                 → { session: { chunkSize, chunkCount, missing } }
PUT    /api/uploads/:id/chunks/7 → one chunk, at its offset, idempotent
GET    /api/uploads/:id          → what is still missing
POST   /api/uploads/:id/complete → hash, verify, ingest
```

Server-side, chunks stream into **one sparse file** at their byte offset, so
there is no reassembly pass and an abandoned 5 GB upload costs only the blocks
that actually arrived. Which chunks have landed is a bitmap updated with
`set_bit`, so a client retrying a chunk it already sent overwrites identical
bytes rather than inflating a counter.

Because the progress lives on the server, "what do you still need?" survives a
network failure, a pause, and a page reload. After a reload the dock offers the
unfinished transfer back — the browser will not hand a file's contents to script
without a fresh gesture, so it asks for the file again and then sends only the
missing parts.

The file is verified, not trusted: the assembled bytes are hashed and compared
with the digest the client declared, and any chunk may carry its own digest.
A mismatch is refused rather than stored.

### 3. "report (2).pdf" is not version control

Uploading over an existing file adds a revision. Every revision is downloadable
on its own, restoring is **additive** (it appends the old bytes as a new
revision rather than truncating history, so undo is always available), and old
revisions can be pruned — with the UI saying up front whether the space will
actually come back, because if another file shares those exact bytes it will not.

`onConflict: 'rename'` still exists for callers that want the old behaviour, and
is pinned on for uploads arriving through a public link.

### 4. "Please email me those files" is not a protocol

An upload link is a share link pointing the other way: one folder, no account
required of the sender, with a file cap, a byte cap, an expiry and an optional
password. Slots are reserved atomically when a session opens and released if the
sender gives up, so a link limited to three files cannot be talked into four by
three simultaneous senders.

The sender gets the same resumable, hashed, chunked transfer the owner does. What
they do *not* get is any view of the drive: the completion response echoes the
filename, size and checksum they sent, and nothing else. And their upload can
never bury a file the owner already has.

### 5. "Did they even open it?"

Every share link keeps receipts — each view, download and failed password
attempt, with time and address — readable from the link itself rather than by
filtering a global log.

### 6. A share link is the wrong shape for working together

A link is a bearer token: possession is permission, and revoking it revokes it
for everybody it was ever forwarded to. That is right for "here is a file" and
wrong for "we work on this together".

So a folder can also be shared with **people**. You invite an email address; the
grant attaches to whichever account owns it — now, or later, because a pending
invitation resolves itself the moment that address registers (a database trigger,
so no code path can forget). Revoking one person leaves everyone else untouched,
and every action carries a name.

Three roles, chosen so the boundaries are guessable:

| | viewer | contributor | editor | owner |
| --- | --- | --- | --- | --- |
| Open and download | ✓ | ✓ | ✓ | ✓ |
| See version history | ✓ | ✓ | ✓ | ✓ |
| Add files | | ✓ | ✓ | ✓ |
| Manage files they added | | ✓ | ✓ | ✓ |
| Rename, move, bin anything | | | ✓ | ✓ |
| Manage the guest list | | | | ✓ |
| Publish to the internet | | | | ✓ |

Two decisions worth stating, because they are the ones that make it behave like a
folder rather than a pile of exceptions:

- **A file belongs to the folder's owner, whoever uploaded it.** Their quota
  pays, their trash receives it, their drive holds it. `created_by` records who
  contributed it — which is what lets a contributor manage their own additions
  and nobody else's, and what the interface shows.
- **A destination must belong to the same account.** Moving a file out of a
  shared folder and into your own drive would be a way to take it, so it is not
  a move that exists.

The permission rule itself lives in one function with one table
([`mayTouchFile`](apps/api/src/modules/collaborators/access.ts)), because a
permission model spread across fifteen call sites is a permission model with a
hole in it. Nineteen tests walk the matrix cell by cell, including what each role
may *not* do.

### 7. "You are out of space" is not actionable

The insights page answers the four questions someone actually has at that
moment: what is biggest, what is duplicated, what have I not touched in ninety
days, and what is version history costing me — each with the rows behind it and
a way to act on them.

Search reads inside files, too. Text, markdown, code, CSV and JSON are extracted
on upload (plus a conservative PDF reader) into a generated `tsvector`, with the
filename weighted above the contents. A query matches full-text **or** a filename
fragment, because those fail differently: full text finds a word inside a
document but not "forecas", and a trigram scan does the opposite.

---

## Architecture

```
                            ┌───────────────────────────┐
  browser ───────────────▶  │  apps/web    Next.js 15   │
                            │  App Router, RSC + client │
                            └───────────────────────────┘
      │                                   
      │  fetch + XHR (cookies, CSRF header)
      ▼                                   
┌──────────────────────────────────────────────────────────────┐
│  apps/api    Express 4 + TypeScript (ESM)                    │
│                                                              │
│  middleware   request id → logging → CORS → cookies → CSRF   │
│  modules      auth · files · folders · shares · activity     │
│               uploads · requests · insights                  │
│                 routes  (HTTP, validation, status codes)     │
│                 service (business rules, authorisation)      │
│                 schemas (zod, one per input)                 │
│  storage      StorageDriver port ── local disk │ S3-compatible│
│  db           Kysely (typed SQL) + hand-written migrations   │
└──────────────────────────────────────────────────────────────┘
      │                                    │
      ▼                                    ▼
  PostgreSQL 17                     blobs (disk or S3)
```

Layering is strict in one direction: routes may call services, services may call
repositories and the storage port, and nothing calls back up. Routes hold no
business logic; services never touch `req`/`res` except to stamp an audit row.

```
apps/api/src
├── app.ts               express wiring, middleware order, route mounting
├── server.ts            boot, timeouts, graceful shutdown
├── maintenance.ts       trash purge, session prune, orphan-blob sweep
├── config/env.ts        zod-validated environment; the process refuses to
│                        start if a secret is missing or looks like the sample
├── db/
│   ├── client.ts        pg pool + Kysely, bigint handling, error codes
│   ├── types.ts         table types (the schema, in TypeScript)
│   ├── migrate.ts       forward-only runner: ledger, advisory lock, checksums
│   ├── migrations/*.sql plain SQL a DBA can read and run with psql
│   ├── seed.ts          demo drive, built through the real service layer
│   └── fixtures.ts      generates valid PNG/PDF/WAV bytes for the seed
├── lib/                 errors, crypto, tokens, mime policy, filenames, http
├── middleware/          auth, csrf, rate limit, error handler, context
├── modules/<domain>/    routes · service · schemas (+ dto, upload, download)
│   ├── files/ingest.ts     the one door into the store: dedup, versioning
│   ├── files/versions.ts   history, restore, prune
│   ├── uploads/            resumable sessions, chunk bookkeeping
│   ├── requests/           inbound upload links
│   └── insights/           storage report, share receipts
└── storage/             driver.ts (port) · local.ts · s3.ts · spool.ts
```

---

## Data model

Six tables. The full DDL, with comments explaining each constraint, is
[`001_init.sql`](apps/api/src/db/migrations/001_init.sql).

| Table | Holds | Notable choices |
| --- | --- | --- |
| `users` | identity, quota, usage | `citext` email so `Ada@x.com` cannot become a second account; `storage_used_bytes` maintained by trigger |
| `blobs` | the bytes, addressed by content hash | unique on `(owner, sha256)`, so a second copy is free; `ref_count` maintained by trigger, and reaching zero frees the quota immediately |
| `file_versions` | one row per revision | the name is stored per revision, so renaming does not rewrite history |
| `upload_sessions` | resumable transfers in flight | received chunks are a `bytea` bitmap updated with `set_bit`, making a retried chunk idempotent |
| `file_requests` | inbound upload links | caps and expiry are the only thing between a public link and a full disk, so they are columns with check constraints |
| `request_submissions` | who sent what through a link | keeps the filename and size even after the owner deletes the file |
| `folder_collaborators` | people a folder is shared with | keyed on an email so an invitation can precede the account; a trigger attaches it on registration |
| `blob_derivatives` | generated thumbnails | one per blob, so a de-duplicated file's thumbnail is free too |
| `sessions` | one row per issued refresh token | `family_id` groups a rotation chain, so replaying a retired token can kill the whole chain |
| `folders` | tree, soft-deleted | partial unique index on `(owner, parent, lower(name))` — sibling names are unique, case-insensitively, ignoring trash |
| `files` | metadata; points at a blob | `mime_type` is what we serve, `declared_mime` is what the client claimed, `mime_mismatch` flags the disagreement; `search_vector` is generated so it cannot drift |
| `share_links` | public links | one `toggle` link per file (partial unique index) plus any number of `custom` ones |
| `events` | append-only audit trail | keeps a denormalised `subject` so the trail still reads after a hard delete |

Design points worth calling out:

- **Every index is deliberate.** Listing, trash, starred, search, purge sweeps
  and share resolution each have a matching (mostly partial) index; nothing is
  covered twice.
- **Storage accounting is a trigger, not application code.** `blobs_storage_delta`
  moves the counter only on the 0 ↔ non-zero reference transitions, because a
  blob referenced once and a blob referenced five times occupy the same bytes.
  Trash still occupies quota — it is recoverable, so pretending otherwise would
  be lying to the user.
- **Reference counting is a trigger too.** `file_versions_refcount` keeps
  `blobs.ref_count` honest on every insert, update and delete, so no code path
  can forget and leak a file's bytes.
- **Names are unique per folder, resolved by query, not by retry.** A failed
  `INSERT` aborts the surrounding Postgres transaction, so the free name
  (`report (2).pdf`) is computed under the same row lock that guards the quota.
- **Soft delete is a real state, not a flag.** `deleted_at` and `purge_after` are
  constrained to move together, and a background pass hard-deletes on expiry.

---

## Security

| Concern | What is done |
| --- | --- |
| Password storage | Argon2id, OWASP parameters (m=19456, t=2, p=1). Hashes are verified in constant time by the library. |
| Account enumeration | Unknown email and wrong password return the same code, the same message, and — via a dummy verification — the same latency. |
| Session tokens | Short-lived access JWT (15 min) + opaque refresh token (30 days) stored as a peppered SHA-256 digest. Never in the clear, never in `localStorage`. |
| Token theft | Refresh tokens rotate on every use. Presenting a retired token revokes the entire family, logging out that device chain. |
| Revocation latency | The session row is checked on every request, so sign-out and "sign out other devices" take effect immediately rather than when the JWT expires. |
| XSS | Tokens live in `httpOnly` cookies, so a script injection cannot read them. The API's own CSP is `default-src 'none'`. |
| CSRF | Origin/Referer allowlist **plus** a double-submit token (`basalt_csrf` cookie ↔ `X-CSRF-Token` header). Bearer-token clients with no cookies are exempt, having no ambient credential to ride on. |
| IDOR | Every query is scoped by `owner_id` at the service layer; a resource owned by someone else returns **404**, not 403, so existence itself stays private. Covered by tests. |
| Path traversal | Blobs are stored under random, sharded, **extension-less** keys. The uploaded name never reaches the filesystem, and it is sanitised (separators, control characters, bidi overrides, Windows device names, trailing dots) before it is even stored as metadata. |
| Content-type spoofing | The served type comes from magic bytes first, extension second, and the client's claim only as a last resort. A disagreement is recorded and the file is served as an attachment forever. |
| Stored XSS via upload | `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment` for every type that could execute, and `Content-Security-Policy: default-src 'none'; sandbox` on the file response itself. |
| Remote code execution | Extensions a web server would execute (`.php`, `.jsp`, `.aspx`, `.cgi`, `.htaccess`, …) are refused at upload — including via rename. |
| Denial of service | Streamed uploads with the limit enforced *during* transfer, per-file and per-request ceilings, a per-user quota checked under a row lock, and fixed-window rate limits on sign-in (per IP **and** per account), registration, uploads, share views and password attempts. |
| Brute force on links | Slugs carry ~69 bits of entropy; unlock attempts are limited per IP and slug; a password-protected link reveals nothing — not even the filename — before it is unlocked. |
| Information leakage | Errors are RFC-9457-shaped with a stable code and a human message. Unexpected exceptions are logged with a request id and reported as a bare 500. Logs redact cookies, authorization headers and password fields. |
| Transport | HSTS, `no-referrer`, and `Secure` + `__Host-`-prefixed cookies in production. |
| Cross-account inference | De-duplication is scoped per owner, so an instant upload can never reveal that *someone else* holds a file. Asserted by test. |
| Upload integrity | The assembled file is hashed and compared with the digest the client declared; individual chunks may carry their own. A chunk of the wrong length is refused and its bit left clear, so it can simply be resent. |
| Resource exhaustion via sessions | Sessions expire, are capped per account, spool sparsely, and are swept with their partial bytes by the maintenance pass. |
| Public write endpoints | An upload link reserves its slot atomically before accepting bytes, releases it if abandoned, pins `onConflict: 'rename'` so a sender cannot version over the owner's file, and returns nothing about the drive it wrote into. |
| Privilege boundaries | One function decides every file permission, with the roles in a table beside it; nineteen tests walk the matrix, asserting the negatives as well as the positives. |
| Escalation via a shared folder | A move destination must belong to the same account, so a shared folder is not a route into your own drive. Only an owner may publish, whatever their role. |
| Invitation enumeration | Inviting is rate limited, and an invitation reveals nothing about whether the address has an account. |
| Search index poisoning | Extraction only accepts formats we can read unambiguously, and discards output that does not look like text — a garbage index matches everything, which is worse than no index. |

Two deliberate refusals, both visible in the code:

1. **The client's `Content-Type` is never trusted for anything that matters.**
   It is stored for the audit trail and shown in the UI as "declared as", and
   that is all.
2. **A file that lies about itself is not deleted, it is quarantined by policy.**
   `mime_mismatch` files still download normally — they simply can never render
   inline, because rendering is where the danger is.

---

## The upload path

There are two ways in. The browser uses the resumable session protocol described
[above](#2-an-upload-that-dies-at-97-does-not-start-over); the one-shot
multipart route below remains for scripts, `curl` and anything that would rather
send a whole file in one request. Both converge on the same ingest function, so
they get the same validation, quota arithmetic and audit trail.

`POST /api/files`, `multipart/form-data`, one or many files.

```
busboy parses the stream
  ├── each part is written straight to a spool file (0600), never buffered
  ├── SHA-256 and the byte count are computed while it flows
  ├── the first 4 KB are kept for magic-byte sniffing
  └── the parser's own fileSize limit aborts a file that grows too large,
      mid-transfer; every partial spool file is unlinked on any failure path
       │
       ▼
per file, in order:
  1. refuse blocked extensions outright
  2. resolve the content type from magic bytes > extension > client claim
  3. move the blob into storage (a rename on local disk; a PUT on S3)
  4. BEGIN; SELECT … FOR UPDATE on the user row
       re-check the quota, resolve a free filename, INSERT
     COMMIT
  5. on any failure, delete the blob again — the database is the source of truth
```

A batch reports per-file outcomes: `{ files, rejected, deduped, versioned }`.
One rejected file out of twelve does not discard the other eleven. If nothing
lands, the response carries the status the first failure actually earned — 413
too large, 415 unsupported, 507 out of space — instead of flattening every cause
into one generic code.

Two details that were bugs first and are now tests:

- **busboy raises `limit` when the counter *reaches* `fileSize`**, so a 100 MB
  cap rejected a 100 MB file. The parser is given one byte of headroom, and
  `tests/files.test.ts` asserts that exactly-the-limit passes and one byte more
  does not.
- **Retrying an `INSERT` after a unique violation inside a transaction does not
  work** in Postgres — the transaction is already aborted. Free names are
  resolved with a query instead.

Downloads are streamed back with byte-range support (so video seeks), a strong
`ETag` from the content hash (so conditional requests return 304), and — when the
backend is S3-compatible — a 302 to a short-lived presigned URL with the filename
and disposition pinned into the signature, so file bytes never occupy an API
process.

---

## The sharing model

```
file.visibility  private | public          the switch in the UI
share_links      kind = toggle | custom
```

- Turning the switch **on** creates (or reuses) the file's single `toggle` link.
- Turning it **off** revokes *every* link on that file, including custom ones —
  the switch has to mean "nobody outside this account can reach it".
- A `custom` link may carry a password (Argon2id), an expiry, a download budget
  and a preview permission. Creating one marks the file public so the badge in
  the UI never disagrees with reality.
- Trashing a file revokes its links and resets it to private.
- A resolution passes only if: the link exists, is not revoked, has not expired,
  has budget left, and the file still exists and is still public. Anything else
  is a flat 404 — someone guessing slugs learns nothing.
- The download budget is claimed with a conditional `UPDATE … WHERE
  download_count < max_downloads` **before** the bytes are sent, so two
  simultaneous requests on a one-download link cannot both win.
- Unlocking a password returns a short-lived JWT scoped to that one slug, so it
  cannot be replayed against another link. A cross-link replay is a test.

---

## API reference

All routes are under `/api`. Bodies and responses are JSON except file content.
Cookies carry the session; mutating requests need `X-CSRF-Token`.

### Auth

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/auth/csrf` | Bootstrap: returns the CSRF token and whether a session may be restorable |
| `POST` | `/auth/register` | 201 + user. Rate limited 10/h per IP |
| `POST` | `/auth/login` | Rate limited 30/15min per IP, 8/15min per account |
| `POST` | `/auth/refresh` | Rotates the refresh token; detects replay |
| `POST` | `/auth/logout` | Revokes this session |
| `GET` `PATCH` | `/auth/me` | Read / update display name and accent |
| `POST` | `/auth/password` | Changing it revokes every other session |
| `GET` | `/auth/sessions` | Signed-in devices |
| `DELETE` | `/auth/sessions/:id` · `/auth/sessions` | Revoke one · revoke all others |
| `POST` | `/auth/delete-account` | Requires password + typed confirmation |

### Files

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/files` | Multipart upload, streamed |
| `GET` | `/files` | `scope` `folderId` `q` `kind` `sort` `dir` `limit` `cursor`. `scope=shared` is what I published; `scope=incoming` is what others shared with me |
| `GET` | `/files/stats` | Quota, counts, and the per-family breakdown |
| `GET` | `/files/:id` | Metadata + its share links |
| `GET` `HEAD` | `/files/:id/content` | Ranges, ETag, `?disposition=inline\|attachment\|auto` |
| `PATCH` | `/files/:id` | Rename, move, star, set visibility |
| `DELETE` | `/files/:id` | To trash |
| `POST` | `/files/actions/{trash,restore,purge,move,star}` | Bulk, by id list |
| `DELETE` | `/files/trash` | Empty the trash |
| `GET` | `/files/:id/versions` | Revision history |
| `POST` | `/files/:id/versions/:n/restore` | Append that revision as the newest |
| `DELETE` | `/files/:id/versions/:n` | Prune a superseded revision |

### Resumable uploads

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/uploads` | Open a session — or return a finished file, if the offered hash is one we hold |
| `GET` | `/uploads` · `/uploads/:id` | Unfinished sessions · what a session still needs |
| `PUT` | `/uploads/:id/chunks/:index` | One chunk, streamed; idempotent; optional `X-Chunk-Sha256` |
| `POST` | `/uploads/:id/complete` | Verify the assembled hash, then ingest |
| `DELETE` | `/uploads/:id` | Abandon, and drop the partial bytes |

### Folders · Shares · Activity

| Method | Path | Notes |
| --- | --- | --- |
| `GET` `POST` | `/folders` | Flat list with counts · create (auto-dedupes the name) |
| `PATCH` `DELETE` | `/folders/:id` | Rename or reparent (cycles rejected) · trash the subtree |
| `POST` | `/folders/:id/restore` | Restores to the root if its parent is still trashed |
| `GET` | `/folders/:id/breadcrumbs` | Recursive CTE, depth-capped |
| `GET` `POST` | `/shares` | Every live link · create one |
| `PATCH` `DELETE` | `/shares/:id` | Update conditions · revoke |
| `GET` | `/activity` | Own actions plus anonymous hits on own links, keyset-paginated |
| `GET` | `/shares/:id/receipts` | Views, downloads and failed passwords for one link |
| `GET` `POST` | `/requests` | Upload links · create one |
| `GET` | `/requests/:id/submissions` | What arrived through a link, and from whom |
| `PATCH` `DELETE` | `/requests/:id` | Change the caps · close the link |
| `GET` | `/insights` | Largest, duplicated, stale, version-heavy, reclaimable |
| `GET` | `/collab/shared-with-me` | Folders other people have shared with me |
| `GET` `POST` | `/collab/folders/:id/people` | The guest list · invite or change a role |
| `DELETE` | `/collab/folders/:id/people/:personId` | Cut one person off |

### Public (no session)

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/s/:slug` | Metadata, or `{ requiresPassword: true }` and nothing else |
| `POST` | `/s/:slug/unlock` | Returns a grant scoped to this slug. 10/15min per IP+slug |
| `GET` `HEAD` | `/s/:slug/content` | Claims a download from the budget before streaming |
| `GET` | `/r/:slug` | Upload-link details, or `{ requiresPassword: true }` |
| `POST` | `/r/:slug/unlock` | Grant scoped to this link |
| `POST` | `/r/:slug/uploads` | Open a session as the owner, into their folder |
| `PUT` | `/r/:slug/uploads/:id/chunks/:index` | Same chunk protocol, no account needed |
| `POST` | `/r/:slug/uploads/:id/complete` | Echoes only what was sent |
| `GET` | `/health` | Liveness + database latency |

Errors are consistent:

```json
{ "error": { "code": "quota_exceeded", "message": "Not enough space: 118 MB needed, 41 MB free.",
             "fields": { "…": ["…"] } },
  "requestId": "3f0c…" }
```

---

## Front end

Next.js 15 App Router, React 19, Tailwind v4 for tokens and layout, and
**nothing else** — no component library, no icon package, no state library, no
form library. Every control, icon and animation in the app is in this repository.

**Design.** The interface is built around one idea: cooled basalt. A near-black
stone palette with one molten accent (a warm paper palette in light mode); an
editorial serif for display type so headings do not read as UI; a grotesk for the
interface; and a monospace with tabular figures for anything a person might
compare digit by digit — sizes, dates, checksums, transfer rates. A single
fixed-position SVG grain layer keeps large flat panels from looking like a
screenshot of a config file.

Two pieces of it are drawn from data rather than shipped as assets:

- **The core sample** (sidebar and settings) is the quota meter. A geologist
  reads a drilled core bottom-up, each band's thickness telling you how much of
  it there is; this does the same for a disk quota, so one glance answers both
  "how full" and "full of what". A plain progress bar answers only the first.
- **The columnar formation** on the sign-in, empty-state, share and 404 pages is
  generated from a seeded PRNG — every surface gets its own formation, at a cost
  of a few hundred bytes instead of a stock illustration.

**Interaction.** Drag files anywhere to upload; drag rows onto a sidebar folder to
move them. `⌘K` opens a palette that searches the whole drive over the API,
jumps to folders and runs commands. `j`/`k` walk the list, `space` previews,
`x`/`⇧-click` build a selection, `r` renames, `s` shares, `m` moves, `u` uploads,
`⌫` trashes, `/` focuses search. Destructive actions are undoable from the toast
that reports them; irreversible ones (empty trash, delete account) make you type
the phrase.

**Transfers** get a download-manager dock rather than a toast, because a 100 MB
upload outlives the user's attention: per-file progress, smoothed rate, ETA, a
throughput sparkline that makes a stalled connection obvious, and pause, resume,
cancel and retry. Files that cannot possibly succeed — empty, over the limit, a
blocked extension — are rejected client-side with a reason before a byte leaves
the machine.

The dock also shows the two states that only exist because uploads are
resumable: **paused** after a network failure, where nothing is lost and
resuming asks the server what is still missing; and **interrupted**, for a
session that outlived the page, which asks for the file again and then sends
only the part that never arrived.

**SHA-256 is implemented here** ([`lib/sha256.ts`](apps/web/lib/sha256.ts)),
because `crypto.subtle` can only digest a buffer it already holds — hashing a
400 MB file that way means 400 MB in memory. This one eats the file in slices,
keeping memory flat, and yields between them so the tab stays responsive. It is
verified against Node's implementation across the awkward block-boundary lengths.

**State.** One store (`lib/vault-context.tsx`) owns files, folders, quota and
selection, so the sidebar counts, the table, the meter and the dock always agree.
Mutations apply optimistically and roll back on failure. Overlays read the live
record through `useLiveFile`, so an open share sheet cannot disagree with the
list behind it.

**Accessibility and responsiveness.** Labelled controls throughout, focus trapped
and restored in dialogs, arrow-key menus, `aria-live` toasts, visible focus rings,
and `prefers-reduced-motion` honoured. The layout works from 375 px (rail becomes
a drawer, grid becomes two columns, search moves to its own row) up.

---

## Testing

```bash
npm test
```

114 tests against a real Postgres database (`basalt_test`, built by the same
migrations as production) and the real Express app through supertest. No mocked
database, no mocked storage — uploads are streamed through busboy onto disk and
read back byte-for-byte, and the resumable tests drive the real chunk protocol.

Every request in the suite carries an 8-second response deadline, so a call that
never returns names its own method and path instead of surfacing as an
inscrutable "test timed out". Cleanup deletes only the accounts a given file
created rather than truncating `users`, so two test files can never pull the
floor out from under each other.

One caveat about the machine this was developed on: roughly one full-suite run in
eight fails with a timeout or a 401 whose body is not this application's error
shape at all. The sandbox it was written in intermittently intercepts loopback
HTTP, which is what supertest uses. Individual files pass repeatedly (8/8 runs of
`files.test.ts` alone), no query is ever waiting in `pg_stat_activity` when it
happens, and the connection pool reports no waiters — so the hang is not in this
code. Chasing it did surface three genuine defects, all fixed: an audit row
written after the response had already been flushed, a connection pool too small
for the background writes a request fans out into (node-postgres queues an
acquisition forever, so that hangs rather than degrades), and test cleanup that
reached across files.

The suite is organised around behaviour that would matter in review:

- **auth** — Argon2id hashes in the column; identical answers for unknown-email
  and wrong-password; refresh rotation and family revocation on replay; logout
  taking effect immediately; a password change ejecting other devices; CSRF
  rejecting a missing token and a foreign origin.
- **files** — sniffed content type beating a lying `Content-Type`; blocked
  extensions; HTML forced to `attachment` with a sandbox CSP; path traversal
  stripped from the filename; exactly-the-limit accepted and one byte over
  rejected; quota enforced; byte ranges and 304s; the full trash → restore →
  purge lifecycle and its effect on quota; folder cycles refused; keyset
  pagination with no duplicates or gaps; and a full IDOR sweep proving another
  account gets 404 from every route.
- **shares** — public reachable, private not; going private revoking every link;
  trashing revoking links; a password link leaking nothing before unlock; a grant
  refused on a different slug; budget exhaustion; expiry; preview refused when
  the owner disabled it; and the audit trail recording an anonymous download.
- **uploads** — a multi-chunk file reassembled byte-for-byte; a resume after two
  chunks are deliberately dropped, including the "still missing" report and the
  refusal to complete early; a repeated chunk that does not double-count; a
  short chunk refused and resent; a bad per-chunk digest refused; an assembled
  hash that contradicts the client refused *and nothing stored*; sessions
  private to their account; and rejection of an oversized or blocked file before
  any bytes move.
- **content addressing** — the same bytes charged once however many files point
  at them; the surviving copy still readable after its twin is purged; an
  instant upload when the hash is known; **no** instant upload for another
  account's content; and the bytes freed only when the last reference goes.
- **versions** — history recorded and older revisions served; restore appending
  rather than rewinding; a repeated revision costing nothing; the current
  revision refusing to be deleted; and history private to the owner.
- **requests** — a stranger uploading with no account; the owner's inbox of who
  sent what; a sender unable to overwrite the owner's file; file and byte caps;
  a slot released when a sender abandons; a password hiding even the title; a
  grant refused on another link; revocation and expiry; the owner's quota being
  the one charged; and a completion response that leaks nothing.
- **collaborators** — the whole permission matrix: what a viewer, contributor and
  editor may and may not do; an invitation that resolves when its recipient
  registers; sharing covering subfolders; a contributor's uploads billed to the
  owner and credited to them; a contributor unable to touch the owner's files; an
  editor unable to publish or to move a file into their own drive; revocation
  cutting one person off and leaving the rest; and contributions surviving the
  contributor's departure.
- **search and insights** — a file found by a word inside it; a filename
  fragment still matching; binary not indexed; re-indexing when a version
  replaces the contents; one account's contents invisible to another; duplicate
  and version-cost reporting; and receipts recording views, downloads and failed
  passwords.

---

## Configuration

Everything comes from one `.env` at the repository root, read by both services
and validated by zod at boot. See [`.env.example`](.env.example).

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://basalt:basalt@localhost:5432/basalt` | |
| `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_PEPPER` | — | ≥32 chars; production refuses to boot with the sample values |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` | 900 / 2592000 | seconds |
| `STORAGE_DRIVER` | `local` | `local` or `s3` |
| `STORAGE_LOCAL_ROOT` | `./var/blobs` | Keep it outside any web root |
| `S3_BUCKET` `S3_REGION` `S3_ENDPOINT` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` `S3_FORCE_PATH_STYLE` | — | Any S3 API: AWS, R2, MinIO, Wasabi, Spaces |
| `MAX_UPLOAD_BYTES` | 536870912 | 512 MB per file |
| `DEFAULT_QUOTA_BYTES` | 10737418240 | 10 GB per account |
| `MAX_FILES_PER_UPLOAD` | 20 | Per request |
| `TRASH_RETENTION_DAYS` | 30 | |
| `WEB_ORIGIN` | `http://localhost:3000` | CORS allowlist, cookie scope, share-link building |
| `NEXT_PUBLIC_API_BASE` | `http://localhost:4000/api` | Where the browser sends API calls; set to `/api` for a single-origin deployment |
| `TRUST_PROXY` | `false` | Enable only behind a real proxy, or clients can spoof their IP past the rate limits |

---

## Deployment

Everything here is on a free tier that does not expire, and none of it needs a
card except the object store. The shape is one container serving both halves
behind a single hostname, a managed Postgres, and an object store for the file
bytes.

```
        ┌──────────────────── one container ────────────────────┐
        │                  ┌─/api/*─▶  Express :4000            │──▶  Neon Postgres
 you ──▶│  nginx :$PORT ───┤                                    │       (metadata)
        │                  └─else───▶  Next :3100               │
        └──────────────────────────────────────────────────────-┘
                                  │
                                  └───────────────────────────────▶  R2 / B2
                                                                   (the bytes)
```

The container is [`Dockerfile`](Dockerfile) at the repository root;
[`scripts/start.sh`](scripts/start.sh) migrates, renders the nginx config, then
runs all three processes and takes the container down if any of them dies so the
platform restarts it.

**Why nginx rather than letting Next serve the public port.** It is the obvious
arrangement — Next on `$PORT`, `/api/*` forwarded to Express through
`next.config.mjs` rewrites — and it silently caps every upload at 10 MB. Next
buffers a proxied request body in memory so it can be read more than once, and
past the limit it keeps the first 10 MB, logs a warning and resets the
connection. The client sees a 500 with no explanation. Raising
`experimental.proxyClientMaxBodySize` only relocates the failure: a 512 MB
upload would then want 512 MB of heap on a 512 MB instance.

So Next stops being an API gateway. nginx streams request bodies straight to
whichever service owns the route — `proxy_request_buffering off`, no size ceiling
of its own, because the API already enforces `MAX_UPLOAD_BYTES` and returns a
structured 413 for it. Both Node processes move to loopback.

One subtlety worth knowing about if you change
[`docker/nginx.conf.template`](docker/nginx.conf.template): it passes
`X-Forwarded-For` through *unchanged* rather than appending to it. The container
is one hop from the platform's edge, and Express is configured to trust exactly
one proxy; appending would make it read the edge's address as the client and
bucket every visitor into the same rate-limit window.

### 1. Database — Neon (free, permanent, no card)

Create a project at <https://neon.tech>, choose **Postgres 17** (what the test
suite runs against), then copy the **direct** connection string — the one whose
host does *not* contain `-pooler`. That is your `DATABASE_URL`; also set
`DATABASE_SSL=true`.

`DATABASE_SSL` is a fallback, not the mechanism. Neon's string carries
`sslmode=require`, and node-postgres lets the connection string override the
pool's own `ssl` option — so the connection ends up TLS-verified against the
public CA store, which is *stronger* than the `rejectUnauthorized: false` the
flag asks for. Setting it matters only for a `DATABASE_URL` that arrives without
an `sslmode`.

The direct endpoint matters. Neon's pooled endpoint is PgBouncer in transaction
mode, where consecutive statements may land on different backends, and
[`migrate.ts`](apps/api/src/db/migrate.ts) holds a *session*-level
`pg_advisory_lock` across the transactions it guards. Through the pooler that
lock would be taken on one backend and released against another: no protection
against two containers migrating at once, and a leaked lock left behind. The app
runs its own pool of ten connections, so it has no need of a second pooler.

Free tier is 0.5 GB, which is thousands of files — the *bytes* live in object
storage, so the database only holds metadata. It scales to zero when idle; the
first request after a quiet spell pays roughly half a second to wake it, well
inside the pool's 10 s connect timeout.

### 2. File storage — pick one

The `s3` driver speaks plain S3, so any of these work with nothing but
credentials:

| | Free | Card needed | Notes |
| --- | --- | --- | --- |
| **Cloudflare R2** | 10 GB | yes, for verification | no egress fees, fastest option |
| **Backblaze B2** | 10 GB | yes, for verification | S3-compatible endpoint |
| **Supabase Storage** | 1 GB | no | S3 endpoint under Project → Storage → S3 |

Create a bucket, keep it **private**, make an access key, then set:

```bash
STORAGE_DRIVER=s3
S3_BUCKET=basalt
S3_REGION=auto                      # 'auto' for R2; the real region elsewhere
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
S3_FORCE_PATH_STYLE=true            # required by MinIO and B2; harmless on R2
```

Leave `S3_ACL` and `S3_SSE` unset. R2 and B2 reject those headers, and so does
any AWS bucket with ACLs disabled.

#### Not being billed for it

No object store offers a hard spending cap — Cloudflare included. You can be
*alerted*, but an alert is not a brake, so the brake has to be in the
application:

```bash
GLOBAL_STORAGE_LIMIT_BYTES=6442450944   # 6 GiB = 6.44 GB, under R2's 10 GB
DEFAULT_QUOTA_BYTES=1073741824          # 1 GiB per account
```

Both are already set in [`render.yaml`](render.yaml). The first is the one that
matters, and the distinction is the whole point: a per-account quota is not a
bound on anything, because signing up again mints another one. Ten accounts at
10 GB each is 100 GB. `GLOBAL_STORAGE_LIMIT_BYTES` is measured over every blob
in the deployment with no owner filter, so a brand-new account with an entirely
unspent quota is refused just the same once the service is full.

Past the ceiling the API answers `507 capacity_reached` — a separate code from
`quota_exceeded` precisely so "this user needs more space" and "the service is
full" are distinguishable — and stops accepting uploads. Everything already
stored still reads, downloads and shares normally.

Registration is also throttled, at ten accounts per hour per IP, so filling the
ceiling through mass signup is slow as well as capped.

Why capping *stored bytes* is sufficient for R2 specifically: storage is its only
billed dimension that accumulates. Egress is free — that is R2's whole selling
point — and the operation allowances (1 M writes, 10 M reads) reset monthly and
are far beyond what one upload per file and one read per download will reach.

The margin is deliberate, and larger than it first looks. R2 measures in decimal
GB, so 6 GiB is 6.44 of its GB against an allowance of 10 — about 3.5 GB spare.
Three things eat into it: the check is advisory before a transfer and binding only
inside the commit transaction, so simultaneous uploads can each see headroom and
overshoot by up to one `MAX_UPLOAD_BYTES` apiece; Cloudflare rounds usage up to
the next whole GB; and binned files keep occupying the bucket until the retention
window passes. Setting the ceiling to exactly the allowance would absorb none of
that.

One bucket setting matters here: leave **Default Storage Class** as *Standard*.
The free tier does not apply to Infrequent Access, so switching it would start
billing from the first byte.

Verified by [`tests/capacity.test.ts`](apps/api/tests/capacity.test.ts): that the
ceiling refuses a resumable upload when it is *opened* rather than after the
bytes have moved, that de-duplicated content is measured once, and that blobs
sitting in the bin still count — the store is charging for those.

> The endpoint has to be reachable **from the browser**, not just from the
> server: downloads are a redirect to a short-lived presigned URL, so the bytes
> travel straight from the bucket and never occupy the app. An internal-only
> endpoint will upload fine and fail on download.

### 3. Hosting — Render

[`render.yaml`](render.yaml) is a blueprint for exactly this: **New → Blueprint**,
point it at the repo, and it prompts for the six values from steps 1 and 2 while
generating the two token secrets itself.

It declares **one** service rather than two. The container runs Next on the
public port with Express behind it on loopback, so the browser sees a single
origin — which is what the `__Host-` prefixed session cookies require. Split
across two `*.onrender.com` hostnames those cookies would be cross-site and the
login would silently fail to stick.

`WEB_ORIGIN` is deliberately absent from the blueprint: [`env.ts`](apps/api/src/config/env.ts)
reads `RENDER_EXTERNAL_URL`, so CORS and the share links match the real hostname
with nothing to configure.

Free instances sleep after 15 minutes idle and take about a minute to wake. The
hostname is permanent; only the first request after a quiet spell pays for it.

> Koyeb used to be the recommendation here because its free tier stayed awake.
> It no longer has one — its pricing now starts at $29/month — so the
> `KOYEB_PUBLIC_DOMAIN` branch in `inferWebOrigin` is kept only for anyone on a
> paid plan. Render's free Postgres is not a substitute for step 1 either: it is
> deleted after 30 days, which is the opposite of a permanent link.

**Do not use the free tier's disk for files.** It is wiped on every deploy. That
is what step 2 is for.

### 4. A permanent address

The host subdomain (`your-app.onrender.com`) is already permanent and free — for
most purposes that is the answer. It survives redeploys; nothing about it lapses.

If you want something that reads better, `is-a.dev` gives away permanent
subdomains through a pull request, and [`docs/is-a-dev-domain.md`](docs/is-a-dev-domain.md)
has the exact file to submit. Render supports custom domains on the free plan,
so it works with the deployment above.

There is no longer a source of free permanent *top-level* domains — Freenom, the
one everybody remembers, stopped issuing them. A `.com` is a few dollars a year
if the name matters.

### Checking a deployment

```bash
curl https://basalt.onrender.com/api/health
# {"status":"ok","storage":"s3","dbLatencyMs":12,…}
```

`storage` tells you which driver is live. If it says `local` on a cloud host,
uploads will disappear on the next deploy.

### Running it locally in one command

```bash
cp .env.example .env    # then set the two secrets
docker compose up --build
```

Postgres, the API and the web app, on <http://localhost:3000>.

### Switching to S3 for an existing install

One variable — but note that files already stored on local disk are not migrated
by changing it. The database keeps a `storage_driver` per blob, so old rows still
point at the old location.

## Engineering decisions

**Express + Kysely rather than a framework with an ORM.** The interesting parts of
this problem are the streaming upload path, the authorisation rules and the SQL —
all of which an ORM would hide. Kysely gives full type safety over queries I can
read as SQL, and the schema lives in plain `.sql` files a DBA can review.

**Cookies, not `localStorage`.** A token readable by JavaScript is a token an XSS
payload can steal. `httpOnly` cookies cost a CSRF defence, which is a solved
problem (origin check + double submit); the reverse trade is not.

**JWT *and* a session row.** The JWT keeps the common path stateless, and the
session row makes revocation immediate. One indexed lookup per request buys
sign-out that actually signs you out — worth it.

**404 instead of 403 for another user's resource.** 403 confirms the id exists.

**The spool file.** Uploads are written to disk before anything else happens, so
size limits, hashing and sniffing all operate on bytes we already hold, memory
use is constant regardless of file size, and the same code path works for local
disk and S3.

**A denormalised usage counter, maintained by a trigger.** Summing `size_bytes`
on every request is a table scan per page view; a counter that application code
must remember to update will drift. A trigger cannot forget, and
`SELECT SUM(size_bytes)` remains available to reconcile.

**Rate limiting in process memory.** This ships as a single API instance, and
fixed-window counters in a `Map` protect it with no operational dependency. The
middleware signature is the seam: behind more than one instance, swap the store
for Redis `INCR`/`EXPIRE` and nothing else changes. That trade-off is stated
where the code lives rather than hidden.

**The browser talks to the API directly in development.** Next's dev-server
rewrite proxy silently fails on request bodies over roughly 10 MB — fatal for a
file service, and it cost real debugging time to find. The API base is one
variable, so a single-origin deployment sets `/api` and gets the proxy path.

**Content addressing before features.** De-duplication, instant uploads and
version history are three faces of one decision: separate "the bytes" from "the
file that points at them". Building them as three features would have meant
three sets of accounting bugs.

**One ingest path, four callers.** A plain multipart upload, the last step of a
resumable session, a submission through an upload link, and an instant upload of
known content all funnel through `files/ingest.ts`. Writing that validation four
times is how one of them ends up subtly weaker than the others.

**Chunks into a sparse file, not a directory of parts.** Positional writes at
`index × chunkSize` mean the finished file already exists the moment the last
chunk lands: no reassembly pass, no fragment cleanup, and constant memory.

**Capacity is checked where it is claimed, not where the link is resolved.** The
first version of upload links checked "is this link full?" during resolution,
which then rejected the chunks of the very upload that had just reserved the last
slot. Reservation and validity are separate questions.

**No UI kit.** The brief asked for a considered interface. A component library
would have produced a competent-looking application that could be any other
application; the parts worth looking at here — the core-sample meter, the
transfer dock, the kind glyphs, the generated formations — are exactly the parts
a kit cannot provide.

---

## Known limits and what comes next

Honest about the edges:

- **No thumbnail pipeline.** Grid tiles render the original image, which is fine
  for a 500 KB photograph and wasteful for a 40 MB one. Needs a worker
  generating derivatives on upload.
- **No virus scanning.** The right hook is between the spool file and the storage
  `put` — the blob is already on disk and not yet visible to anyone.
- **No email.** So no verification and no password reset; the account is the only
  way back in. Both are plumbing, not design.
- **Content extraction is narrow on purpose.** Text, code, markdown, CSV, JSON
  and simple PDFs. Office documents are zip containers and scanned pages need
  OCR; both belong in an extraction worker rather than in the request path.
- **Resuming after a reload needs the file re-picked.** The browser will not hand
  a file's contents back to script without a fresh gesture. Everything already
  transferred still counts, but the gesture is unavoidable.
- **Rate limits and upload-session state are single-instance** as described
  above.

Still on the list, in the order I would build it: a thumbnail and extraction
worker (the schema for derivatives is in place; the generation step and Office /
OCR support are not) · optional client-side encryption for a zero-knowledge tier ·
scheduled expiry notices, which needs email · a `basalt` CLI over the same API.

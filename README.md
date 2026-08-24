# Basalt

A secure file storage service: register, upload, organise, and share files with
per-file access control, revocable links, and a readable audit trail.

Built as a full-stack engineering exercise. Two services in one repository — a
TypeScript/Express API over PostgreSQL, and a Next.js front end — with no
component library, no UI kit, and no generated boilerplate.

```
demo account   demo@basalt.build / stone-and-ash-2026
               (the sign-in page has a one-click button for it)
```

---

## Contents

- [Quick start](#quick-start)
- [What it does](#what-it-does)
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

| Command | Does |
| --- | --- |
| `npm run dev` | Both services with reload |
| `npm test` | API test suite (40 tests, real Postgres, no mocks) |
| `npm run typecheck` | `tsc --noEmit` across both workspaces |
| `npm run build` | Production build of both |
| `npm run db:migrate` / `db:reset` / `db:seed` | Schema and demo data |

---

## What it does

**Accounts** — register, sign in, change password, list and revoke signed-in
devices, delete the account and everything in it.

**Files** — drag-and-drop upload of many files at once with live progress, rate
and ETA per transfer, plus cancel and retry. Rename, move, star, soft-delete,
restore, purge. Folders nest arbitrarily; cycles are rejected. Search by name
across the whole drive, filter by twelve file families, sort by name, size or
date, keyset-paginated.

**Sharing** — a switch per file makes it public. Beyond that, a file can carry
any number of links, each with its own optional password, expiry, download
budget and preview permission. Every link is revocable and takes effect on the
next request.

**Visibility** — a preview overlay for images, video, audio, PDF and text; a
storage meter that shows what the space is made of; and an activity feed that
records uploads, downloads, renames, visibility changes, link visits and failed
password attempts, with time and address.

**Limits** — 512 MB per file and 10 GB per account by default, both
configurable. Uploads are streamed, so file size is bounded by disk, not RAM.
Verified with a 150 MB upload through the API and a 117 MB upload through the
browser UI.

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
└── storage/             driver.ts (port) · local.ts · s3.ts
```

---

## Data model

Six tables. The full DDL, with comments explaining each constraint, is
[`001_init.sql`](apps/api/src/db/migrations/001_init.sql).

| Table | Holds | Notable choices |
| --- | --- | --- |
| `users` | identity, quota, usage | `citext` email so `Ada@x.com` cannot become a second account; `storage_used_bytes` maintained by trigger |
| `sessions` | one row per issued refresh token | `family_id` groups a rotation chain, so replaying a retired token can kill the whole chain |
| `folders` | tree, soft-deleted | partial unique index on `(owner, parent, lower(name))` — sibling names are unique, case-insensitively, ignoring trash |
| `files` | metadata; bytes live in storage | `mime_type` is what we serve, `declared_mime` is what the client claimed, `mime_mismatch` flags the disagreement |
| `share_links` | public links | one `toggle` link per file (partial unique index) plus any number of `custom` ones |
| `events` | append-only audit trail | keeps a denormalised `subject` so the trail still reads after a hard delete |

Design points worth calling out:

- **Every index is deliberate.** Listing, trash, starred, search, purge sweeps
  and share resolution each have a matching (mostly partial) index; nothing is
  covered twice.
- **Storage accounting is a trigger, not application code.** `files_storage_delta`
  fires on insert/update/delete, so the counter cannot drift when a code path
  forgets. Trash still occupies quota — it is recoverable, so pretending
  otherwise would be lying to the user.
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

Two deliberate refusals, both visible in the code:

1. **The client's `Content-Type` is never trusted for anything that matters.**
   It is stored for the audit trail and shown in the UI as "declared as", and
   that is all.
2. **A file that lies about itself is not deleted, it is quarantined by policy.**
   `mime_mismatch` files still download normally — they simply can never render
   inline, because rendering is where the danger is.

---

## The upload path

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

A batch reports per-file outcomes: `{ files: [...], rejected: [{ name, code, message }] }`.
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
| `GET` | `/files` | `scope` `folderId` `q` `kind` `sort` `dir` `limit` `cursor` |
| `GET` | `/files/stats` | Quota, counts, and the per-family breakdown |
| `GET` | `/files/:id` | Metadata + its share links |
| `GET` `HEAD` | `/files/:id/content` | Ranges, ETag, `?disposition=inline\|attachment\|auto` |
| `PATCH` | `/files/:id` | Rename, move, star, set visibility |
| `DELETE` | `/files/:id` | To trash |
| `POST` | `/files/actions/{trash,restore,purge,move,star}` | Bulk, by id list |
| `DELETE` | `/files/trash` | Empty the trash |

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

### Public (no session)

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/s/:slug` | Metadata, or `{ requiresPassword: true }` and nothing else |
| `POST` | `/s/:slug/unlock` | Returns a grant scoped to this slug. 10/15min per IP+slug |
| `GET` `HEAD` | `/s/:slug/content` | Claims a download from the budget before streaming |
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
throughput sparkline that makes a stalled connection obvious, cancel, and retry.
Files that cannot possibly succeed — empty, over the limit, a blocked extension —
are rejected client-side with a reason before a byte leaves the machine.

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

40 tests against a real Postgres database (`basalt_test`, built by the same
migrations as production) and the real Express app through supertest. No mocked
database, no mocked storage — uploads are streamed through busboy onto disk and
read back byte-for-byte.

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

Switching to S3 is one variable:

```bash
STORAGE_DRIVER=s3
S3_BUCKET=basalt-prod
S3_REGION=eu-west-1
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
```

Nothing else changes: uploads are still spooled, hashed and validated locally,
then `PUT` to the bucket, and downloads become presigned redirects. The bucket
should stay private — authorisation is the API's job, and the presigned URL is
the only way in.

**Run it behind one origin.** Put a proxy in front of both services, route
`/api/*` to the API and everything else to Next, and set
`NEXT_PUBLIC_API_BASE=/api`. Cookies become first-party, CORS stops being
involved at all, and `__Host-` cookie prefixes apply.

**Production checklist**

- `NODE_ENV=production` (turns on `Secure`, `__Host-` prefixes and HSTS)
- Real secrets — the app refuses to start with the sample ones
- `TRUST_PROXY=true` only if there really is a proxy
- Body size limit on the proxy at or above `MAX_UPLOAD_BYTES`
- Run `npm run db:migrate` before rolling out; the runner takes an advisory lock,
  so parallel instances cannot race
- `GET /api/health` for liveness; it reports database latency
- Housekeeping (trash purge, session prune, orphan sweep) runs in-process every
  6 hours. To keep it out of the request path, disable it and run
  `node dist/maintenance.js` from a cron job or Kubernetes CronJob instead

---

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

**No UI kit.** The brief asked for a considered interface. A component library
would have produced a competent-looking application that could be any other
application; the parts worth looking at here — the core-sample meter, the
transfer dock, the kind glyphs, the generated formations — are exactly the parts
a kit cannot provide.

---

## Known limits and what comes next

Honest about the edges:

- **No resumable uploads.** A dropped connection restarts that file. Real
  resumability needs chunked multipart with an upload session per file — the
  right phase-two feature for anything over a few hundred megabytes.
- **No thumbnail pipeline.** Grid tiles render the original image, which is fine
  for a 500 KB photograph and wasteful for a 40 MB one. Needs a worker
  generating derivatives on upload.
- **No virus scanning.** The right hook is between the spool file and the storage
  `put` — the blob is already on disk and not yet visible to anyone.
- **No email.** So no verification and no password reset; the account is the only
  way back in. Both are plumbing, not design.
- **Search is trigram `LIKE` on the filename.** It does not read file contents.
  A `tsvector` column and an extraction step would fix that.
- **Rate limits and sessions are single-instance** as described above.

Phase two, in the order I would build it: resumable chunked uploads · shared
folders with per-recipient permissions and named recipients instead of bearer
links · server-side thumbnails and text extraction for real search · versioning
with restore · optional client-side encryption for a zero-knowledge tier ·
scheduled link expiry notifications · a `basalt` CLI over the same API.

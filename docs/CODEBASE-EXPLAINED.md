# Basalt, explained from zero

**Who this is for:** you are about to be interviewed about this codebase and you
have no programming background. This document starts at "what is a website" and
ends at "here is what every file does and why."

**How to read it.** Part 1 to 3 are the foundations — read those first, properly,
even though they feel slow. Everything after that assumes them. Part 11 is a
glossary: every jargon word gets a **real** definition (what an interviewer means
by it) and a **plain** one (the version you'd tell a child). If a word confuses
you mid-document, jump to Part 11 and come back.

**One honest warning.** Analogies get you in the door; they do not get you
through a technical interview on their own. Where I give you a picture, I also
give you the accurate sentence. Learn the accurate sentence. If you only
remember the picture and an interviewer pushes one level deeper, the picture will
break and you will sound like you are guessing. Better to say "I know it stores
the file's fingerprint so duplicates aren't stored twice — I'd have to look at
the exact code" than to invent.

---

# Part 1 · The absolute basics

## 1.1 What a website actually is

When you open a website, two computers talk.

**Your computer** (the *client*) and **a computer somewhere else** (the
*server*). Your browser sends a message — "please give me the home page" — and
the server sends a message back — "here it is."

That's it. That's the whole internet. Messages back and forth.

> **Plain version:** you shout an order through a restaurant window. The kitchen
> makes it and passes it back. You are the client. The kitchen is the server.

## 1.2 The three pieces of any app like this

Almost every web application is three things:

| Piece | What it is | In Basalt |
|---|---|---|
| **Front end** | What you see and click. Runs in *your* browser. | Next.js — the `apps/web` folder |
| **Back end** | The rules and decisions. Runs on the *server*. | Express — the `apps/api` folder |
| **Database** | Where facts are remembered. | PostgreSQL |

Why separate them at all? Because you cannot trust the front end. Anyone can
open their browser's developer tools and change what it sends. So the front end
is a *convenience*, and the back end is the *authority*. The front end hides the
"Delete" button on a file you don't own; the back end is what actually refuses
if you ask anyway.

This is the single most important idea in the whole document. If an interviewer
asks one security question, it will be a version of this.

> **Plain version:** the menu in your hands is the front end. You can scribble
> "free ice cream" on it. The kitchen has its own list and doesn't care what
> your menu says. The kitchen is the back end.

## 1.3 What a database is

A database is a set of tables. A table is a grid — like a spreadsheet — with
named columns and one row per thing.

Basalt's `users` table, simplified:

| id | email | password_hash | quota_bytes |
|---|---|---|---|
| 3a7d… | ada@example.com | $argon2id$v=19$… | 1073741824 |
| 91bc… | sam@example.com | $argon2id$v=19$… | 1073741824 |

You talk to a database in a language called **SQL**. "Give me the row from
`users` where email is ada@example.com" is written:

```sql
SELECT * FROM users WHERE email = 'ada@example.com';
```

That's readable, and that's on purpose — SQL was designed to look like English.

## 1.4 Where the actual files live (this trips people up)

Here is a thing that surprises everyone: **the uploaded files are not in the
database.**

Databases are good at facts — small, structured, searchable. They are bad at
holding a 500 MB video. So Basalt splits it:

- The **database** remembers *about* the file: its name, size, who owns it,
  whether it's public, its fingerprint.
- The **object store** holds the actual bytes. In this deployment that's
  Cloudflare R2.

So a file in Basalt is two things in two places, joined by a key.

> **Plain version:** the library catalogue card tells you the title, author and
> shelf number. The card is not the book. The book is on the shelf. The database
> is the card; R2 is the shelf.

## 1.5 What "an API" means

An **API** is the list of messages the back end will accept. Nothing more
mysterious than that.

Basalt's API includes messages like:

```
POST /api/auth/login          "here are my credentials, let me in"
GET  /api/files               "list my files"
POST /api/files               "here is a file, store it"
GET  /api/files/:id/content   "send me the bytes of file :id"
DELETE /api/files/:id         "move file :id to the bin"
```

`GET` means "give me something." `POST` means "here, take this." `DELETE` means
what it says. `PUT` means "replace/put this here." These are called **HTTP
methods** or **verbs**.

The `:id` is a placeholder — a real request looks like
`/api/files/3a7df115-350c-45d0-90a7-1603e69107df/content`.

## 1.6 Status codes — the numbers you'll be asked about

Every response carries a number saying how it went. You should know these six:

| Code | Means | When Basalt sends it |
|---|---|---|
| **200** | OK | Normal success |
| **201** | Created | You uploaded a file, made an account |
| **206** | Partial Content | You asked for part of a file (used by previews and video seeking) |
| **401** | Unauthorised | You're not signed in |
| **403** | Forbidden | You're signed in but not allowed |
| **404** | Not Found | No such thing |
| **507** | Insufficient Storage | Out of quota, or the service is full |

**Interview-relevant detail:** when you ask for a file belonging to someone
else, Basalt deliberately answers **404, not 403**. Because 403 means "this
exists but isn't yours" — which tells an attacker the file exists. 404 tells
them nothing. That's called avoiding an *information leak*, and it's the kind of
deliberate choice interviewers like to hear about.

## 1.7 What TypeScript is, and why it's everywhere here

**JavaScript** is the language browsers speak. **TypeScript** is JavaScript plus
labels saying what kind of thing each value is.

Without types:

```js
function chargeQuota(user, size) { ... }
```

Nothing stops you calling `chargeQuota("hello", "world")`. It breaks at 3am.

With types:

```ts
function chargeQuota(user: UserRow, size: number) { ... }
```

Now the computer refuses to build the program if you pass the wrong thing. The
mistake is caught while writing, not while running.

Every `.ts` and `.tsx` file in this project is TypeScript. `.tsx` means "contains
screen layout too."

> **Plain version:** types are the shaped holes in a toddler's shape-sorter. The
> star only fits the star hole. You find out immediately, not later.

---

# Part 2 · What Basalt is

## 2.1 In one sentence

A private file store: you make an account, upload files, organise them in
folders, and each file is private until you choose to publish it — and any link
you hand out you can take back.

## 2.2 What the assignment asked for

1. Users register and log in
2. Upload files
3. Organise them in a personal dashboard
4. Control public/private per file
5. Public files reachable by a shareable link; private files owner-only
6. Support files of 100 MB and more, with validation, progress and error handling

All six are done. Points 5 and 6 are the ones to demo, because they're the ones
with the most ways to go wrong.

## 2.3 What was added beyond the assignment

These are the answers to "what did you do that was interesting?" — the most
likely opening question.

| Feature | What it means | Why it matters |
|---|---|---|
| **Resumable uploads** | A big upload survives a lost connection and continues where it stopped | A 500 MB upload that restarts from zero on a dropped wifi is unusable |
| **De-duplication** | The same file uploaded twice is stored once and costs no extra quota | Storage costs money; identical bytes shouldn't be paid for twice |
| **Version history** | Re-uploading a name makes a new version instead of overwriting | Overwriting loses work with no warning |
| **Search inside files** | Finds a word that's in the document, not just in its name | You remember what a document *said*, not what you called it |
| **Folder collaborators** | Share a folder with a person as viewer/contributor/editor | A link can't be taken back from one person; a named grant can |
| **File requests** | A link that lets someone send *you* files, without an account | Collecting files from people who shouldn't need to sign up |
| **Share receipts** | See who opened your link, when, and from where | Knowing a document arrived without asking |
| **Storage insights** | What's duplicated, what versions cost, what the bin holds | Answering "why is my drive full" |

---

# Part 3 · The map

## 3.1 The shape of the repository

```
basalt/
├── package.json          ← the project's identity card and command list
├── Dockerfile            ← recipe for packaging the whole app to run anywhere
├── render.yaml           ← instructions for the hosting company
├── README.md             ← the human explanation
│
├── apps/
│   ├── api/              ← THE BACK END (the rules)
│   │   ├── src/
│   │   │   ├── server.ts       ← the on switch
│   │   │   ├── app.ts          ← assembles the back end
│   │   │   ├── config/         ← reads settings
│   │   │   ├── db/             ← database connection + table definitions
│   │   │   ├── middleware/     ← checks every request passes through
│   │   │   ├── modules/        ← the actual features, one folder each
│   │   │   ├── storage/        ← where file bytes are written
│   │   │   └── lib/            ← small shared helpers
│   │   └── tests/              ← 120 automated checks
│   │
│   └── web/              ← THE FRONT END (what you see)
│       ├── app/                ← the pages, one folder per URL
│       ├── components/         ← reusable pieces of screen
│       └── lib/                ← front-end helpers
│
├── docker/               ← config for the traffic director (nginx)
├── scripts/              ← startup and setup scripts
└── docs/                 ← this file, and deployment notes
```

**163 files, about 23,600 lines.** You do not need to know all of them. You need
to know the shape, and about twenty files properly. This document tells you which
twenty.

## 3.2 Why a "monorepo"

The front end and back end are two separate programs, but they live in one
repository — that's called a **monorepo**. `package.json` at the root ties them
together as "workspaces."

The benefit: one `git clone`, one `npm install`, and shared types can't drift out
of sync between the two halves.

## 3.3 The naming pattern — learn this and the whole repo opens up

Every feature in `apps/api/src/modules/` follows the same three-file pattern:

| File | Job | The rule |
|---|---|---|
| `routes.ts` | Which URLs exist, and checking the request is well-formed | Knows about HTTP. Contains no business rules. |
| `service.ts` | The actual thinking and the database work | Knows nothing about HTTP. Just logic. |
| `schemas.ts` | The shape of acceptable input | Pure description |

So `modules/shares/routes.ts` says "there is a `POST /api/shares`", and
`modules/shares/service.ts` contains what creating a share actually *does*.

**Why split them?** Because the rules become testable and reusable without
pretending to be a web request. The seed script creates share links by calling
the same `service.ts` function the web route calls — so seeded data is data the
app could really have produced.

If an interviewer asks "how is the code organised?", this is the answer.

## 3.4 Every directory, one line each

**Back end — `apps/api/src/`**

| Path | What lives there |
|---|---|
| `server.ts` | Starts everything; opens the port |
| `app.ts` | Bolts the middleware and routes together |
| `config/env.ts` | Reads and validates settings; refuses to start if they're wrong |
| `db/client.ts` | The database connection pool |
| `db/types.ts` | TypeScript description of every table |
| `db/migrations/` | Six `.sql` files that build the database, in order |
| `db/migrate.ts` | Runs those migrations safely |
| `db/seed.ts` | Creates the demo account and its contents |
| `middleware/auth.ts` | Works out who is asking |
| `middleware/csrf.ts` | Blocks a specific forgery attack |
| `middleware/rate-limit.ts` | Stops one caller flooding the service |
| `middleware/errors.ts` | Turns any failure into a clean JSON reply |
| `modules/auth/` | Register, log in, log out, refresh session |
| `modules/files/` | The heart: upload, list, rename, move, publish, download, delete |
| `modules/folders/` | Folder tree |
| `modules/uploads/` | Resumable chunked uploads |
| `modules/shares/` | Public share links |
| `modules/requests/` | Inbound "send me a file" links |
| `modules/collaborators/` | Folder sharing with people |
| `modules/insights/` | Storage analytics |
| `modules/activity/` | The audit trail |
| `storage/` | Writing bytes to disk or to S3 |
| `lib/` | Small helpers: hashing, MIME sniffing, errors, byte formatting |

**Front end — `apps/web/`**

| Path | What lives there |
|---|---|
| `app/page.tsx` | The public landing page |
| `app/(auth)/login/` | Sign-in screen |
| `app/(auth)/register/` | Sign-up screen |
| `app/vault/` | The drive itself, and its sub-pages |
| `app/f/[slug]/` | The public page a share link opens |
| `app/u/[slug]/` | The page an upload-request link opens |
| `app/layout.tsx` | The wrapper every page sits inside |
| `app/globals.css` | All the styling and the colour system |
| `components/shell/` | Sidebar, top bar, folder tree, command palette |
| `components/files/` | File rows, cards, preview, share sheet, dialogs |
| `components/upload/` | The transfer dock with progress bars |
| `components/ui/` | Generic buttons, modals, switches, icons |
| `lib/api.ts` | The one place the front end talks to the back end |
| `lib/upload-manager.ts` | Drives chunked uploads in the browser |
| `lib/sha256.ts` | Fingerprints a file in the browser |
| `lib/vault-context.tsx` | Holds the drive's state in memory |

---

# Part 4 · The back end, file by file

## 4.1 `apps/api/src/server.ts` — the on switch

**61 lines. The first thing that runs.** Its whole job is: check the world is
ready, start listening, and shut down cleanly.

### Block 1 — refuse to start if the database is unreachable

```ts
async function main(): Promise<void> {
  await assertDatabaseReachable().catch((err) => {
    logger.fatal({ err }, `cannot reach postgres at ${env.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
    process.exit(1);
  });
  await initStorage();
```

**What it does:** tries the database. If it can't connect, it prints why and
stops immediately.

**Why that's the right behaviour:** the alternative is starting anyway and
failing on every single request with a confusing error. Failing at boot is loud
and obvious — you see it in the deploy log instead of discovering it from users.
This is called **failing fast**.

**Notice `.replace(/:[^:@]+@/, ':***@')`.** The database URL contains the
password. That snippet replaces it with `***` before logging. Without it, the
password would be printed into the log files of the hosting company.

> **Interview answer if asked "what does server.ts do?":** "It's the entry
> point. It verifies Postgres and the storage backend are reachable, starts the
> HTTP listener, starts a background maintenance loop, and installs signal
> handlers for graceful shutdown. It exits rather than serving in a broken state."

### Block 2 — timeouts tuned for big uploads

```ts
server.requestTimeout = 0;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 61_000;
```

**What it does:** turns off the limit on how long a single request may take.

**Why:** Node's default cuts a request off after a while. A 500 MB upload on slow
wifi legitimately takes many minutes. With the default, big uploads would fail
for no visible reason. `requestTimeout = 0` means "no limit."

The other two matter for a subtle reason: `keepAliveTimeout` is 61 s and
`headersTimeout` is 65 s — headers must be *longer*, or a connection can be
closed at exactly the moment a new request arrives on it, producing random
errors under load.

### Block 3 — graceful shutdown

```ts
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  const timer = setTimeout(() => {
    logger.warn('graceful shutdown timed out — exiting anyway');
    process.exit(1);
  }, 15_000);
  server.close(() => { ... process.exit(0); });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
```

**What it does:** when the hosting company says "please stop" (a `SIGTERM`
signal), stop accepting *new* requests but let the ones in progress finish. If
they take more than 15 seconds, give up and exit anyway.

**Why:** without this, a deploy kills the process mid-request and someone's
upload dies. With it, in-flight work completes. The 15-second backstop stops one
stuck request from blocking the deploy forever.

> **Plain version:** last orders. You stop letting new customers in, you let the
> people inside finish their meal, but you don't wait all night for one slow
> table.

---

## 4.2 `apps/api/src/app.ts` — the assembly line

**143 lines.** This builds the back end by stacking **middleware**.

**Middleware** is the single most important back-end concept to understand. It's
a chain of checkpoints. Every request passes through each one in order. Any
checkpoint can let it through, change it, or stop it dead.

> **Plain version:** airport security. Show your ticket, put your bag through
> the scanner, walk through the metal detector, then you reach the gate. Each
> station can wave you on or pull you aside. The gate is your actual route.

The order in `app.ts`, and what each does:

| Order | Middleware | Job |
|---|---|---|
| 1 | `trust proxy` | Work out the real visitor's address |
| 2 | `helmet` | Set protective response headers |
| 3 | `cors` | Decide which websites may call this API |
| 4 | `requestContext` | Give every request a unique id for the logs |
| 5 | `httpLogger` | Record the request |
| 6 | `cookieParser` | Read cookies into a usable object |
| 7 | `issueCsrfCookie` | Hand out the anti-forgery token |
| 8 | `rateLimit` | Refuse floods |
| 9 | `csrfGuard` | Block cross-site forgeries |
| 10 | *the routes* | Actually do the thing |
| 11 | `errorHandler` | Turn any failure into clean JSON |

### Block 1 — the proxy hop count

```ts
// Only honour X-Forwarded-* when we are actually behind a proxy, otherwise a
// client could spoof its own IP and defeat every rate limit. The value is the
// *number* of proxies rather than a yes/no, because one hop too few attributes
// every request to the nearest load balancer — whose address rotates, so the
// per-IP limits quietly stop limiting anybody.
app.set('trust proxy', env.TRUST_PROXY);
```

**The problem it solves.** Requests don't come straight to us. They pass through
Cloudflare, then Render's load balancer, then nginx inside our container. By the
time Express sees a request, the "who sent this" field says *nginx*, not the
visitor.

The real visitor's address is carried in a header called `X-Forwarded-For`, which
looks like a list: `visitor, cloudflare, load-balancer`. `TRUST_PROXY` says how
many entries from the end to skip.

**This is a live example worth telling in the interview.** It was set to `1`,
which was one too few. The audit log recorded `10.24.83.130`, `10.25.191.75`,
`10.28.130.129` — Render's internal addresses, *a different one every request*.
So the rate limiter was counting each request against a different bucket, which
means it wasn't limiting anyone, while looking perfectly healthy. Changing it to
`2` fixed it, verified by checking a share receipt showed a real public address.

**And why not just "trust everything"?** Because then the *first* entry in the
list is used — and the visitor writes that themselves. Anyone could pick their
own rate-limit bucket. There is a test pinning exactly this
(`tests/trust-proxy.test.ts`).

### Block 2 — CORS

```ts
cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const allowed = [env.WEB_ORIGIN, ...(isProd ? [] : ['http://localhost:3000', 'http://127.0.0.1:3000'])];
    return allowed.includes(origin) ? cb(null, true) : cb(new AppError('forbidden', 'Origin not allowed.'));
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
```

**CORS** = Cross-Origin Resource Sharing. Browsers refuse to let website A read
data from website B unless B says it's allowed. This block is B saying who's
allowed.

`credentials: true` means "cookies may be sent." The allow-list is deliberately
narrow: only our own front end, plus localhost while developing.

**A real bug lived here.** `PUT` was missing from `methods`. Chunked uploads use
`PUT`. So every single chunk failed a preflight check and large uploads were
impossible. One missing word in a list.

### Block 3 — the rate-limit exemption

```ts
export const isChunkUpload = (req: Pick<Request, 'method' | 'path'>): boolean =>
  req.method === 'PUT' && /\/chunks\/\d+$/.test(req.path);
```

**What it does:** identifies "this request is one chunk of a big upload" and
exempts it from the global rate limit.

**Why:** a 200 MB upload is roughly 400 separate `PUT` requests. Against a limit
of 1,200 requests per minute, three concurrent uploads would lock the user out
of their own account. The chunk endpoints have their own protection (you must
already own a valid session), so they don't need the global counter.

---

## 4.3 `apps/api/src/config/env.ts` — settings, checked

**157 lines.** Reads configuration from the environment and *validates it*.

**Environment variables** are settings passed in from outside the code —
database address, secret keys, storage credentials. They're outside the code so
the same code can run on your laptop and in production with different values,
and so secrets never get committed.

### Block 1 — declaring what's acceptable

```ts
DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
ACCESS_TOKEN_SECRET: z.string().min(32, 'ACCESS_TOKEN_SECRET must be >= 32 chars'),
STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
MAX_UPLOAD_BYTES: bytes(512 * 1024 * 1024),
```

This uses a library called **Zod** to describe the *shape* of valid settings.
`z.enum(['local','s3'])` means STORAGE_DRIVER must be one of exactly those two
words. A typo like `STORAGE_DRIVER=S3` is rejected at boot with a message naming
the variable — instead of silently falling back to local disk and losing every
uploaded file on the next deploy.

### Block 2 — refusing to run insecurely

```ts
if (v.NODE_ENV === 'production') {
  if (v.ACCESS_TOKEN_SECRET.includes('change-me')) {
    ctx.addIssue({ ..., message: 'refusing to boot production with the sample secret' });
  }
}
```

**What it does:** if this is production and the secret key is still the example
value from `.env.example`, the app refuses to start.

**Why:** the example secrets are published in the repository. Anyone could forge
a session with them. The most likely way this goes wrong is someone deploying
without setting them — so the code makes that impossible rather than
inadvisable. This is a good thing to point at when asked about security thinking.

### Block 3 — inferring the public address

```ts
function inferWebOrigin(): string | undefined {
  const env = process.env;
  if (env.WEB_ORIGIN) return env.WEB_ORIGIN;
  if (env.RENDER_EXTERNAL_URL) return env.RENDER_EXTERNAL_URL;
  if (env.KOYEB_PUBLIC_DOMAIN) return `https://${env.KOYEB_PUBLIC_DOMAIN}`;
  ...
}
```

**What it does:** works out its own public web address by checking the variables
different hosting companies set automatically.

**Why:** `WEB_ORIGIN` controls CORS and the links inside share pages. Getting it
wrong produces an app that boots perfectly and then rejects every request with
"Origin not allowed" — the most common and most confusing deployment failure.
This removes the chance to get it wrong.

---

## 4.4 `apps/api/src/db/client.ts` — the connection pool

**71 lines.** Opens the database connection.

```ts
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: isTest ? 16 : env.DATABASE_POOL_MAX,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  application_name: 'basalt-api',
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ...(env.DATABASE_STATEMENT_TIMEOUT > 0 ? { statement_timeout: env.DATABASE_STATEMENT_TIMEOUT } : {}),
});
```

**A "pool"** is a set of reusable open connections. Opening a database connection
is slow, so you open a few and share them.

**`max`** is how many. The comment in the file explains the trap:

> node-postgres queues an acquisition *indefinitely* when the pool is full, so a
> pool that is too small does not degrade, it hangs.

That's a real distinction worth repeating in an interview: an undersized pool
doesn't get *slower*, it stops responding entirely, because requests wait forever
for a free connection. This bit during testing — the pool was 4, and background
work (audit rows, text extraction) needed connections too, so the suite hung
rather than failed.

**`statement_timeout`** is the backstop: any single query taking longer than 30
seconds is killed. Without it, one query stuck waiting on a lock holds a request
open forever.

### One line worth understanding

```ts
types.setTypeParser(types.builtins.INT8, (v) => v);
```

`INT8` is a big whole number — used for file sizes in bytes. By default the
driver converts it to a JavaScript number, which silently loses precision above
about 9 quadrillion. This says "leave it as text, I'll convert deliberately."
For a system whose job is counting bytes exactly, that matters.

### And the error handler

```ts
pool.on('error', (err) => logger.error({ err }, 'idle postgres client errored'));
```

Cloud databases close idle connections. Without this line, that closure becomes
an unhandled error that **crashes the whole process**. One line, and the app
survives its database going quiet.

---

## 4.5 `apps/api/src/db/migrations/` — how the database gets built

Six `.sql` files, run in order. Each one is a step that changes the database's
shape. They are **forward-only** — there's no "undo" script.

| File | What it adds |
|---|---|
| `001_init.sql` | users, sessions, folders, files, share_links, events |
| `002_content_addressing.sql` | `blobs` and `file_versions` — the de-duplication core |
| `003_resumable_uploads_and_requests.sql` | `upload_sessions`, `file_requests` |
| `004_content_search.sql` | `content_text` + the search index |
| `005_collaborators_and_derivatives.sql` | `folder_collaborators` |
| `006_session_actor.sql` | who drove an upload, when it wasn't the owner |

**Why write SQL by hand instead of letting a tool generate it?** Because the
schema is the most permanent thing in the project — a mistake here is expensive
to fix once real data exists. Hand-written files are reviewable. A generated
migration is not.

### The migration runner's clever bit

`db/migrate.ts`:

```ts
await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
```

**What it does:** takes a lock so only one copy of the app can run migrations at
a time.

**Why:** on a redeploy, two containers can briefly be alive together. Both would
try to migrate. Without the lock, both run the same `CREATE TABLE` and one
crashes — or worse, they interleave and half-apply. The lock makes the second one
wait, then see there's nothing to do.

**This is also why the deployment uses Neon's *direct* connection and not its
pooled one.** The pooled endpoint can route two consecutive commands to two
different backends — so the lock would be taken on one and released against
another. It would silently protect nothing. That's a genuinely good detail to
mention.

### A trigger — the database doing work by itself

From `005`:

```sql
CREATE OR REPLACE FUNCTION resolve_pending_invitations() RETURNS trigger AS $$
BEGIN
  UPDATE folder_collaborators SET user_id = NEW.id
   WHERE email = NEW.email AND user_id IS NULL AND revoked_at IS NULL;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER users_resolve_invitations AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION resolve_pending_invitations();
```

**What it does:** you can invite `sam@example.com` to a folder before Sam has an
account. The invitation sits there with no user attached. The moment Sam
registers, this **trigger** fires automatically and attaches the invitation.

**A trigger** is a rule stored *in the database* that runs when data changes,
without the application asking.

**Why in the database rather than in the sign-up code?** Because then it cannot
be forgotten. Any route that creates a user gets it. If it lived in the
registration function, a second way of creating users — the seed script, an
admin tool — would silently skip it.

> **Plain version:** a letter arrives for someone who hasn't moved in yet. The
> building keeps it by the door, and the moment they collect their keys it's
> handed over. Nobody has to remember.

---

## 4.6 `apps/api/src/middleware/auth.ts` — who is asking?

**101 lines.** Runs before any protected route and works out who you are.

```ts
async function resolve(req: Request): Promise<Request['auth'] | null> {
  const token = extractToken(req);
  if (!token) return null;

  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select([...])
    .where('sessions.id', '=', claims.sid)
    .where('sessions.user_id', '=', claims.sub)
    .executeTakeFirst();

  if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) return null;
```

Three steps: find the token → check the signature → **check the session row still
exists and is valid.**

### The design decision an interviewer will probe

The comment above it says it directly:

> The JWT alone is not enough: it carries a session id, and the session row is
> checked on every request. That is one indexed lookup in exchange for
> revocation that takes effect immediately — sign-out, "log out everywhere" and
> stolen-token detection all become real instead of "real in 15 minutes".

Here's the trade. A **JWT** is a signed ticket. Its selling point is that you can
verify it with maths alone — no database needed, so it's fast. Its weakness is
that you *cannot cancel it*. Once issued, it's valid until it expires.

So if a token is stolen, or a user hits "sign out", a pure-JWT system leaves the
token working until expiry — up to 15 minutes here.

This design adds one database lookup per request and gets **immediate**
revocation. Signing out actually signs you out.

> **If asked "why not stateless JWT?"** — "Because revocation is a real
> requirement and pure JWT can't do it. One indexed lookup per request is a
> cheap price for sign-out that works instantly."

---

## 4.7 `apps/api/src/middleware/csrf.ts` — blocking a specific attack

**80 lines.** Guards against **CSRF** — Cross-Site Request Forgery.

### The attack, plainly

Cookies are sent automatically. That's the point of them — you don't re-log-in
on every page.

But it means: if you're signed into Basalt and you visit `evil.com`, and that
page secretly submits a form to `basalt.../api/files/123` with `DELETE`, your
browser **attaches your cookies**. The request looks legitimate. Your file is
gone, and you never clicked anything.

> **Plain version:** someone tricks you into signing a blank sheet of paper by
> hiding it under another form. Your signature is real. That's the danger.

### Defence 1 — check where the request came from

```ts
const origin = req.get('origin');
if (origin) {
  if (!allowedOrigins.has(origin)) {
    return next(new AppError('csrf_failed', 'Request blocked: unrecognised origin.'));
  }
}
```

Browsers attach an `Origin` header saying which site the request came from, and
**a web page cannot lie about it** — the browser sets it, not the page. If it
isn't our own site, refuse.

### Defence 2 — the double-submit cookie

```ts
/**
 *  2. Double submit — the `basalt_csrf` cookie (readable by our JS, not
 *     httpOnly) must match the `X-CSRF-Token` header. A cross-site attacker can
 *     make the browser *send* our cookies but cannot read them to echo one back.
 */
```

This is the clever part, and worth understanding properly because it sounds
circular until it clicks.

There's a second cookie holding a random value. Our front end **reads** it and
copies it into a header on every write request. The server checks cookie and
header match.

Why does that help, if the attacker's request carries our cookies anyway? Because
of the asymmetry: `evil.com` can cause your browser to **send** Basalt's cookies,
but it cannot **read** them — the browser won't let one site read another's
cookies. So it can't put the matching value in the header. Cookie present,
header absent or wrong, request refused.

### Two real bugs from this file

1. The guard blocked the very first login, because a brand-new visitor had no
   CSRF cookie yet. Fixed by handing the cookie out on any safe (`GET`) request,
   plus a dedicated `GET /api/auth/csrf`.
2. A failed session refresh cleared the CSRF cookie, so login could *never*
   succeed afterwards. Fixed by not clearing it on sign-out.

Both are worth mentioning if asked "what was hard?" — they're the kind of bug
that only appears in the real browser flow, not in unit tests.

---

## 4.8 `apps/api/src/lib/crypto.ts` — passwords and tokens

**61 lines.** Small file, dense with security decisions.

### Block 1 — how passwords are stored

```ts
const ARGON = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (plain: string): Promise<string> => argonHash(plain, ARGON);
```

Passwords are never stored. A **hash** is stored — a one-way scramble. You can
check a guess by scrambling it and comparing, but you cannot reverse it.

**Argon2id** is the current recommended algorithm. `memoryCost: 19_456` means
each check needs ~19 MB of memory. That sounds odd as a *feature* — it is one.
An attacker cracking stolen hashes wants to try billions of guesses on a graphics
card. Requiring 19 MB per attempt limits how many can run at once. The numbers
come from the OWASP Password Storage Cheat Sheet, which is the standard to cite.

> **Plain version:** you don't keep the key, you keep a lock the key fits. And
> the lock is deliberately heavy, so a thief can't test a million keys a second.

### Block 2 — the timing attack defence, which is subtle and impressive

```ts
/**
 * Burn roughly one password-verification worth of CPU. Called when an e-mail
 * does not exist so that "unknown account" and "wrong password" take the same
 * wall-clock time and cannot be distinguished by an enumeration attack.
 */
const DUMMY_HASH = await argonHash('basalt-timing-equaliser', ARGON);
export const equaliseTiming = () => argonVerify(DUMMY_HASH, randomBytes(16).toString('hex'), ARGON).catch(() => false);
```

**The attack.** Login always says "email or password is incorrect", never which.
Good. But consider the *timing*: if the email doesn't exist, the code returns
straight away. If it does exist, the code spends ~50 ms hashing the password
before failing.

So an attacker times the responses. Fast = no such account. Slow = account
exists, keep attacking it. They can now harvest a list of real customers.

**The fix:** when the email doesn't exist, deliberately waste the same amount of
CPU on a fake hash. Both answers now take the same time and reveal nothing.

This is an excellent thing to bring up unprompted. It shows thinking about
attacks that don't involve breaking anything.

### Block 3 — refresh tokens are stored as digests

```ts
/** Peppered SHA-256 — refresh tokens are stored as digests, never in the clear. */
export const digestToken = (token: string): Buffer =>
  createHash('sha256').update(`${token}${env.REFRESH_TOKEN_PEPPER}`).digest();
```

The long-lived token in your cookie isn't stored in the database either — a hash
of it is, mixed with a secret ("pepper") held only in the environment.

**Why:** if someone steals a copy of the database, they still cannot log in as
anybody. The stored values aren't usable tokens, and without the pepper they
can't even be brute-forced offline.

---

## 4.9 `apps/api/src/lib/mime.ts` — not trusting the browser

**194 lines.** Works out what a file *actually is*.

### The problem

When your browser uploads a file it says "this is a PNG image." That claim is
just text in the request. Anyone can change it. So can a malicious page.

If the server believed it, someone could upload a file that claims to be an
image but is actually a web page containing an attack script — and if the server
later served it back saying "this is an image, render it", the browser would
instead run the script, in *your* account's context.

### The fix — read the actual bytes

```ts
export async function resolveType(
  head: Buffer,
  filename: string,
  declared: string | null,
): Promise<ResolvedType> {
  const ext = extensionOf(filename);
  const fromExt = mimeForExtension(ext);
  const sniff = head.length > 0 ? await fileTypeFromBuffer(head).catch(() => undefined) : undefined;
  const sniffed = sniff?.mime ?? null;
```

Most file formats begin with a distinctive pattern called **magic bytes**. A PNG
starts with the bytes `89 50 4E 47`. A PDF starts with `%PDF`. So the code looks
at the first chunk of the actual file and identifies it from that.

Three sources of truth, in priority order: **what the bytes say** (`sniffed`),
then **what the extension says** (`fromExt`), then — last and least — **what the
browser claimed** (`declared`).

> **Plain version:** don't read the label on the tin. Open it and look inside.

### Detecting a lie

```ts
let mismatch = false;
if (sniffed && fromExt && sniffed !== fromExt) {
  const pair = `${sniffed}|${fromExt}`;
  mismatch = !BENIGN_SNIFF_PAIRS.has(pair) && family(sniffed) !== family(fromExt);
}
```

If the bytes and the extension disagree, that's a `mismatch`. Note it isn't
naive: some disagreements are innocent (a `.docx` really is a zip file
underneath), so there's an allow-list of `BENIGN_SNIFF_PAIRS` and a check on
whether they're at least the same *family*.

### What a mismatch causes

```ts
/** Inline rendering is opt-in per type, and never for a mismatched upload. */
export function dispositionFor(mimeType: string, mismatch = false): 'inline' | 'attachment' {
  if (mismatch) return 'attachment';
  if (NEVER_INLINE_MIME.has(mimeType)) return 'attachment';
  if (INLINE_SAFE_EXACT.has(mimeType)) return 'inline';
  ...
  return 'attachment';
}
```

`inline` means "browser, display this in the page." `attachment` means "browser,
download this to disk, don't run it."

Two things to notice, both deliberate:

1. **A mismatched file is always a download.** Never displayed.
2. **The final line is `return 'attachment'`.** Anything not explicitly on the
   safe list gets downloaded. That's called a **default-deny** or **allow-list**
   design: unknown things are treated as dangerous, rather than the reverse.

> **If asked about security:** "Uploads are identified by magic bytes, not the
> declared content type. Inline rendering is allow-listed, so anything unknown
> or mismatched is forced to download. That kills stored-XSS through uploads."

---

## 4.10 `apps/api/src/storage/` — swapping disk for the cloud

Five files. This is the cleanest bit of design in the project and a great answer
to "tell me about an architectural decision."

### The interface — `storage/driver.ts`

```ts
export interface StorageDriver {
  readonly name: string;
  put(key: string, source: BlobSource): Promise<void>;
  read(key: string, range?: ByteRange): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  signedUrl?(key: string, opts: {...}): Promise<string | null>;
}
```

An **interface** is a contract: "anything that calls itself a StorageDriver must
have these five functions." It says *what*, never *how*.

There are two implementations:

- `storage/local.ts` — writes files to a folder on disk
- `storage/s3.ts` — writes to Amazon S3, Cloudflare R2, Backblaze B2, MinIO

The rest of the application **only ever talks to the interface**. It has no idea
which one is live. Switching is one environment variable, `STORAGE_DRIVER`.

> **Plain version:** a plug socket. The kettle doesn't know or care whether the
> electricity comes from a wind turbine or a coal station. It just needs the
> socket shape to be the same.

This pattern has a name worth knowing: **ports and adapters**, or **dependency
inversion**. The high-level code depends on an abstraction; the details plug into
it.

### The `signedUrl?` with a question mark

That `?` means *optional*. This is the interesting part.

When storage is S3/R2, the object store can serve the file to the visitor
directly. So instead of the file's bytes passing *through* our server, the API
returns a temporary secret URL and says "go fetch it from there." The bytes never
touch our server at all — which matters enormously on a small instance, since a
500 MB download would otherwise occupy it entirely.

Local disk has no such ability, so it returns `null` and the API streams the file
itself. Same interface, two behaviours, and the code that calls it just checks:

```ts
if (!range && storage.signedUrl) { ... res.redirect(302, url); return; }
```

### Four real bugs found in `s3.ts` — a strong story

The S3 driver had **never actually been run** until it was tested against a real
object store. Doing that found four bugs, each of which would have broken the
first deployment:

1. **`ACL: 'private'` sent on every upload.** Cloudflare R2 and Backblaze B2
   *reject* that header outright, as does any AWS bucket created since 2023.
   Every upload would have failed. Now opt-in:
   ```ts
   ...(this.acl ? { ACL: this.acl as never } : {}),
   ...(this.sse ? { ServerSideEncryption: this.sse as never } : {}),
   ```
2. **Server-side encryption header**, same story — R2 and B2 encrypt anyway and
   refuse to be told to.
3. Migrations weren't copied into the built image, so the deploy died on step one.
4. The startup script used a shell feature Alpine Linux doesn't have, so the
   container would have restart-looped forever.

> **If asked "what would you do differently?"** — "I'd have tested the S3 driver
> against a real object store much earlier. It was fully typed, reviewed and
> completely broken, because types can't tell you a remote service rejects a
> header. Now the whole suite can run against MinIO."

---

## 4.11 `apps/api/src/modules/files/ingest.ts` — the single door

**614 lines. The most important file in the back end.** Every upload, no matter
how it arrived, goes through here.

There are four different ways a file can enter Basalt:

1. A normal drag-and-drop upload
2. The final step of a big resumable upload
3. Somebody sending you a file through a request link
4. An "instant" upload where you already own those exact bytes

The comment at the top explains why they all funnel through one place:

```ts
/**
 * The single door into the store.
 *
 * Four paths lead here — a plain multipart upload, the final step of a resumable
 * session, a submission through a file request, and an instant upload of content
 * the account already holds — and all of them need identical treatment: the same
 * validation, the same content sniffing, the same quota arithmetic, the same
 * audit trail. Writing that four times is how one of them ends up subtly weaker
 * than the others.
 */
```

**That last sentence is the whole argument.** If you write the security checks
four times, three of them will be right and one will quietly not be — and it'll
be the one nobody demos.

### Block 1 — checking before accepting

```ts
export async function assertAcceptable(user: UserRow, intent: UploadIntent): Promise<void> {
  ...
  const quota = Number(user.quota_bytes);
  const used = Number(user.storage_used_bytes);
  if (used + intent.size > quota) {
    throw new AppError('quota_exceeded', `Not enough space: ...`);
  }

  // Rejected here rather than after the bytes have been transferred, so a
  // 100 MB upload against a full service fails on the opening request.
  await assertGlobalHeadroom(intent.size);
}
```

Note the comment. Checking *before* the transfer means a doomed 100 MB upload
fails in a fraction of a second, instead of after five minutes of uploading.

### Block 2 — the advisory/binding distinction

The quota is checked **twice**, and the file says why:

```ts
// An advisory check only: the binding one happens under a row lock at commit,
// because a 40-minute upload can be overtaken by another one.
```

Then at the end, inside a transaction:

```ts
return db.transaction().execute(async (trx) => {
  const owner = await trx
    .selectFrom('users')
    .select(['quota_bytes', 'storage_used_bytes'])
    .where('id', '=', user.id)
    .forUpdate()
    .executeTakeFirstOrThrow();
```

**`forUpdate()`** is the key. It's SQL for "lock this row until I'm done." So two
uploads finishing at the same moment cannot both read "900 MB used", both decide
200 MB fits, and both commit — leaving 1.1 GB in a 1 GB quota. This is a **race
condition**, and the row lock is how you prevent it.

> **Plain version:** two people at a cash machine on one account. Both see £100,
> both take £80. The lock makes the second one wait until the first has
> finished, so they see £20 and are refused.

**A transaction** means "all of these changes happen together or none do." If
anything fails halfway, the database rewinds. So you never get a file row with no
quota charged, or quota charged for a file that didn't save.

### Block 3 — content addressing, the de-duplication engine

```ts
/** Does this account already hold these exact bytes? */
export async function findOwnedBlob(ownerId: string, checksum: Buffer): Promise<{ id: string; size: number } | null> {
  const row = await db
    .selectFrom('blobs')
    .select(['id', 'size_bytes'])
    .where('owner_id', '=', ownerId)
    .where('checksum_sha256', '=', checksum)
    .executeTakeFirst();
  return row ? { id: row.id, size: Number(row.size_bytes) } : null;
}
```

Every file's contents get a **SHA-256 checksum** — a 64-character fingerprint
computed from the bytes. Same bytes always produce the same fingerprint;
different bytes essentially never collide.

So the `blobs` table is keyed by fingerprint. Upload the same 100 MB video twice
and the second one finds an existing blob, stores nothing, and charges no quota.

**The critical security detail — notice `.where('owner_id', '=', ownerId)`.**

The lookup is scoped **per account**. It would be more efficient to
de-duplicate globally across all users, but that creates an **existence oracle**:
you could test whether *any* user anywhere has a particular file, by uploading it
and seeing whether it completed instantly. For a confidential document, that
leaks real information. Per-owner de-duplication gives up some savings to close
that hole.

> **This is one of the best things to raise unprompted.** It shows you can see
> the security consequence of a performance optimisation.

### Block 4 — the ceiling that protects the bill

```ts
export async function assertGlobalHeadroom(size: number, executor: Executor = db): Promise<void> {
  const limit = env.GLOBAL_STORAGE_LIMIT_BYTES;
  if (limit <= 0) return;

  const total = await storedBytes(executor);
  if (total + size <= limit) return;

  throw capacityReached(
    `This service has reached its ${formatBytes(limit)} storage ceiling and is not accepting new uploads.`,
    { limitBytes: limit, storedBytes: total, requiredBytes: size },
  );
}
```

**Why this exists separately from the per-user quota.** A per-account quota
cannot bound a bill, because anyone can register again and get another one. Ten
accounts at 1 GB is 10 GB. This ceiling is measured across *every* blob in the
deployment, with no owner filter, so a brand-new account with an untouched quota
is still refused when the service is full.

There's a test for exactly that case — a fresh sign-up being refused — because
that's the scenario the feature exists for.

---

## 4.12 `apps/api/src/modules/uploads/` — how a 500 MB file gets in

This is the feature most worth understanding deeply, because it's the assignment's
hardest requirement and the best thing to demo.

### Why a normal upload doesn't work

A normal upload is one long request. If the connection drops at 90%, everything
is lost and you start over. On a phone, or hotel wifi, a 500 MB upload may never
succeed.

### The design — chunks

The file is cut into pieces (512 KB or larger, chosen by size). Each piece is
uploaded as its own small request. The server records which pieces have arrived.

The three-step conversation:

```
POST /api/uploads              → "I want to send file X, 500 MB, fingerprint abc…"
                               ← "Session 66c5…, 240 chunks of 512 KB. Go."
PUT  /api/uploads/66c5…/chunks/0   → [bytes]  ← ok
PUT  /api/uploads/66c5…/chunks/1   → [bytes]  ← ok
     … 238 more …
POST /api/uploads/66c5…/complete   → "done"   ← "here is your file"
```

### The part that makes resuming work

```ts
uploadsRouter.get(
  '/:id',
  route(async (req, res) => {
    const { id } = parseParams(sessionParams, req);
    noStore(res);
    res.json({ session: await getSession(id, req.auth!.user.id) });
  }),
);
```

Ask about a session and the server tells you exactly what it's missing. On the
live deployment that response looked like:

```json
{
  "id": "66c557f0-6a39-4211-aa6b-fe3683293b10",
  "filename": "live-verification-120MiB.bin",
  "sizeBytes": 125829120,
  "chunkSize": 524288,
  "chunkCount": 240,
  "receivedCount": 193,
  "missing": [193, 194, 195, ..., 239]
}
```

So a browser that lost its connection — or a page that was reloaded, or a
completely fresh client — asks "what do you have?", gets a list, and sends only
that. **This was verified live:** the connection genuinely dropped at chunk 193
of 240, and resuming sent only the remaining 47 chunks. The finished file's
SHA-256 matched the original exactly.

### How the server remembers, without a file per chunk

Two ideas working together:

**A sparse spool file.** One temporary file the size of the whole upload, with
each chunk written at its correct offset — so chunks can arrive in any order or
be retried, and each simply overwrites its own slot. "Sparse" means the operating
system doesn't allocate the empty parts yet.

**A bitmap.** A row in `upload_sessions` holds one *bit* per chunk: 1 = arrived,
0 = not. 240 chunks is 30 bytes. Postgres has `set_bit`/`get_bit` functions for
exactly this. That's how `missing` is computed.

> **Plain version:** a jigsaw box with numbered slots, and a checklist of which
> numbers you've placed. Pieces can arrive in any order. If you stop and come
> back, the checklist tells you what's still missing.

### Streaming, not buffering — a detail interviewers like

```ts
/**
 * Accept one chunk.
 *
 * The body is consumed as a stream rather than parsed: an 8 MB chunk should cost
 * 8 MB of network and a few kilobytes of heap, not a buffer per concurrent
 * request. Nothing upstream parses application/octet-stream, so `req` is still
 * a readable stream here.
 */
uploadsRouter.put(
  '/:id/chunks/:index',
```

Reading a chunk fully into memory before writing it would mean 8 MB of RAM per
in-flight chunk. With several concurrent uploads on a 512 MB instance, that's how
you run out of memory. **Streaming** means bytes flow through in small pieces
and are written as they arrive, so memory stays flat regardless of file size.

### Verification at two levels

Each chunk may carry `X-Chunk-Sha256`, its own fingerprint, checked on arrival —
so a corrupted chunk is caught immediately and can be re-sent. Then the whole
assembled file's SHA-256 is compared with what the client declared at the start.
Corruption anywhere is detected, not stored.

### "Instant upload"

Because the client sends the fingerprint *before* transferring anything, the
server can answer:

```ts
if (outcome.kind === 'instant') {
  res.status(201).json({
    instant: true,
    file: outcome.result.file,
    deduped: true,
    ...
  });
  return;
}
```

"I already have those bytes — here's your file, send nothing." A 500 MB upload
that finishes in a quarter of a second.

---

## 4.13 `apps/api/src/modules/collaborators/access.ts` — who may do what

**246 lines.** All the permission reasoning, in one place.

### Roles

| Role | Can do |
|---|---|
| **viewer** | Open and download everything in the folder |
| **contributor** | Also add files, and manage only the ones they added |
| **editor** | Also rename, move and bin anything in the folder |
| **owner** | Everything, including publishing |

### One function makes every decision

```ts
mayTouchFile(...)
```

Owner → allowed everything. `publish` → owner only, always. Editor → any write.
Contributor → only files where `created_by` is them.

**Why one function.** If permission logic is spread across twenty route handlers,
nineteen will be right. The twentieth is your breach. Centralising means there's
exactly one place to read, review, and test.

### Inherited permissions and the recursive query

Folders nest. Sharing "Photography" should share "Photography/RAW" inside it. So
`loadFolderAccess` walks up the folder tree using a **recursive CTE** — a SQL
query that repeats itself, following parent links upward until it finds a grant
or reaches the top.

It's capped at depth 64. **Why a cap:** if data ever became corrupted such that a
folder was its own ancestor, an uncapped recursive query would loop forever and
hang the database. The limit turns a catastrophic hang into a clean error.

### Publishing is owner-only, deliberately

An editor can rename, move and delete, but cannot make a file public. Making
something public is irreversible in the sense that matters — you cannot un-see a
leaked document. So that one action stays with the owner.

That's a considered choice, not an oversight, and it's worth saying so if asked.

---

# Part 5 · The database

## 5.1 The thirteen tables

| Table | Holds | Added in |
|---|---|---|
| `users` | Accounts, password hashes, quota | 001 |
| `sessions` | Active logins, so sign-out works instantly | 001 |
| `folders` | The folder tree | 001 |
| `files` | One row per file *as the user sees it* | 001 |
| `share_links` | Public links, their passwords and expiries | 001 |
| `events` | The audit trail — every action | 001 |
| `blobs` | One row per *distinct set of bytes* | 002 |
| `file_versions` | History: which blob a file pointed at, and when | 002 |
| `upload_sessions` | In-progress resumable uploads | 003 |
| `file_requests` | Inbound "send me a file" links | 003 |
| `request_submissions` | What arrived through those links | 003 |
| `folder_collaborators` | People a folder is shared with | 005 |
| `blob_derivatives` | Space reserved for thumbnails (not yet generated) | 005 |

## 5.2 The most important idea — `files` and `blobs` are different things

This confuses everyone at first, and it's the design decision most worth
understanding.

- A **blob** is a set of bytes. Identified by its SHA-256 fingerprint.
- A **file** is a *name in a folder* that points at a blob.

So if you upload `holiday.jpg` and then upload the identical image again as
`beach.jpg`, you get **two rows in `files` and one row in `blobs`.** Two names,
one set of bytes, stored once, charged once.

```
files                              blobs
┌──────────────┐                   ┌────────────────────────┐
│ holiday.jpg  │──────┐            │ fingerprint: 8a06e4…   │
└──────────────┘      ├───────────▶│ size: 2,400,000        │
┌──────────────┐      │            │ ref_count: 2           │
│ beach.jpg    │──────┘            └────────────────────────┘
└──────────────┘
```

`ref_count: 2` means "two files point at me." When it drops to zero, nothing
needs these bytes and they can be swept from storage.

> **Plain version:** two library catalogue cards for the same book. The library
> only owns one copy. When both cards are thrown away, the book goes back to the
> warehouse.

## 5.3 The `files` table, annotated

```sql
CREATE TABLE files (
  id               uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid            NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  folder_id        uuid            REFERENCES folders(id)         ON DELETE SET NULL,
  name             text            NOT NULL,
  mime_type        text            NOT NULL,
  declared_mime    text,
  kind             text            NOT NULL DEFAULT 'other',
  mime_mismatch    boolean         NOT NULL DEFAULT false,
  size_bytes       bigint          NOT NULL,
  checksum_sha256  bytea           NOT NULL,
  storage_driver   text            NOT NULL,
  storage_key      text            NOT NULL,
  visibility       file_visibility NOT NULL DEFAULT 'private',
  ...
  deleted_at       timestamptz,
  purge_after      timestamptz,
```

Line by line, the interesting ones:

**`id uuid DEFAULT gen_random_uuid()`** — a **UUID** is a long random identifier
like `3a7df115-350c-45d0-90a7-1603e69107df`, instead of 1, 2, 3. Why random?
Because sequential ids can be guessed. With `/api/files/4` you'd try 5, 6, 7 and
enumerate other people's files. With a UUID there is nothing to guess.

**`REFERENCES users(id) ON DELETE CASCADE`** — a **foreign key**. It means
`owner_id` must be a real user, enforced by the database itself, not hoped for by
the code. `ON DELETE CASCADE` means deleting a user automatically deletes their
files — so a deleted account can't leave orphaned rows behind.

**`ON DELETE SET NULL` on `folder_id`** — a different choice, deliberately.
Deleting a folder should *not* delete the files in it; they become loose at the
root instead of vanishing.

**`visibility file_visibility NOT NULL DEFAULT 'private'`** — the assignment's
core requirement, expressed as a database default. A file created by code that
forgot to set visibility is **private**. The safe state is the one you get by
doing nothing.

**`mime_type` vs `declared_mime`** — both are kept. One is what the bytes say,
one is what the browser claimed. Keeping both means a mismatch can be reported
rather than silently resolved.

**`deleted_at` and `purge_after`** — deleting doesn't remove the row, it
timestamps it. That's called a **soft delete**, and it's what makes a 30-day bin
possible.

### The constraints at the bottom are doing real work

```sql
CONSTRAINT files_name_clean   CHECK (name !~ '[/\\\x00]' AND name NOT IN ('.', '..')),
CONSTRAINT files_trash_shape  CHECK ((deleted_at IS NULL) = (purge_after IS NULL))
```

**`files_name_clean`** rejects filenames containing `/`, `\`, or a null byte, and
rejects `.` and `..`. Why: a filename like `../../etc/passwd` is the classic
**path traversal** attack — a way to trick a program into writing outside its
folder. Blocking it *in the database* means no code path anywhere can bypass it.

**`files_trash_shape`** says the two bin columns must both be set or both be
empty. It's impossible to have a file marked deleted with no purge date, or a
purge date on a live file. The database refuses to hold nonsense.

> **This is a good general point to make:** rules live as close to the data as
> possible. Application code can be bypassed by the next developer; a database
> constraint cannot.

## 5.4 The `users` table's counter, and the triggers that keep it honest

```sql
-- Denormalised counter, mutated in the same transaction as every blob change
-- (see files_storage_delta trigger). Reconcilable via SELECT SUM(size_bytes).
storage_used_bytes  bigint      NOT NULL DEFAULT 0,
```

**Denormalised** means "stored even though it could be calculated." Adding up
every blob on every page load would be slow, so the total is kept ready.

The risk with any such counter is that it **drifts** out of step with reality.
Two defences:

1. It's updated by database **triggers** (`blobs_storage_accounting`,
   `file_versions_refcounting`) in the same transaction as the change itself — so
   it cannot be forgotten and cannot be half-applied.
2. The comment records how to check it: `SELECT SUM(size_bytes)`. There's a test
   asserting the counter equals the sum of its parts exactly.

**A real bug here:** the storage breakdown double-counted de-duplicated bytes, so
the numbers didn't add up. Fixed by counting each blob once, and there's now a
test that `used == strata + versions + trash` exactly.

## 5.5 Full-text search — `004_content_search.sql`

Two pieces. First, extracted text is stored in a `content_text` column. Second, a
**generated column**:

```sql
search_vector tsvector GENERATED ALWAYS AS (...) STORED
```

A **`tsvector`** is Postgres's search-optimised form of a document: words
reduced to their stems, with positions, punctuation discarded. `GENERATED ALWAYS
AS ... STORED` means Postgres maintains it automatically whenever the text
changes — the application cannot forget to update the index.

Searching it uses an index rather than reading every row, so it stays fast as the
data grows.

**Filenames are searched differently**, using a `pg_trgm` **trigram** index.
Trigrams are three-letter fragments: "ambience" contains "amb", "mbi", "bie"…
This is what lets `ambien` match `site-ambience.wav`. Full-text search alone
wouldn't — it matches whole words.

So search combines two mechanisms: full-text for contents, trigram for names.

---

# Part 6 · The front end

## 6.1 What Next.js gives you

**React** is a library for building screens out of reusable pieces called
**components**. **Next.js** is a framework around React that adds routing (which
URL shows which screen), server rendering, and a build system.

**The routing rule is folders = URLs:**

| Folder | URL |
|---|---|
| `app/page.tsx` | `/` |
| `app/(auth)/login/page.tsx` | `/login` |
| `app/vault/page.tsx` | `/vault` |
| `app/vault/insights/page.tsx` | `/vault/insights` |
| `app/f/[slug]/page.tsx` | `/f/anything` — the share page |
| `app/u/[slug]/page.tsx` | `/u/anything` — the upload-request page |

`[slug]` in square brackets means "any value here, and tell me what it was."
That's how one file serves every share link.

`(auth)` in round brackets is a **group** — it shares a layout between login and
register without adding `/auth` to the URL.

## 6.2 `apps/web/lib/api.ts` — the one door out

**182 lines.** Every request the front end makes goes through this file.

**Why centralise it?** Because credentials, CSRF tokens, error shapes and the
automatic session refresh are all cross-cutting concerns. Written once here, they
are correct everywhere. Written per-screen, they're correct in most places.

It handles:
- attaching the CSRF header to writes
- sending cookies with every request
- turning error responses into a typed `ApiError` the UI can read fields from
- noticing a 401, silently refreshing the session, and retrying once

That last one is why your session appears never to expire even though the access
token lasts 15 minutes.

## 6.3 `apps/web/lib/sha256.ts` — fingerprinting in the browser

**171 lines. Hand-written SHA-256.**

**Why hand-written, when browsers have `crypto.subtle.digest`?** Because the
built-in one needs the *whole file in memory at once*. For a 2 GB file that's
impossible. This implementation is **incremental**: feed it 512 KB at a time,
keep a small running state, and get the fingerprint at the end. Memory stays
flat no matter the file size.

It was verified against Node's own implementation on seven test vectors,
including the awkward 55, 56 and 64-byte boundaries where the padding rules
change — exactly where a hand-rolled hash gets it wrong.

**Why fingerprint in the browser at all?** So the client can say "here's what I'm
about to send" *before* sending it. That's what enables instant upload and
end-to-end integrity checking.

## 6.4 `apps/web/lib/upload-manager.ts` — the biggest front-end file

**626 lines.** Orchestrates uploads: queues them, splits into chunks, sends
several at once, retries failures with increasing delays, reports progress, and
survives page reloads by asking the server what's missing.

**Why `XMLHttpRequest` instead of the modern `fetch`?** One reason: `fetch`
cannot report **upload** progress. It can tell you about bytes coming down, not
going up. A progress bar for a 500 MB upload is not optional, so the older API is
used for chunk transfer specifically.

That's a genuinely good answer to "why did you use an older API?" — a considered
trade, not ignorance.

## 6.5 `apps/web/lib/vault-context.tsx` — shared state

**616 lines.** Holds the current view of the drive — files, folders, selection,
which dialog is open — in one place, so the sidebar, the file list and the top bar
all agree without passing data through every intermediate component.

React calls this a **context**. Without it you get "prop drilling": passing the
same value down through six layers of components that don't care about it.

## 6.6 `apps/web/app/globals.css` — the design system

**521 lines.** All the styling, and the reason the app looks coherent.

```css
--panel: #101013;
--panel-2: #16161a;
--text: #ececef;
--text-dim: #9a9aa8;
--text-faint: #63636f;
--accent: #ee6c2f;
--accent-ink: #0a0a0b;
--accent-wash: rgba(238, 108, 47, 0.13);
```

These are **CSS custom properties** — named colours defined once. Nothing in the
app writes a raw colour; everything references `var(--accent)`. So dark and light
themes are the same components with a different set of values, and there is no
possibility of two shades of "nearly the same orange."

```css
html {
  font-size: 17.5px;
}
```

The whole type scale is in `rem` units, which are multiples of this root size. So
this single number scales every piece of text in the application proportionally.

### Two real bugs from this file

1. **Tailwind was dropping the colour variables.** Fixed by writing
   `@theme static` instead of `@theme`.
2. **The fonts silently fell back to the system default.** The `--font-sans`
   variable referenced a font defined only on `<body>`, but was used on `<html>`.
   Fixed by moving the font classes to `<html>`. This is the kind of bug that
   looks like nothing is wrong — the site just looks slightly cheaper than
   intended.

---

# Part 7 · Five journeys, end to end

If you understand these five, you understand the system. This is also the best
way to answer "walk me through how X works."

## 7.1 Signing up

```
Browser                          Back end                        Database
   │ POST /api/auth/register        │                                │
   │ {email, password, name}        │                                │
   ├───────────────────────────────▶│                                │
   │                                │ 1. validate shape (Zod)        │
   │                                │ 2. hash password (Argon2id)    │
   │                                ├───────────────────────────────▶│ INSERT user
   │                                │                                │ ⚡ trigger:
   │                                │                                │  attach any
   │                                │                                │  pending
   │                                │                                │  invitations
   │                                │ 3. create session row          │
   │                                │ 4. sign access JWT (15 min)    │
   │                                │ 5. make refresh token (30 day) │
   │◀───────────────────────────────┤ Set-Cookie ×3                  │
   │  201 Created                   │                                │
```

The three cookies: access token, refresh token, CSRF token. The first two are
`httpOnly` — JavaScript cannot read them, so an injected script can't steal them.
The third is deliberately readable, because our own code must copy it into a
header.

## 7.2 Uploading a small file

```
1. Browser reads the file, computes SHA-256 incrementally
2. POST /api/files with the bytes as multipart form data
3. busboy streams the bytes to a temporary spool file on disk
   ├─ counting bytes as they go (refuse if over the limit)
   ├─ hashing as they go
   └─ keeping the first chunk to sniff magic bytes
4. resolveType() decides what the file really is
5. assertAcceptable() checks quota and the global ceiling
6. Is there already a blob with this fingerprint for this owner?
   ├─ YES → reuse it, store nothing, charge nothing
   └─ NO  → hand the spool file to the storage driver
7. TRANSACTION:
   ├─ lock the user's row (FOR UPDATE)
   ├─ re-check quota (the binding check)
   ├─ INSERT blob, INSERT file, INSERT version
   └─ triggers update storage_used_bytes
8. Respond 201 with the file
9. AFTER responding: extract text and index it for search
```

**Step 9 is deliberately after the response.** Reading the file back to extract
its text would make the user wait for something they didn't ask for. So the
upload answers immediately and indexing happens behind it. A test polls for
`searchable: true` rather than reaching inside, which also proves it really
completes.

## 7.3 Uploading a 500 MB file

```
1. Browser fingerprints the file (incrementally, flat memory)
2. POST /api/uploads  {filename, size, checksum}
   └─ server may reply "instant" — already have those bytes, done
3. Server creates a session: sparse spool file + a bitmap of received chunks
4. Browser sends chunks, several at a time:
      PUT /api/uploads/:id/chunks/0 … /239
   ├─ each carries its own SHA-256, checked on arrival
   ├─ written at its own offset in the spool file
   ├─ its bit is set in the bitmap
   └─ a failure is retried with increasing delay
5. If everything dies — connection, tab, laptop:
      GET /api/uploads/:id  →  {receivedCount: 193, missing: [193…239]}
   and only those 47 chunks are sent
6. POST /api/uploads/:id/complete
   ├─ whole-file SHA-256 compared with what was declared
   └─ then the identical path as step 6 onward above
```

## 7.4 Sharing a file publicly

```
1. POST /api/shares {fileId, optional password, expiry, download limit}
2. Server makes a random unguessable slug, e.g. 2c4to9dwM5NL
3. Anyone opens  /f/2c4to9dwM5NL
4. GET /api/s/2c4to9dwM5NL  → metadata (no session needed)
   ├─ password set?      → 401 share_password_required
   ├─ expired?           → gone
   └─ downloads used up? → gone
5. If protected:  POST /api/s/:slug/unlock {password}
   └─ correct → a signed grant token, returned in the JSON body
6. GET /api/s/:slug/content  with  X-Share-Grant: <token>
   ├─ record the receipt (who, when, from where) BEFORE streaming
   └─ 302 to a 120-second presigned URL, or stream directly
```

**Why a grant token in the body, not a cookie?** It works across devices,
survives an incognito window, needs no cookie consent, and can't be sent
accidentally by the browser to somewhere it shouldn't. Wrong password gives 403;
a tampered token gives 401. All verified live.

**Why record the receipt before streaming?** Because a browser that cancels a
download mid-flight would otherwise leave no trace. There was a real bug here —
audit rows were written after the response was flushed, so cancelled downloads
went unrecorded.

## 7.5 Downloading

```
1. GET /api/files/:id/content
2. Who is asking?  (middleware/auth.ts)
3. May they?       (mayTouchFile — owner, collaborator, or a valid share grant)
   └─ no → 404, never 403
4. Record the download in events; increment the counter
5. Is there a Range header?
   ├─ YES → stream the requested bytes from storage ourselves (206)
   └─ NO  → is the driver able to sign a URL?
            ├─ YES → 302 to a 120-second presigned URL
            └─ NO  → stream it ourselves (200)
```

**Step 5 is where the preview bug lived**, and it's a good story.

Clicking a text file showed "Could not read this file", while downloading the
same file worked perfectly. The cause: the preview used JavaScript `fetch()`,
which followed the 302 to R2 — making the read **cross-origin**. R2 has no CORS
policy, so the browser refused to hand the bytes to JavaScript. Downloads and
`<img>` tags aren't subject to that check, which is exactly why it looked like a
text-only fault.

The fix was to have the preview send `Range: bytes=0-200000`. Ranges are served
by the API itself, so the read stays same-origin — and it's honest about intent,
because a preview only ever shows the first screenful anyway. No bucket
configuration needed, which also means anyone self-hosting this doesn't hit the
same wall.

---

# Part 8 · Security, gathered in one place

If the interview has a security section, these are the eleven answers.

| Threat | What it means | The defence here |
|---|---|---|
| **Stolen password database** | Someone gets a copy of `users` | Argon2id at OWASP parameters — hashes are slow and memory-hungry to attack |
| **Account enumeration** | Discovering which emails are registered | Identical message *and identical timing* for unknown email vs wrong password |
| **Session theft via XSS** | A script steals your login | Tokens in `httpOnly` cookies — JavaScript cannot read them |
| **Stolen token stays valid** | Sign-out doesn't really sign out | Session row checked on every request, so revocation is immediate |
| **Refresh token replay** | An old token reused | Refresh tokens rotate; reuse revokes the whole family |
| **CSRF** | A malicious site acts as you | Origin allow-list **plus** double-submit cookie |
| **Enumerating other people's files** | Guessing ids | Random UUIDs, and **404 not 403** for files you don't own |
| **Stored XSS via upload** | Uploading a "picture" that runs code | Magic-byte sniffing; inline rendering allow-listed; mismatches forced to download |
| **Path traversal** | A filename like `../../etc/passwd` | Rejected by a database `CHECK` constraint, not just code |
| **Brute force / flooding** | Guessing passwords, hammering the API | Rate limits per IP and per account; chunk uploads exempted so they don't lock you out |
| **Runaway cost** | Someone filling the disk | Per-account quota **and** a service-wide ceiling that a new sign-up can't escape |

**The two-sentence version if asked to summarise:** "Nothing is trusted from the
client — not the content type, not the IP, not the visibility. Every dangerous
default is the safe one: files are private unless published, unknown file types
download rather than render, and an id you don't own is indistinguishable from
one that doesn't exist."

---

# Part 9 · The tests

**120 tests, in `apps/api/tests/`.**

| File | Covers |
|---|---|
| `auth.test.ts` | Register, login, sessions, refresh rotation |
| `files.test.ts` | Upload, list, rename, move, ranges, ETags, permissions |
| `uploads.test.ts` | Chunked uploads, resuming, corruption, instant upload |
| `shares.test.ts` | Public links, passwords, expiry, download limits |
| `requests.test.ts` | Inbound upload links and their slot budget |
| `collaborators.test.ts` | Roles, inherited access, pending invitations |
| `search.test.ts` | Content indexing, insights, share receipts |
| `capacity.test.ts` | The storage ceiling, including across accounts |
| `trust-proxy.test.ts` | Which address a rate limit counts against |

## 9.1 The thing that makes them valuable

**No mocks.** They run against a real PostgreSQL database, built by the same
migrations as production, and the real Express application. Uploads genuinely
stream to disk and are read back byte-for-byte.

**Why that matters, in one line:** a mocked test proves the code does what you
told the mock to expect. It cannot tell you that Cloudflare R2 rejects an
`x-amz-acl` header. Running the suite against a real object store found four
such bugs.

> **If asked about testing philosophy:** "I test behaviour through the real
> boundaries. Mocking the database would have hidden the race condition on
> quota, because the whole point is what two concurrent transactions do to one
> row."

## 9.2 A moment of honesty worth repeating

The first time the suite was claimed to have "passed against S3", it hadn't —
`vitest.config.ts` had `STORAGE_DRIVER: 'local'` hard-coded, so it silently ran
on local disk regardless. That was caught, the config made overridable, and S3
use was then *proven* by counting 99 objects in the bucket.

Being able to tell that story — "I checked my own claim and it was wrong" — is
worth more in an interview than a suite that has never been doubted.

---

# Part 10 · How it runs in production

## 10.1 The shape

```
        ┌──────────── one container ────────────┐
you ──▶ │ nginx (public port)                   │
        │   ├── /api/* ──▶ Express  :4000       │──▶ Neon PostgreSQL
        │   └── /*     ──▶ Next.js  :3100       │      (the facts)
        └───────────────────────────────────────┘
                          │
                          └──────────────▶ Cloudflare R2 (the bytes)
```

**A container** is the application plus everything it needs to run — the right
Node version, the right system libraries — sealed in one image. It runs
identically on a laptop and on a server. That's what `Dockerfile` builds.

**Why one container with nginx in front, instead of two services?** Because the
session cookies use the `__Host-` prefix, which requires everything on one
origin. Split across two hostnames, the cookies would be cross-site and **login
would silently fail to stick** — the page would just bounce back to sign-in with
no error. The old `render.yaml` had exactly this bug before it was found.

## 10.2 Boot order — `scripts/start.sh`

```sh
echo "→ migrating"
( cd apps/api && node dist/db/migrate.js up )

if [ "${SEED_DEMO:-false}" = "true" ]; then
  echo "→ seeding the demo account"
  ( cd apps/api && SEED_DEMO=true node dist/db/seed.js ) || echo "⚠ seed failed — continuing"
fi
```

Migrations first, always, so the code never meets an old database shape. Then
optionally the demo data — and note the seed is skipped if the demo account
already exists, so a restart doesn't wipe what a visitor uploaded.

```sh
while kill -0 "$API" 2>/dev/null && kill -0 "$WEB" 2>/dev/null && kill -0 "$PROXY" 2>/dev/null; do
  sleep 2
done
echo "✖ a service exited — taking the container down so the platform restarts it"
exit 1
```

**The supervisor.** Three processes run inside one container. If any one dies,
the whole container exits — so the platform restarts it cleanly. The alternative
is a container that looks alive while serving errors, which is much worse to
diagnose.

**A real bug:** this originally used `wait -n`, which Alpine Linux's minimal
shell doesn't support. The container would have restart-looped forever. Replaced
with the polling loop above.

## 10.3 The four bugs that only appeared when deploying

Worth having ready for "tell me about a difficult debugging session."

1. **Migrations missing from the built image** — the compiled code looked for
   `dist/db/migrations`, which the TypeScript compiler never creates (it only
   compiles `.ts`, and these are `.sql`). Every deploy died on step one. Fixed by
   copying them in the build and looking in both places.
2. **`wait -n` unsupported** — as above.
3. **Next.js installing TypeScript at boot** — the config file was `next.config.ts`,
   and reading a TypeScript config at runtime makes it fetch the compiler on
   startup. Renamed to `.mjs`.
4. **The empty folder that wasn't in the repo.** `Dockerfile` had
   `COPY apps/web/public apps/web/public`. That folder existed on the laptop but
   was **empty**, and git cannot track empty directories — so it wasn't in the
   repository, and the build failed on a fresh clone while working perfectly
   locally.

**And the worst one, found while investigating #4:** `.gitignore` contained a
line `storage/`. Because a gitignore pattern with no slash matches at *any*
depth, it silently excluded `apps/api/src/storage/` — the entire storage layer,
five source files — from the repository. The code worked locally because the
files were on disk. On a fresh clone it didn't compile at all.

> **The lesson to state:** "'It works on my machine' is a specific failure mode
> with a specific cause — your machine has files the repository doesn't. I now
> test the Docker build against a clean checkout produced by `git archive`, not
> against my working directory."

---

# Part 11 · Glossary

Every term has a **Real** definition — what an interviewer means — and a
**Plain** one.

### API
**Real:** the defined set of operations one program exposes to another, here over
HTTP with JSON.
**Plain:** the list of things you're allowed to ask for, like a menu.

### Argon2id
**Real:** a memory-hard password hashing function; the current OWASP
recommendation. Configured here at m=19456 KiB, t=2, p=1.
**Plain:** a deliberately slow, heavy lock, so a thief can't try millions of keys.

### Blob
**Real:** in this system, a row representing one distinct set of bytes, keyed by
its SHA-256 and reference-counted.
**Plain:** the actual book. Several catalogue cards can point at one book.

### CDN
**Real:** a network of servers close to users that caches and serves content.
**Plain:** local corner shops instead of one warehouse far away.

### Chunked upload
**Real:** splitting a payload into sequential ranges uploaded as independent
requests, tracked server-side so the transfer can resume.
**Plain:** sending a big parcel as many small ones, with a checklist.

### Constraint (database)
**Real:** a rule the database enforces on every write, e.g. `CHECK`, `UNIQUE`,
`NOT NULL`, foreign keys.
**Plain:** a rule the filing cabinet itself refuses to break, no matter who's filing.

### Content addressing
**Real:** identifying data by a cryptographic hash of its contents rather than by
name or location, which makes de-duplication and integrity checks fall out for free.
**Plain:** naming a thing by what it *is*, so two identical things get the same name.

### CORS
**Real:** Cross-Origin Resource Sharing — the browser rule that one site can't
read another's responses unless permitted by response headers.
**Plain:** a rule stopping one shop from reading another shop's till.

### CSRF
**Real:** Cross-Site Request Forgery — abusing automatically-sent credentials to
perform actions as a logged-in victim. Defended by origin checks and a
double-submit token.
**Plain:** tricking you into signing something without reading it.

### De-duplication
**Real:** storing identical content once and referencing it many times.
**Plain:** one copy of the book, several cards.

### Docker / container
**Real:** packaging an application with its dependencies and runtime into a
portable image that runs identically anywhere.
**Plain:** a lunchbox with the meal *and* the cutlery, so it works anywhere.

### Environment variable
**Real:** configuration supplied by the surrounding system rather than the code,
so the same build runs in different places and secrets stay out of the repository.
**Plain:** a note taped to the machine saying which settings to use today.

### ETag
**Real:** a response header identifying a version of a resource, so a client can
ask "changed since?" and receive 304 instead of the body.
**Plain:** a "still the same as last time" sticker, so you don't re-download it.

### Foreign key
**Real:** a column constrained to reference an existing row in another table,
enforcing referential integrity in the database.
**Plain:** a rule that a card must point at a book that really exists.

### Hash / SHA-256
**Real:** a one-way function producing a fixed-length digest; the same input
always gives the same output, and the input can't be recovered.
**Plain:** a fingerprint. Same person, same fingerprint. You can't rebuild the
person from it.

### httpOnly cookie
**Real:** a cookie flag that hides the value from JavaScript, limiting the
damage of an XSS vulnerability.
**Plain:** a note the browser can carry but no script is allowed to read.

### Index (database)
**Real:** a data structure making lookups on a column fast without scanning the
whole table.
**Plain:** the index at the back of a book, instead of reading every page.

### Interface
**Real:** a type describing required operations without their implementation,
enabling substitution — here, `StorageDriver`.
**Plain:** the shape of a plug socket. Any matching plug works.

### JWT
**Real:** JSON Web Token — a signed, self-describing token verifiable without a
database lookup. Cannot be revoked before expiry, which is why this system also
checks a session row.
**Plain:** a wristband with a tamper-proof seal. Easy to check, hard to cancel.

### Magic bytes
**Real:** a signature at the start of a file identifying its true format, used
here instead of the client-declared content type.
**Plain:** looking inside the tin instead of reading the label.

### Middleware
**Real:** a function in the request pipeline that can inspect, modify, or
short-circuit a request before it reaches its handler.
**Plain:** the checkpoints between the door and your seat.

### Migration
**Real:** a versioned, ordered script that changes the database schema; here
forward-only, with an advisory lock and a checksum ledger.
**Plain:** numbered instructions for rearranging the filing cabinet, in order.

### MIME type
**Real:** a label like `image/png` describing a file's format.
**Plain:** what kind of thing this is.

### Monorepo
**Real:** several related packages in one repository, here as npm workspaces.
**Plain:** one toolbox holding both sets of tools.

### Object storage / S3
**Real:** a service storing arbitrary blobs by key over HTTP, with essentially
unlimited capacity — as opposed to a filesystem or a database.
**Plain:** an enormous cloakroom. Hand over a bag, get a ticket.

### ORM
**Real:** Object-Relational Mapper — a library presenting database rows as
objects, generating SQL for you. Deliberately **not** used here.
**Plain:** a translator between the code's language and the database's. Handy,
but you stop seeing what's actually said.

### Pool (connection)
**Real:** a set of reusable database connections. Undersizing causes hangs
rather than slowdowns, because acquisition waits indefinitely.
**Plain:** a few phone lines shared by the office instead of a new one per call.

### Presigned URL
**Real:** a time-limited, cryptographically signed URL granting access to one
object without credentials — used so file bytes bypass the API entirely.
**Plain:** a cloakroom ticket that works for two minutes and then doesn't.

### Race condition
**Real:** a bug where the outcome depends on the interleaving of concurrent
operations — here, two uploads both reading the same quota before either writes.
**Plain:** two people taking the last biscuit because they both looked at the
same time.

### Rate limiting
**Real:** capping requests per identity per window to blunt brute force and abuse.
**Plain:** "one at a time, please."

### Refresh token rotation
**Real:** issuing a new refresh token on each use and invalidating the old one;
reuse of a spent token indicates theft and revokes the whole family.
**Plain:** each ticket works once. If someone tries a used ticket, all the
tickets from that book are cancelled.

### Row lock / `FOR UPDATE`
**Real:** SQL that reserves a row for the duration of a transaction so
concurrent transactions serialise on it.
**Plain:** taking the pen so nobody else can write on the form until you're done.

### Soft delete
**Real:** marking a row deleted with a timestamp instead of removing it, enabling
restore and retention windows.
**Plain:** the wastepaper basket, not the incinerator.

### SQL
**Real:** the query language for relational databases.
**Plain:** how you ask the filing cabinet questions.

### Streaming
**Real:** processing data in small pieces as it arrives instead of buffering it
whole, so memory use stays constant regardless of payload size.
**Plain:** drinking through a straw instead of pouring the bottle into your mouth.

### Transaction
**Real:** a group of database operations that all succeed or all roll back,
leaving no partial state.
**Plain:** all of it happens, or none of it does. Never half.

### Trigger
**Real:** procedural code stored in the database that runs automatically on
insert/update/delete, so an invariant can't be bypassed by application code.
**Plain:** a rule the cabinet applies by itself, even if the filing clerk forgets.

### tsvector / full-text search
**Real:** Postgres's indexed representation of a document — stemmed words with
positions — enabling fast content search.
**Plain:** a pre-built index of every word in every document.

### Trigram
**Real:** a three-character substring; a `pg_trgm` index over them enables fast
fuzzy and partial matching, e.g. filename fragments.
**Plain:** chopping words into three-letter pieces so half a word still matches.

### TypeScript
**Real:** JavaScript with static types checked at build time.
**Plain:** shaped holes, so the wrong piece won't fit.

### UUID
**Real:** a 128-bit identifier, random enough to be unguessable — used instead of
sequential ids to prevent enumeration.
**Plain:** a very long random name nobody can guess.

### XSS
**Real:** Cross-Site Scripting — getting attacker JavaScript to run in a
victim's page. Mitigated here by `httpOnly` cookies, a strict Content-Security-Policy,
and never rendering uploads inline unless allow-listed.
**Plain:** sneaking your own instructions into someone else's page.

---

# Part 12 · Likely questions, with answers

## "Walk me through the architecture."

> "Three tiers. A Next.js front end, an Express API, and PostgreSQL for
> metadata — with file bytes in S3-compatible object storage rather than the
> database, because databases are bad at large binaries. In production all of it
> runs in one container behind nginx, which matters because the session cookies
> use the `__Host-` prefix and need a single origin. The front end is a
> convenience; every rule is enforced in the API, because the client can't be
> trusted."

## "Why no ORM?"

> "The interesting parts of this problem are the SQL, the streaming upload path
> and the authorisation rules, and an ORM hides all three. I used Kysely, which
> gives full type safety over queries I can still read as SQL, and kept the
> schema in plain `.sql` files so it's reviewable. I'd also point out the quota
> check needs `SELECT … FOR UPDATE` to be correct — that's the kind of thing
> that's awkward to express through an ORM and easy to get subtly wrong."

## "How do you handle a 500 MB upload?"

> "Chunked and resumable. The browser fingerprints the file incrementally so
> memory stays flat, then declares size and hash up front — which lets the
> server answer 'I already have those bytes' instantly. Otherwise it opens a
> session, and the file goes up as independent chunk requests, each checksummed
> on arrival, written at its own offset in a sparse spool file, with a bitmap
> tracking which have landed. If anything dies, the client asks what's missing
> and sends only that. I verified it live with a 120 MB file where my connection
> genuinely dropped at chunk 193 of 240 — it resumed, sent 47 chunks, and the
> SHA-256 matched."

## "How do you stop me reading someone else's file?"

> "One function, `mayTouchFile`, makes every decision — owner, folder
> collaborator with a sufficient role, or a valid share grant. Centralised
> because permission logic spread across twenty handlers will be right in
> nineteen. And a file you don't own answers **404, not 403**, because 403 would
> confirm it exists."

## "What was the hardest bug?"

> "The one that made the app work perfectly on my machine and not build at all
> on the server. `.gitignore` had a line `storage/`, and because a gitignore
> pattern without a slash matches at any depth, it silently excluded
> `apps/api/src/storage/` — the whole storage layer — from the repository. Five
> files that existed on my disk and not in git. The fix was one line; the lesson
> was that I now build the Docker image from a clean `git archive` rather than
> my working directory, so the repository is what gets tested."

## "What would you do differently?"

> "Test the S3 driver against a real object store much earlier. It was fully
> typed, reviewed, and completely broken — it sent an `ACL` header that
> Cloudflare R2 and Backblaze B2 both reject, so every upload would have failed.
> Types can't tell you a remote service refuses a header. I'd reach for a real
> dependency in a container sooner."

## "How do you know it works?"

> "120 tests against a real Postgres and the real Express app, no mocked
> database or storage — and the same suite runs green against a real
> S3-compatible server. Plus I verified the deployed instance end to end: demo
> login, a 120 MB resumable upload with a byte-identical download, anonymous
> access to a public link, 403 on a wrong share password, 401 on a tampered
> grant, and 401 on a private file with no session."

## "What's missing?"

> "Thumbnail generation — the schema supports it, the generation isn't written.
> Client-side encryption. Email notification for expiring links. All three are
> in the README rather than left to be discovered. And the deployment is
> free-tier, so it sleeps when idle and storage is capped — that's a hosting
> choice, not a limitation of the code."

## If you genuinely don't know

Say this, honestly:

> "I'd have to look at that file to answer properly. What I know is [the shape
> of it]. Can I walk you through where I'd look?"

That answer is respected. A confident invention is not, and an interviewer who
knows the codebase will catch it immediately.

---

## The five things to know cold

If you memorise nothing else:

1. **Front end is convenience, back end is authority.** The client is never
   trusted.
2. **`files` are names; `blobs` are bytes.** Two files can share one blob — that's
   de-duplication, and it's scoped per owner so it can't be used to test whether
   someone else has a file.
3. **Big uploads go in chunks**, tracked by a bitmap, so they resume instead of
   restarting.
4. **404, not 403**, for things you don't own.
5. **Quota is checked twice** — advisory before the transfer, binding inside a
   transaction under `FOR UPDATE`, because two uploads finishing together would
   otherwise both fit.

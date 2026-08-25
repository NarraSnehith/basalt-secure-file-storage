# Walkthrough video script — Basalt

**Target length 6–7 minutes.** Two columns: **SAY** is what you speak, **DO** is
what is on screen while you say it. Speak a little slower than feels natural.

---

## BEFORE YOU HIT RECORD — five minutes of setup

1. **Wake the site.** Open https://basalt-q5h1.onrender.com and wait for it to
   load. The free instance sleeps after 15 minutes and takes ~50 seconds to
   wake. Do this *before* recording or your first 50 seconds are a blank page.
2. **Empty the bin.** Sign in → **Insights** → **Empty trash**. There is a
   120 MB verification file in there from testing; clearing it drops the storage
   figure from 136 MB to about 10 MB, which reads much better on camera.
3. **Have a big file ready** on your desktop, 120–200 MB. Any large video or a
   zip. You will drag this in to show resumable uploads.
4. **Open a second browser window in private/incognito mode**, sized the same,
   and leave it on a blank tab. You will use it to prove a share link works for
   someone with no account.
5. **Browser at 100% zoom, 1280×720 or larger.** Close other tabs — the tab bar
   is in the recording.
6. **Sign out** in your main window so you can record the sign-in.

---

## 0:00 — 0:20 · Open

> **SAY:** "Hi, I'm Snehith. This is Basalt, the secure file storage service I
> built for this assignment. It's a full-stack TypeScript application — Express
> and PostgreSQL on the back end, Next.js on the front — and it's deployed and
> running live, so everything you're about to see is the real thing."

**DO:** Land on the public landing page. Do not scroll yet. Let it sit.

---

## 0:20 — 0:40 · The caveat, once, briefly

> **SAY:** "One quick note before I start. This is deployed on free-tier
> infrastructure, so I've deliberately capped how much can be stored — one
> gigabyte per account. That's a hosting choice, not a limitation of the
> application. Nothing is stubbed or mocked: real object storage, real share
> links, real search. It's the volume that's capped, not the capability."

**DO:** Scroll slowly to the **"This deployment runs on free infrastructure"**
panel near the bottom of the landing page so the three figures — 1 GB, 6 GB,
512 MB — are visible while you say this. Then scroll back to the top.

*Say this once, here. Don't keep apologising for it later.*

---

## 0:40 — 1:05 · Signing in

> **SAY:** "There's a demo account seeded with realistic content, so let me use
> that. Password hashing is Argon2id at the OWASP parameters, and the session is
> a short-lived access token plus a rotating refresh token, both in httpOnly
> cookies — so no token is ever readable by JavaScript."

**DO:**
1. Click **Sign in** (top right).
2. Point the cursor at the credentials shown on the page — `demo@basalt.build`
   and `stone-and-ash-2026` — for a beat.
3. Click **Use the demo account**.
4. Land in the drive.

---

## 1:05 — 1:40 · The drive

> **SAY:** "This is the drive. Folders nest on the left — Photography has a RAW
> folder inside it. Files show type, size and when they changed. Down here is
> the storage meter, broken down by kind of file. Everything here is private by
> default; nothing is public until I explicitly publish it."

**DO:**
1. Cursor down the sidebar: **Drive, Recent, Starred, Shared, Shared with me,
   Upload links, Insights, Activity, Trash**.
2. Click **Photography** in the folder tree, then click the **expand arrow** to
   reveal **RAW** nested inside.
3. Hover the storage meter at the bottom left.
4. Click **Drive** to come back.

---

## 1:40 — 2:40 · Large upload, interrupted on purpose ⭐

*This is the most important 60 seconds of the video. Don't rush it.*

> **SAY:** "The assignment asked for files over a hundred megabytes, so let me
> show you how that works. This goes up in chunks, and each chunk is checksummed
> as it arrives."

**DO:** Drag your large file onto the file list. The transfer dock appears with
a progress bar. Let it reach roughly 30%.

> **SAY:** "Now watch — I'm going to reload the page in the middle of this."

**DO:** Press **Cmd-R / F5**. Wait for the page to come back.

> **SAY:** "It picked up where it left off. It didn't start again. The server
> keeps a record of exactly which chunks it has, so when the page came back it
> asked what was missing and sent only that. I actually hit this for real while
> testing — my connection dropped at chunk 193 of 240, and it resumed and sent
> only the remaining 47. The file came back byte-for-byte identical, verified by
> SHA-256."

**DO:** Let the upload finish. The file appears in the list.

---

## 2:40 — 3:10 · Same bytes stored once

> **SAY:** "Files are addressed by the SHA-256 of their contents, not their
> name. So if I upload that same file again —"

**DO:** Drag **the same file** in a second time.

> **SAY:** "— it finishes instantly, and it costs nothing against my quota,
> because the server already has those exact bytes. That's real de-duplication,
> not a trick."

**DO:** Point at the storage meter — it has not moved.

---

## 3:10 — 3:45 · Versions

> **SAY:** "Re-uploading something under a name that already exists doesn't
> overwrite it — it makes a new version."

**DO:**
1. Open the **Contracts** folder.
2. Click the **⋯** menu on a file → **File details**.
3. Point at **SHA-256**, **INDEXED**, **VISIBILITY** and **DOWNLOADS** in the
   details panel.

> **SAY:** "Every file carries its own checksum, whether its contents are
> searchable, its visibility, and how many times it's been downloaded. Older
> versions stay downloadable, and restoring one adds it on top rather than
> throwing away the newer one."

---

## 3:45 — 4:20 · Search that reads inside files ⭐

> **SAY:** "Search doesn't just match filenames. Text documents are indexed by
> their contents."

**DO:**
1. Click the search box (or press **/**).
2. Type a word you know is *inside* a document but not in its name — try
   **`unsorted`** or **`organised`**.
3. Let the result appear.

> **SAY:** "That word isn't in the filename anywhere — it's inside the document.
> That's a Postgres full-text index, and filenames match on fragments too, so a
> half-remembered name still finds the file."

**DO:** Clear the search. Type **`ambien`** — `site-ambience.wav` appears.

---

## 4:20 — 5:10 · Public and private, and taking it back ⭐

> **SAY:** "Now the core of the assignment: public versus private. Every file
> starts private. Let me publish one."

**DO:**
1. **⋯** menu on a file → **Share…**
2. Create the link, then **copy** it.
3. Switch to your **private/incognito window**. Paste. It loads — the file is
   reachable by anyone with the link.

> **SAY:** "No account, no session — it just works. And a link can carry its own
> password, an expiry date, and a limit on how many times it can be downloaded."

**DO:**
1. Back in the main window, **revoke** the link.
2. Switch to the private window and **refresh**.

> **SAY:** "Revoked, and the door closes on the very next request."

**DO:** In the private window, try a **private** file's URL directly (paste
`https://basalt-q5h1.onrender.com/api/files/<any-id>/content`).

> **SAY:** "And asking for a file I don't own gives me a 404, not a 403 —
> because a 403 would confirm that the file exists."

---

## 5:10 — 5:40 · Sharing with people, and asking for files

> **SAY:** "Links are one thing, people are another."

**DO:** Click **Shared with me** in the sidebar.

> **SAY:** "Folders can be shared with a named person as a viewer, contributor
> or editor. They don't need an account yet — the invitation attaches itself
> when they make one — and revoking one person doesn't disturb anybody else."

**DO:** Click **Upload links**.

> **SAY:** "And this is the reverse: a link that lets someone send *me* files
> without an account, capped at a number of uploads I choose. Everything they
> send lands in the folder I nominated."

---

## 5:40 — 6:10 · Insights and the audit trail

**DO:** Click **Insights**.

> **SAY:** "This tells me what's actually using my space — what's duplicated,
> what version history is costing me, what the bin is still holding, and how
> much of it I could reclaim right now."

**DO:** Click **Activity**.

> **SAY:** "And everything is written down. Uploads, downloads, renames, link
> views, failed passwords — with the time and the address, in plain language.
> For a share link I can see exactly who opened it and when."

---

## 6:10 — 6:40 · Close

> **SAY:** "Briefly, under the hood: no ORM, because the interesting parts here
> are the SQL, the streaming upload path and the authorisation rules — an ORM
> would hide all three. No UI library either; the icons, the type scale and the
> artwork are all in the repository. There are 120 tests running against a real
> Postgres database and real object storage, no mocks — which is how I found
> four bugs in the S3 driver that unit tests would never have caught. The README
> covers the reasoning, including the mistakes this deployment actually hit
> rather than a tidied-up version. Thanks for watching."

**DO:** Return to the drive, or show the README on GitHub for the last few
seconds.

---

## If something goes wrong on camera

- **Page hangs on first load** — the instance was asleep. Stop, wait for it,
  start again.
- **Upload seems stuck** — your connection, not the app. Say "this is my upload
  speed" and cut, or use a smaller file.
- **You fumble a line** — pause two seconds in silence and say it again. Easy to
  cut, and far better than talking through it.

## The two things to get right

The **interrupted upload** at 1:40 and the **revoked share link** at 4:20. Those
two are the assignment's actual requirements demonstrated live. Everything else
is supporting material — if you run long, trim Insights and Activity, not those.

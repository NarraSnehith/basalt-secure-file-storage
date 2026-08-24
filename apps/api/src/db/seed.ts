/**
 * Development seed: one demo account with a believable drive behind it.
 *
 *   npm run db:seed
 *
 * Everything goes through the real service layer — the same validation,
 * sniffing, quota accounting and audit trail a browser upload gets — so the
 * seeded state is a state the application could actually reach.
 */
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { Request } from 'express';
import { db, pool } from './client.js';
import { env } from '../config/env.js';
import { hashPassword } from '../lib/crypto.js';
import { initStorage, newSpoolPath } from '../storage/index.js';
import { createFolder } from '../modules/folders/service.js';
import { setVisibility } from '../modules/files/service.js';
import { ingest, reindexPending } from '../modules/files/ingest.js';
import { createShare } from '../modules/shares/service.js';
import { createRequest } from '../modules/requests/service.js';
import { inviteCollaborator } from '../modules/collaborators/service.js';
import type { ReceivedBlob } from '../modules/files/upload.js';
import { makeGzip, makePdf, makePng, makeWav } from './fixtures.js';

const DEMO_EMAIL = 'demo@basalt.build';
const DEMO_PASSWORD = 'stone-and-ash-2026';
// A second account, so folder sharing has somebody to be shared with.
const GUEST_EMAIL = 'colleague@basalt.build';
const GUEST_PASSWORD = 'quartz-and-slate-2026';

// The service layer takes a Request purely to stamp ip/user-agent on audit rows.
const seedRequest = {
  ip: '127.0.0.1',
  socket: { remoteAddress: '127.0.0.1' },
  get: (name: string) => (name.toLowerCase() === 'user-agent' ? 'basalt-seed/1.0' : undefined),
} as unknown as Request;

async function blobFrom(name: string, contents: Buffer, declaredMime: string | null): Promise<ReceivedBlob> {
  const spoolPath = newSpoolPath();
  await writeFile(spoolPath, contents, { mode: 0o600 });
  return {
    filename: name,
    declaredMime,
    spoolPath,
    size: contents.length,
    checksum: createHash('sha256').update(contents).digest(),
    head: contents.subarray(0, 4100),
  };
}

const lorem = (n: number): string =>
  Array.from({ length: n }, (_, i) => `Line ${i + 1}: basalt columns cool from the outside in, which is why they crack into hexagons.`).join('\n');

async function main(): Promise<void> {
  await initStorage();

  /**
   * On a deployed demo this runs at every boot, and a free instance boots every
   * time it wakes from idle — so seeding has to be conditional there, or a
   * visitor's uploads would be deleted under them on the next cold start.
   *
   * SEED_DEMO is what start.sh sets, and it means "make sure the demo exists".
   * Run by hand (`npm run db:seed`, no SEED_DEMO) it keeps its original
   * behaviour and rebuilds the fixtures from scratch, which is what you want
   * locally after changing them.
   */
  if (process.env.SEED_DEMO === 'true') {
    const present = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', DEMO_EMAIL)
      .executeTakeFirst();
    if (present) {
      console.log(`· ${DEMO_EMAIL} already exists — leaving it and its files alone`);
      return;
    }
  }

  for (const email of [DEMO_EMAIL, GUEST_EMAIL]) {
    const existing = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
    if (existing) {
      await db.deleteFrom('users').where('id', '=', existing.id).execute();
      console.log(`· removed the previous ${email} account`);
    }
  }

  const user = await db
    .insertInto('users')
    .values({
      email: DEMO_EMAIL,
      password_hash: await hashPassword(DEMO_PASSWORD),
      display_name: 'Ada Reyes',
      accent: 'ember',
      quota_bytes: env.DEFAULT_QUOTA_BYTES,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const guest = await db
    .insertInto('users')
    .values({
      email: GUEST_EMAIL,
      password_hash: await hashPassword(GUEST_PASSWORD),
      display_name: 'Wren Okafor',
      accent: 'lapis',
      quota_bytes: env.DEFAULT_QUOTA_BYTES,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const folders: Record<string, string> = {};
  for (const name of ['Field notes', 'Contracts', 'Photography', 'Archive']) {
    folders[name] = (await createFolder(user.id, { name })).id;
  }
  const raw = await createFolder(user.id, { name: 'RAW', parentId: folders['Photography'] });

  // Generated, not shipped: three plates that actually look like something in a
  // preview pane, so the demo drive is not a wall of grey placeholders.
  const gradient = makePng(720, 440, (x, y) => {
    const u = x / 720;
    const v = y / 440;
    return [
      Math.round(40 + u * 205 + v * 10),
      Math.round(60 + (1 - v) * 90 + u * 60),
      Math.round(150 - u * 110 + v * 90),
    ];
  });

  const hexagons = makePng(560, 560, (x, y) => {
    // Offset hexagonal packing, tinted between ember and cooled basalt.
    const row = Math.floor(y / 46);
    const col = Math.floor((x + (row % 2 ? 24 : 0)) / 48);
    const seedv = (col * 7 + row * 13) % 11;
    if (seedv < 3) return [236, 122, 58];
    if (seedv < 6) return [178, 84, 48];
    if (seedv < 9) return [52, 48, 54];
    return [30, 28, 32];
  });

  const strata = makePng(900, 420, (x, y) => {
    // Layered bands with a little noise, like a polished core sample.
    const band = Math.floor(y / 21);
    const base = [
      [214, 196, 168], [166, 140, 110], [120, 104, 92], [86, 74, 70],
      [198, 128, 74], [148, 148, 132], [66, 60, 62],
    ][band % 7]!;
    const grain = ((x * 31 + y * 17) % 23) - 11;
    return [
      Math.max(0, Math.min(255, base[0]! + grain)),
      Math.max(0, Math.min(255, base[1]! + grain)),
      Math.max(0, Math.min(255, base[2]! + grain)),
    ];
  });

  // A file big enough that the transfer dock and the quota meter have something
  // to say. Deterministic bytes, so the checksum is stable across seeds.
  const rawScan = Buffer.alloc(9 * 1024 * 1024);
  for (let i = 0; i < rawScan.length; i += 1) rawScan[i] = (i * 2654435761) % 251;

  const items: Array<[string, Buffer, string | null, string | null]> = [
    ['Basalt — field survey 2026.pdf', makePdf('Basalt field survey', [
      'Site 4 — columnar jointing, 11 m exposed face.',
      'Cooling fractures propagate perpendicular to the isotherms.',
      'Sample set B logged and photographed; see attached plates.',
      '',
      'Prepared for internal review. Not for distribution.',
    ]), 'application/pdf', folders['Field notes']!],
    ['survey-notes.md', Buffer.from(`# Field notes\n\n## Site 4\n\n- Columnar jointing, 11 m face\n- Hexagonal cross sections dominate\n- Two shear zones, both healed\n\n> Cooling from the outside in is what makes the hexagons.\n\n${lorem(40)}\n`), 'text/markdown', folders['Field notes']!],
    ['samples.csv', Buffer.from(`sample,site,depth_m,density_kg_m3,notes\nB-01,4,0.4,2960,fresh face\nB-02,4,1.8,2984,minor vesicles\nB-03,4,3.2,3011,dense\nB-04,7,0.6,2890,weathered rind\nB-05,7,2.4,2975,fresh\n`), 'text/csv', folders['Field notes']!],
    ['column-cross-section.png', hexagons, 'image/png', folders['Photography']!],
    ['gradient-plate-01.png', gradient, 'image/png', folders['Photography']!],
    ['strata-core-sample.png', strata, 'image/png', folders['Photography']!],
    ['storage-agreement.pdf', makePdf('Storage agreement', [
      'This agreement covers off-site sample storage for the 2026 season.',
      'Term: 12 months, renewable.',
      'Counterparty signature required on page 2.',
    ]), 'application/pdf', folders['Contracts']!],
    ['rates-2026.csv', Buffer.from('service,unit,rate_usd\ncore storage,month,180\nsample prep,hour,95\ncourier,trip,42\n'), 'text/csv', folders['Contracts']!],
    ['old-inventory.txt.gz', makeGzip(lorem(400)), 'application/gzip', folders['Archive']!],
    ['site-ambience.wav', makeWav(3), 'audio/wav', folders['Archive']!],
    ['site-4-scan-raw.bin', rawScan, 'application/octet-stream', raw.id],
    ['deploy.sh', Buffer.from('#!/usr/bin/env bash\nset -euo pipefail\n\n# Kept for reference — superseded by the pipeline.\nrsync -avz --delete ./dist/ deploy@basalt:/srv/basalt\n'), 'text/x-shellscript', null],
    ['README.md', Buffer.from('# Drive root\n\nEverything above is organised by project. Anything at the root is unsorted.\n'), 'text/markdown', null],
    ['manifest.json', Buffer.from(JSON.stringify({ season: 2026, sites: [4, 7, 11], samples: 148, lead: 'Ada Reyes' }, null, 2)), 'application/json', null],
  ];

  const created: Array<{ id: string; name: string }> = [];
  for (const [name, contents, mime, folderId] of items) {
    const blob = await blobFrom(name, contents, mime);
    const { file } = await ingest(user, blob, { folderId, onConflict: 'rename', source: 'upload' }, seedRequest);
    created.push({ id: file.id, name: file.name });
  }

  // One openly public file, one link behind a password, one that expires.
  const survey = created.find((f) => f.name.startsWith('Basalt — field survey'))!;
  const plate = created.find((f) => f.name === 'column-cross-section.png')!;
  const agreement = created.find((f) => f.name === 'storage-agreement.pdf')!;

  await setVisibility(user, plate.id, 'public', seedRequest);
  await setVisibility(user, survey.id, 'public', seedRequest);
  await createShare(user.id, agreement.id, {
    label: 'Counterparty review',
    password: 'quartz-seam',
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
    maxDownloads: 5,
    allowPreview: false,
  }, seedRequest);

  // ── phase-two features want something to show ──────────────────────────
  // A file with real history: three revisions, one of which repeats an earlier
  // one so the "identical content costs nothing" case is visible.
  const notes = 'survey-notes.md';
  for (const [n, body] of [
    [2, '# Field notes\n\n## Site 4 (revised)\n\n- Columnar jointing, 11 m face\n- Recount: three shear zones, two healed\n'],
    [3, '# Field notes\n\n## Site 4 (final)\n\n- Columnar jointing, 11.4 m face\n- Three shear zones, two healed\n- Photographed at golden hour\n'],
  ] as Array<[number, string]>) {
    void n;
    const revision = await blobFrom(notes, Buffer.from(body), 'text/markdown');
    await ingest(user, revision, { folderId: folders['Field notes']!, onConflict: 'version', source: 'upload' }, seedRequest);
  }

  // A de-duplicated copy: same bytes under a second name, costing nothing.
  const duplicate = await blobFrom('column-cross-section (for print).png', hexagons, 'image/png');
  await ingest(user, duplicate, { folderId: raw.id, onConflict: 'rename', source: 'upload' }, seedRequest);

  // An open request link, so the inbound-upload page has something to render.
  const request = await createRequest(
    user.id,
    {
      title: 'Send me your site photographs',
      message: 'Anything from the 2026 season. JPEG or PNG, up to 50 MB each.',
      folderId: folders['Photography']!,
      maxFiles: 20,
      maxBytes: 500 * 1024 * 1024,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
    seedRequest,
  );

  // Share a folder with the second account, so the permission model is visible
  // without having to set it up by hand.
  await inviteCollaborator(user, folders['Field notes']!, { email: GUEST_EMAIL, role: 'contributor' }, seedRequest);
  await inviteCollaborator(user, folders['Photography']!, { email: GUEST_EMAIL, role: 'viewer' }, seedRequest);

  // And something the colleague contributed, credited to them.
  const contribution = await blobFrom(
    'wren-site-sketch.png',
    makePng(420, 300, (x, y) => [200 - (x % 90), 150 + (y % 70), 120 + ((x + y) % 90)]),
    'image/png',
  );
  await ingest(
    user,
    contribution,
    { folderId: folders['Field notes']!, onConflict: 'rename', source: 'upload', actorId: guest.id },
    seedRequest,
  );

  // A couple of items in the trash so restore has something to act on.
  const trashName = 'draft-abstract.md';
  const trashBlob = await blobFrom(trashName, Buffer.from('# Draft abstract\n\nSuperseded — see v3.\n'), 'text/markdown');
  const { file: trashed } = await ingest(
    user,
    trashBlob,
    { folderId: null, onConflict: 'rename', source: 'upload' },
    seedRequest,
  );
  await db
    .updateTable('files')
    .set({ deleted_at: new Date(), purge_after: new Date(Date.now() + env.TRASH_RETENTION_DAYS * 86_400_000) })
    .where('id', '=', trashed.id)
    .execute();

  await db.updateTable('files').set({ starred: true }).where('id', 'in', [survey.id, plate.id]).execute();

  // Extraction is fire-and-forget during an upload, and this process is about
  // to exit — finish anything outstanding so a freshly seeded drive is
  // searchable, then report the total rather than the leftovers.
  await reindexPending();
  const indexed = await db
    .selectFrom('files')
    .select(({ fn }) => fn.countAll<string>().as('n'))
    .where('content_text', 'is not', null)
    .executeTakeFirst();

  const stats = await db
    .selectFrom('users')
    .select(['storage_used_bytes'])
    .where('id', '=', user.id)
    .executeTakeFirstOrThrow();

  console.log(`
  ✔ seeded ${created.length + 1} files across 5 folders
    account   ${DEMO_EMAIL}
    password  ${DEMO_PASSWORD}
    used      ${(Number(stats.storage_used_bytes) / 1024).toFixed(0)} KB
    shares    2 public links + 1 password-protected (password: quartz-seam)
    request   ${request.url}
    colleague ${GUEST_EMAIL} / ${GUEST_PASSWORD} (shared folders)
    indexed   ${indexed?.n ?? 0} files searchable by their contents
`);
  void randomUUID; // keep the import honest if the block above is edited
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => {});
    process.exit(1);
  });

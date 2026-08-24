import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { anon, binaryParser, closeAll, newClient, resetDatabase, type Client } from './helpers.js';

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);

async function withFile(client: Client, name = 'notes.txt', body = 'hello basalt') {
  const res = await client.upload(name, body, { contentType: 'text/plain' });
  // Include the payload in the message: a bare "expected 401 to be 201" tells
  // you nothing about which guard rejected it.
  expect(res.status, `upload of ${name} failed: ${JSON.stringify(res.body)}`).toBe(201);
  return res.body.files[0];
}

describe('file storage', () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it('stores an upload with a sha-256 checksum and a sniffed content type', async () => {
    const client = await newClient().register();
    const res = await client.upload('plate.png', png, { contentType: 'image/png' });

    expect(res.status).toBe(201);
    const file = res.body.files[0];
    expect(file.mimeType).toBe('image/png');
    expect(file.kind).toBe('image');
    expect(file.sizeBytes).toBe(png.length);
    expect(file.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(file.visibility).toBe('private');
  });

  it('serves the bytes back byte-for-byte', async () => {
    const client = await newClient().register();
    const file = await withFile(client, 'exact.bin', 'the-precise-bytes');
    const res = await client.get(`/api/files/${file.id}/content`).buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString()).toBe('the-precise-bytes');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('never trusts the declared content type over the magic bytes', async () => {
    const client = await newClient().register();
    // A PNG header on a file claiming to be a PDF: the sniff wins.
    const res = await client.upload('confused.pdf', png, { contentType: 'application/pdf' });
    const file = res.body.files[0];
    expect(file.mimeType).toBe('image/png');
    expect(file.declaredMime).toBe('application/pdf');
    expect(file.mimeMismatch).toBe(true);
    expect(file.previewable).toBe(false); // a mismatch is only ever an attachment
  });

  it('refuses extensions that a web server would execute', async () => {
    const client = await newClient().register();
    const res = await client.upload('shell.php', '<?php system($_GET["c"]); ?>', { contentType: 'text/plain' });
    expect(res.status).toBe(415);
    expect(res.body.error.details.rejected[0].code).toBe('unsupported_media_type');
  });

  it('forces a download for anything that could execute in the browser', async () => {
    const client = await newClient().register();
    const file = await withFile(client, 'xss.html', '<script>alert(1)</script>');
    const res = await client.get(`/api/files/${file.id}/content?disposition=inline`);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers['content-security-policy']).toContain('sandbox');
  });

  it('strips path traversal out of the filename', async () => {
    const client = await newClient().register();
    const res = await client.upload('../../../etc/passwd', 'root:x:0:0', { contentType: 'text/plain' });
    expect(res.status).toBe(201);
    expect(res.body.files[0].name).toBe('passwd');
  });

  it('accepts a file of exactly the limit and rejects one byte more', async () => {
    const limit = 2 * 1024 * 1024; // MAX_UPLOAD_BYTES under test
    const exact = await newClient().register();
    expect((await exact.upload('exact.bin', Buffer.alloc(limit, 1))).status).toBe(201);

    const over = await newClient().register();
    const res = await over.upload('over.bin', Buffer.alloc(limit + 1, 1));
    expect(res.status).toBe(413);
  });

  it('enforces the storage quota', async () => {
    const client = await newClient().register();
    // Quota is 5 MB in tests, per-file limit 2 MB.
    for (const i of [1, 2]) {
      const res = await client.upload(`chunk-${i}.bin`, Buffer.alloc(1_900_000, i));
      expect(res.status).toBe(201);
    }
    const third = await client.upload('chunk-3.bin', Buffer.alloc(1_900_000, 3));
    expect(third.status).toBe(507);
    expect(third.body.error.details.rejected[0].code).toBe('quota_exceeded');
  });

  it('turns a same-name upload into a new version, not a numbered copy', async () => {
    const client = await newClient().register();
    const first = await withFile(client, 'report.txt', 'draft one');
    const second = await withFile(client, 'report.txt', 'draft two');

    expect(second.id).toBe(first.id); // one file, not two
    expect(second.version).toBe(2);
    expect((await client.get('/api/files?scope=all')).body.total).toBe(1);

    const body = await client.get(`/api/files/${first.id}/content`).buffer(true).parse(binaryParser);
    expect(Buffer.from(body.body).toString()).toBe('draft two');
  });

  it('still makes a numbered copy when asked to', async () => {
    const client = await newClient().register();
    await withFile(client, 'report.txt', 'one');
    const res = await client.upload('report.txt', 'two', { contentType: 'text/plain', onConflict: 'rename' });
    expect(res.status).toBe(201);
    expect(res.body.files[0].name).toBe('report (2).txt');
    expect((await client.get('/api/files?scope=all')).body.total).toBe(2);
  });

  it('keeps every file scoped to its owner', async () => {
    const owner = await newClient().register();
    const other = await newClient().register();
    const file = await withFile(owner);

    const probes = [
      () => other.get(`/api/files/${file.id}`),
      () => other.get(`/api/files/${file.id}/content`),
      () => other.patch(`/api/files/${file.id}`).send({ name: 'stolen.txt' }),
      () => other.delete(`/api/files/${file.id}`),
      () => other.post('/api/shares').send({ fileId: file.id }),
    ];
    for (const probe of probes) {
      const res = await probe();
      expect(res.status).toBe(404); // not 403 — existence itself is private
    }

    const list = await other.get('/api/files?scope=all');
    expect(list.body.total).toBe(0);
  });

  it('requires a session for every file route', async () => {
    const owner = await newClient().register();
    const file = await withFile(owner);
    expect((await anon().get(`/api/files/${file.id}`)).status).toBe(401);
    expect((await anon().get(`/api/files/${file.id}/content`)).status).toBe(401);
    expect((await anon().get('/api/files')).status).toBe(401);
  });

  it('supports byte ranges so media can seek', async () => {
    const client = await newClient().register();
    const file = await withFile(client, 'clip.txt', 'abcdefghijklmnopqrstuvwxyz');
    const res = await client.get(`/api/files/${file.id}/content`).set('Range', 'bytes=3-7').buffer(true).parse(binaryParser);
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 3-7/26');
    expect(Buffer.from(res.body).toString()).toBe('defgh');
  });

  it('answers a conditional request with 304', async () => {
    const client = await newClient().register();
    const file = await withFile(client);
    const first = await client.get(`/api/files/${file.id}/content`);
    const again = await client.get(`/api/files/${file.id}/content`).set('If-None-Match', String(first.headers.etag));
    expect(again.status).toBe(304);
  });

  it('moves a file through trash, restore and purge, and returns its quota', async () => {
    const client = await newClient().register();
    const file = await withFile(client, 'temp.txt', 'x'.repeat(1000));

    const before = await client.get('/api/files/stats');
    expect((await client.delete(`/api/files/${file.id}`)).status).toBe(204);

    const listed = await client.get('/api/files?scope=folder');
    expect(listed.body.items.find((f: { id: string }) => f.id === file.id)).toBeUndefined();

    const trash = await client.get('/api/files?scope=trash');
    expect(trash.body.items[0].id).toBe(file.id);

    // Trash still counts against quota — it is recoverable, not gone.
    const during = await client.get('/api/files/stats');
    expect(during.body.usedBytes).toBe(before.body.usedBytes);

    expect((await client.post('/api/files/actions/restore').send({ ids: [file.id] })).status).toBe(200);
    expect((await client.get('/api/files?scope=folder')).body.total).toBe(1);

    await client.delete(`/api/files/${file.id}`);
    expect((await client.post('/api/files/actions/purge').send({ ids: [file.id] })).body.purged).toBe(1);

    const after = await client.get('/api/files/stats');
    expect(after.body.usedBytes).toBe(before.body.usedBytes - 1000);
  });

  it('organises files in folders and refuses a folder cycle', async () => {
    const client = await newClient().register();
    const parent = (await client.post('/api/folders').send({ name: 'Projects' })).body.folder;
    const child = (await client.post('/api/folders').send({ name: 'Alpha', parentId: parent.id })).body.folder;

    const file = (await client.upload('spec.txt', 'spec', { folderId: child.id })).body.files[0];
    expect(file.folderId).toBe(child.id);

    const inFolder = await client.get(`/api/files?scope=folder&folderId=${child.id}`);
    expect(inFolder.body.total).toBe(1);

    const cycle = await client.patch(`/api/folders/${parent.id}`).send({ parentId: child.id });
    expect(cycle.status).toBe(400);

    const trail = await client.get(`/api/folders/${child.id}/breadcrumbs`);
    expect(trail.body.trail.map((t: { name: string }) => t.name)).toEqual(['Projects', 'Alpha']);
  });

  it('cannot be told to put a file in someone else’s folder', async () => {
    const owner = await newClient().register();
    const other = await newClient().register();
    const folder = (await owner.post('/api/folders').send({ name: 'Private' })).body.folder;

    const res = await other.upload('sneak.txt', 'x', { folderId: folder.id });
    expect(res.status).toBe(404);
    expect(res.body.error.details.rejected[0].code).toBe('not_found');
  });

  it('paginates deterministically with a cursor', async () => {
    const client = await newClient().register();
    for (let i = 0; i < 5; i += 1) await withFile(client, `file-${i}.txt`, `body ${i}`);

    const first = await client.get('/api/files?scope=all&limit=2&sort=name&dir=asc');
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await client.get(
      `/api/files?scope=all&limit=2&sort=name&dir=asc&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    );
    const names = [...first.body.items, ...second.body.items].map((f: { name: string }) => f.name);
    expect(names).toEqual(['file-0.txt', 'file-1.txt', 'file-2.txt', 'file-3.txt']);
    expect(new Set(names).size).toBe(4); // no repeats across pages
  });

  it('searches across folders by name', async () => {
    const client = await newClient().register();
    const folder = (await client.post('/api/folders').send({ name: 'Deep' })).body.folder;
    await client.upload('quarterly-forecast.csv', 'a,b', { folderId: folder.id });
    await withFile(client, 'unrelated.txt');

    const hits = await client.get('/api/files?scope=folder&q=forecast');
    expect(hits.body.items).toHaveLength(1);
    expect(hits.body.items[0].name).toBe('quarterly-forecast.csv');
  });
});

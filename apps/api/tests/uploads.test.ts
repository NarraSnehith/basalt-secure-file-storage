import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { isChunkUpload } from '../src/app.js';
import { binaryParser, closeAll, newClient, resetDatabase } from './helpers.js';

/** Deterministic bytes, so the same call always produces the same digest. */
function pattern(size: number, seed = 1): Buffer {
  const buffer = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) buffer[i] = (i * 31 + seed * 7) & 0xff;
  return buffer;
}

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

// One pool for the file: a per-describe afterAll would tear it down while the
// next block was still using it.
afterAll(closeAll);

describe('resumable uploads', () => {
  beforeEach(resetDatabase);

  /*
   * The global request limiter would otherwise break the feature it protects:
   * one resumable upload is around four hundred PUTs, so a handful of files in
   * a minute trips a 1200/minute cap. Chunks are exempt, bounded instead by
   * session validation and the per-account limit on open sessions.
   */
  it('exempts chunk uploads from the global request limiter', () => {
    expect(isChunkUpload({ method: 'PUT', path: '/uploads/abc/chunks/0' })).toBe(true);
    expect(isChunkUpload({ method: 'PUT', path: '/r/slug/uploads/abc/chunks/137' })).toBe(true);

    // Everything else still counts, including near-misses.
    expect(isChunkUpload({ method: 'POST', path: '/uploads/abc/chunks/0' })).toBe(false);
    expect(isChunkUpload({ method: 'PUT', path: '/uploads/abc/chunks/' })).toBe(false);
    expect(isChunkUpload({ method: 'PUT', path: '/uploads/abc/chunks/0/extra' })).toBe(false);
    expect(isChunkUpload({ method: 'PUT', path: '/files/abc' })).toBe(false);
  });

  it('splits a file into chunks and reassembles it byte-for-byte', async () => {
    const client = await newClient().register();
    const contents = pattern(700_000);

    const { opened, session, completed } = await client.chunkedUpload('scan.bin', contents);
    expect(opened.status).toBe(201);
    expect(session!.chunkCount).toBeGreaterThan(1);
    expect(completed!.status).toBe(201);

    const file = completed!.body.file;
    expect(file.sizeBytes).toBe(contents.length);
    expect(file.checksum).toBe(sha256(contents));

    const downloaded = await client.get(`/api/files/${file.id}/content`).buffer(true).parse(binaryParser);
    expect(Buffer.from(downloaded.body).equals(contents)).toBe(true);
  });

  it('reports what is missing and finishes after a resume', async () => {
    const client = await newClient().register();
    const contents = pattern(700_000, 2);

    // Simulate a connection that dropped partway: two chunks never arrive.
    const { session } = await client.chunkedUpload('interrupted.bin', contents, { skip: [1, 2] });
    expect(session).not.toBeNull();

    const status = await client.get(`/api/uploads/${session!.id}`);
    expect(status.body.session.missing).toEqual([1, 2]);
    expect(status.body.session.receivedCount).toBe(session!.chunkCount - 2);

    // Completing early must fail rather than store a file full of holes.
    const premature = await client.post(`/api/uploads/${session!.id}/complete`);
    expect(premature.status).toBe(400);
    expect(premature.body.error.details.missing).toEqual([1, 2]);

    const finished = await client.resume(session!.id, contents);
    expect(finished.status).toBe(201);

    const downloaded = await client
      .get(`/api/files/${finished.body.file.id}/content`)
      .buffer(true)
      .parse(binaryParser);
    expect(Buffer.from(downloaded.body).equals(contents)).toBe(true);
  });

  it('accepts a repeated chunk without double-counting it', async () => {
    const client = await newClient().register();
    const contents = pattern(600_000, 3);
    const opened = await client
      .post('/api/uploads')
      .send({ filename: 'repeat.bin', size: contents.length });
    const session = opened.body.session;

    const chunk = contents.subarray(0, session.chunkSize);
    for (const _ of [1, 2, 3]) {
      const res = await client
        .put(`/api/uploads/${session.id}/chunks/0`)
        .set('Content-Type', 'application/octet-stream')
        .send(chunk);
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(1);
    }
  });

  it('rejects a chunk of the wrong length, and lets it be resent', async () => {
    const client = await newClient().register();
    const contents = pattern(600_000, 4);
    const opened = await client.post('/api/uploads').send({ filename: 'short.bin', size: contents.length });
    const session = opened.body.session;

    const truncated = contents.subarray(0, session.chunkSize - 10);
    const bad = await client
      .put(`/api/uploads/${session.id}/chunks/0`)
      .set('Content-Type', 'application/octet-stream')
      .send(truncated);
    expect(bad.status).toBe(400);

    // The bit was never set, so chunk 0 is still outstanding.
    const status = await client.get(`/api/uploads/${session.id}`);
    expect(status.body.session.missing).toContain(0);

    const good = await client
      .put(`/api/uploads/${session.id}/chunks/0`)
      .set('Content-Type', 'application/octet-stream')
      .send(contents.subarray(0, session.chunkSize));
    expect(good.status).toBe(200);
  });

  it('rejects a chunk whose declared digest does not match its bytes', async () => {
    const client = await newClient().register();
    const contents = pattern(600_000, 5);
    const opened = await client.post('/api/uploads').send({ filename: 'corrupt.bin', size: contents.length });
    const session = opened.body.session;

    const res = await client
      .put(`/api/uploads/${session.id}/chunks/0`)
      .set('Content-Type', 'application/octet-stream')
      .set('X-Chunk-Sha256', sha256(Buffer.from('not this at all')))
      .send(contents.subarray(0, session.chunkSize));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/checksum/i);
  });

  it('refuses to store a file whose assembled hash contradicts the client', async () => {
    const client = await newClient().register();
    const contents = pattern(600_000, 6);

    // Declare the hash of *different* content and then send these bytes.
    const { completed } = await client.chunkedUpload('lying.bin', contents, {
      checksum: sha256(pattern(600_000, 99)),
    });
    expect(completed!.status).toBe(400);
    expect(completed!.body.error.message).toMatch(/checksum you declared/i);

    // Nothing was stored.
    expect((await client.get('/api/files?scope=all')).body.total).toBe(0);
  });

  it('keeps a session private to the account that opened it', async () => {
    const owner = await newClient().register();
    const other = await newClient().register();
    const contents = pattern(600_000, 7);

    const opened = await owner.post('/api/uploads').send({ filename: 'mine.bin', size: contents.length });
    const session = opened.body.session;

    expect((await other.get(`/api/uploads/${session.id}`)).status).toBe(404);
    expect(
      (
        await other
          .put(`/api/uploads/${session.id}/chunks/0`)
          .set('Content-Type', 'application/octet-stream')
          .send(contents.subarray(0, session.chunkSize))
      ).status,
    ).toBe(404);
    expect((await other.post(`/api/uploads/${session.id}/complete`)).status).toBe(404);
    expect((await other.delete(`/api/uploads/${session.id}`)).status).toBe(404);
  });

  it('refuses a session for a file that is too large before any bytes move', async () => {
    const client = await newClient().register();
    const res = await client.post('/api/uploads').send({ filename: 'huge.bin', size: 8 * 1024 * 1024 });
    expect(res.status).toBe(413);
  });

  it('refuses a session for a blocked extension before any bytes move', async () => {
    const client = await newClient().register();
    const res = await client.post('/api/uploads').send({ filename: 'shell.php', size: 1024 });
    expect(res.status).toBe(415);
  });

  it('cancels a session and forgets the partial bytes', async () => {
    const client = await newClient().register();
    const contents = pattern(600_000, 8);
    const opened = await client.post('/api/uploads').send({ filename: 'abandoned.bin', size: contents.length });
    const session = opened.body.session;

    await client
      .put(`/api/uploads/${session.id}/chunks/0`)
      .set('Content-Type', 'application/octet-stream')
      .send(contents.subarray(0, session.chunkSize));

    expect((await client.delete(`/api/uploads/${session.id}`)).status).toBe(204);
    const after = await client.get(`/api/uploads/${session.id}`);
    expect(after.body.session.status).toBe('aborted');
    expect((await client.get('/api/uploads')).body.sessions).toHaveLength(0);
  });
});

describe('content addressing', () => {
  beforeEach(resetDatabase);

  it('charges the same bytes once, however many files point at them', async () => {
    const client = await newClient().register();
    const contents = pattern(400_000, 11);

    const first = await client.upload('original.bin', contents);
    expect(first.status).toBe(201);
    const afterFirst = await client.get('/api/files/stats');

    const second = await client.upload('a-copy.bin', contents);
    expect(second.status).toBe(201);
    expect(second.body.deduped).toBe(1);

    const afterSecond = await client.get('/api/files/stats');
    expect(afterSecond.body.usedBytes).toBe(afterFirst.body.usedBytes);
    expect(afterSecond.body.fileCount).toBe(2);
    expect(afterSecond.body.dedupSavedBytes).toBe(contents.length);
  });

  it('keeps the surviving copy readable after its twin is deleted', async () => {
    const client = await newClient().register();
    const contents = pattern(300_000, 12);
    const keep = (await client.upload('keep.bin', contents)).body.files[0];
    const drop = (await client.upload('drop.bin', contents)).body.files[0];

    await client.delete(`/api/files/${drop.id}`);
    expect((await client.post('/api/files/actions/purge').send({ ids: [drop.id] })).body.purged).toBe(1);

    const downloaded = await client.get(`/api/files/${keep.id}/content`).buffer(true).parse(binaryParser);
    expect(downloaded.status).toBe(200);
    expect(Buffer.from(downloaded.body).equals(contents)).toBe(true);

    // The bytes were still referenced, so nothing was reclaimed.
    const stats = await client.get('/api/files/stats');
    expect(stats.body.usedBytes).toBe(contents.length);
  });

  it('finishes instantly when the client offers a hash we already hold', async () => {
    const client = await newClient().register();
    const contents = pattern(500_000, 13);
    await client.upload('first-copy.bin', contents);

    const { opened } = await client.chunkedUpload('second-copy.bin', contents, {
      checksum: sha256(contents),
    });

    expect(opened.status).toBe(201);
    expect(opened.body.instant).toBe(true);
    expect(opened.body.file.name).toBe('second-copy.bin');
    expect(opened.body.file.sizeBytes).toBe(contents.length);

    // No session was created: there was nothing to transfer.
    expect((await client.get('/api/uploads')).body.sessions).toHaveLength(0);

    const downloaded = await client
      .get(`/api/files/${opened.body.file.id}/content`)
      .buffer(true)
      .parse(binaryParser);
    expect(Buffer.from(downloaded.body).equals(contents)).toBe(true);
  });

  it('does not offer an instant upload for content another account holds', async () => {
    const contents = pattern(300_000, 14);
    const alice = await newClient().register();
    await alice.upload('alice.bin', contents);

    // Bob knows the hash but has never uploaded these bytes; he must transfer
    // them. Otherwise the instant response is an existence oracle over Alice's
    // drive.
    const bob = await newClient().register();
    const opened = await bob.post('/api/uploads').send({
      filename: 'probe.bin',
      size: contents.length,
      checksum: sha256(contents),
    });
    expect(opened.status).toBe(201);
    expect(opened.body.instant).toBe(false);
    expect(opened.body.session).toBeTruthy();
  });

  it('frees the bytes only when the last reference goes', async () => {
    const client = await newClient().register();
    const contents = pattern(250_000, 15);
    const one = (await client.upload('one.bin', contents)).body.files[0];
    const two = (await client.upload('two.bin', contents)).body.files[0];

    for (const id of [one.id, two.id]) await client.delete(`/api/files/${id}`);
    await client.post('/api/files/actions/purge').send({ ids: [one.id, two.id] });

    const stats = await client.get('/api/files/stats');
    expect(stats.body.usedBytes).toBe(0);
    expect(stats.body.fileCount).toBe(0);
  });
});

describe('version history', () => {
  beforeEach(resetDatabase);

  it('records every revision and can serve an older one', async () => {
    const client = await newClient().register();
    const file = (await client.upload('spec.txt', 'v1 contents', { contentType: 'text/plain' })).body.files[0];
    await client.upload('spec.txt', 'v2 contents', { contentType: 'text/plain' });
    const third = await client.upload('spec.txt', 'v3 contents', { contentType: 'text/plain' });

    expect(third.body.files[0].version).toBe(3);
    expect(third.body.files[0].versionCount).toBe(3);

    const { body } = await client.get(`/api/files/${file.id}/versions`);
    expect(body.versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(body.versions[0].current).toBe(true);

    const old = await client.get(`/api/files/${file.id}/content?version=1`).buffer(true).parse(binaryParser);
    expect(Buffer.from(old.body).toString()).toBe('v1 contents');

    const current = await client.get(`/api/files/${file.id}/content`).buffer(true).parse(binaryParser);
    expect(Buffer.from(current.body).toString()).toBe('v3 contents');
  });

  it('restores an old revision by appending it, never by discarding history', async () => {
    const client = await newClient().register();
    const file = (await client.upload('draft.txt', 'the good one', { contentType: 'text/plain' })).body.files[0];
    await client.upload('draft.txt', 'the regrettable one', { contentType: 'text/plain' });

    const restored = await client.post(`/api/files/${file.id}/versions/1/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.file.version).toBe(3); // appended, not rewound
    expect(restored.body.file.versionCount).toBe(3);

    const now = await client.get(`/api/files/${file.id}/content`).buffer(true).parse(binaryParser);
    expect(Buffer.from(now.body).toString()).toBe('the good one');

    // The regrettable one is still there to go back to.
    const two = await client.get(`/api/files/${file.id}/content?version=2`).buffer(true).parse(binaryParser);
    expect(Buffer.from(two.body).toString()).toBe('the regrettable one');
  });

  it('charges for each distinct revision but not for a repeated one', async () => {
    const client = await newClient().register();
    const a = pattern(200_000, 21);
    const b = pattern(200_000, 22);

    await client.upload('rolling.bin', a);
    const afterOne = (await client.get('/api/files/stats')).body.usedBytes;

    await client.upload('rolling.bin', b); // different bytes: charged
    const afterTwo = (await client.get('/api/files/stats')).body.usedBytes;
    expect(afterTwo).toBe(afterOne + b.length);

    await client.upload('rolling.bin', a); // back to the first content: free
    const afterThree = (await client.get('/api/files/stats')).body;
    expect(afterThree.usedBytes).toBe(afterTwo);
    expect(afterThree.versionBytes).toBeGreaterThan(0);
  });

  it('will not delete the current revision, and reclaims space for an old one', async () => {
    const client = await newClient().register();
    const a = pattern(200_000, 31);
    const b = pattern(200_000, 32);
    const file = (await client.upload('log.bin', a)).body.files[0];
    await client.upload('log.bin', b);

    const refused = await client.delete(`/api/files/${file.id}/versions/2`);
    expect(refused.status).toBe(409);

    const removed = await client.delete(`/api/files/${file.id}/versions/1`);
    expect(removed.status).toBe(200);
    expect(removed.body.freedBytes).toBe(a.length);

    const stats = await client.get('/api/files/stats');
    expect(stats.body.usedBytes).toBe(b.length);
    expect((await client.get(`/api/files/${file.id}/versions`)).body.versions).toHaveLength(1);
  });

  it('answers 404 for a version that does not exist', async () => {
    const client = await newClient().register();
    const file = (await client.upload('single.txt', 'only one', { contentType: 'text/plain' })).body.files[0];
    expect((await client.get(`/api/files/${file.id}/content?version=7`)).status).toBe(404);
    expect((await client.post(`/api/files/${file.id}/versions/7/restore`)).status).toBe(404);
  });

  it('keeps version history private to the owner', async () => {
    const owner = await newClient().register();
    const other = await newClient().register();
    const file = (await owner.upload('private.txt', 'v1', { contentType: 'text/plain' })).body.files[0];
    await owner.upload('private.txt', 'v2', { contentType: 'text/plain' });

    expect((await other.get(`/api/files/${file.id}/versions`)).status).toBe(404);
    expect((await other.post(`/api/files/${file.id}/versions/1/restore`)).status).toBe(404);
    expect((await other.delete(`/api/files/${file.id}/versions/1`)).status).toBe(404);
    expect((await other.get(`/api/files/${file.id}/content?version=1`)).status).toBe(404);
  });
});

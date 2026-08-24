import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { anon, closeAll, newClient, resetDatabase, type Client } from './helpers.js';

/**
 * Extraction happens after the upload responds — it reads the stored bytes back,
 * and making an upload wait for that would be the wrong trade. Tests poll for it
 * rather than reaching into internals, which also proves it actually completes.
 */
async function waitUntilIndexed(client: Client, fileId: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await client.get(`/api/files/${fileId}`);
    if (res.body.file?.searchable) return true;
    await new Promise((done) => setTimeout(done, 50));
  }
  return false;
}

afterAll(closeAll);

describe('content search', () => {
  beforeEach(resetDatabase);

  it('finds a file by a word inside it, not just by its name', async () => {
    const client = await newClient().register();
    const file = (
      await client.upload(
        'q3-minutes.md',
        '# Minutes\n\nApproved the acquisition of the Thelwall quarry site.\n',
        { contentType: 'text/markdown' },
      )
    ).body.files[0];

    expect(await waitUntilIndexed(client, file.id)).toBe(true);

    const hit = await client.get('/api/files?scope=all&q=Thelwall');
    expect(hit.body.items).toHaveLength(1);
    expect(hit.body.items[0].id).toBe(file.id);

    // A word in neither the name nor the contents finds nothing.
    expect((await client.get('/api/files?scope=all&q=basalt%20columns')).body.items).toHaveLength(0);
  });

  it('still matches a fragment of a filename, which full-text alone would miss', async () => {
    const client = await newClient().register();
    await client.upload('quarterly-forecast.csv', 'a,b\n1,2\n', { contentType: 'text/csv' });

    const hit = await client.get('/api/files?scope=all&q=forecas');
    expect(hit.body.items).toHaveLength(1);
    expect(hit.body.items[0].name).toBe('quarterly-forecast.csv');
  });

  it('does not index bytes it cannot read as text', async () => {
    const client = await newClient().register();
    const binary = Buffer.alloc(4096);
    for (let i = 0; i < binary.length; i += 1) binary[i] = (i * 97) & 0xff;
    const file = (await client.upload('sensor.bin', binary)).body.files[0];

    // Indexing still runs and completes; it simply stores nothing.
    await new Promise((done) => setTimeout(done, 400));
    const res = await client.get(`/api/files/${file.id}`);
    expect(res.body.file.searchable).toBe(false);
  });

  it('re-indexes when a new version replaces the contents', async () => {
    const client = await newClient().register();
    const file = (
      await client.upload('notes.txt', 'the original mentions gabbro', { contentType: 'text/plain' })
    ).body.files[0];
    expect(await waitUntilIndexed(client, file.id)).toBe(true);
    expect((await client.get('/api/files?scope=all&q=gabbro')).body.items).toHaveLength(1);

    await client.upload('notes.txt', 'the revision mentions andesite instead', { contentType: 'text/plain' });
    expect(await waitUntilIndexed(client, file.id)).toBe(true);

    expect((await client.get('/api/files?scope=all&q=andesite')).body.items).toHaveLength(1);
    expect((await client.get('/api/files?scope=all&q=gabbro')).body.items).toHaveLength(0);
  });

  it('keeps one account’s contents out of another account’s results', async () => {
    const alice = await newClient().register();
    const file = (
      await alice.upload('private.md', 'the passphrase is opalescent', { contentType: 'text/markdown' })
    ).body.files[0];
    expect(await waitUntilIndexed(alice, file.id)).toBe(true);

    const bob = await newClient().register();
    expect((await bob.get('/api/files?scope=all&q=opalescent')).body.items).toHaveLength(0);
  });
});

describe('storage insights', () => {
  beforeEach(resetDatabase);

  it('reports the largest files and the duplicated ones', async () => {
    const client = await newClient().register();
    const big = Buffer.alloc(400_000, 3);
    const small = Buffer.alloc(1000, 4);

    await client.upload('big.bin', big);
    await client.upload('big-again.bin', big); // same bytes, different name
    await client.upload('small.bin', small);

    const { body } = await client.get('/api/insights');
    expect(body.largest[0].name).toMatch(/^big/);
    expect(body.duplicates).toHaveLength(1);
    expect(body.duplicates[0].files.map((f: { name: string }) => f.name).sort()).toEqual([
      'big-again.bin',
      'big.bin',
    ]);
    // Content addressing means the copy cost nothing, and the report says so.
    expect(body.duplicates[0].wastedBytes).toBe(0);
    expect(body.dedupSavedBytes).toBe(big.length);
  });

  it('reports what version history is costing', async () => {
    const client = await newClient().register();
    await client.upload('rolling.bin', Buffer.alloc(200_000, 1));
    await client.upload('rolling.bin', Buffer.alloc(200_000, 2));

    const { body } = await client.get('/api/insights');
    expect(body.versionHeavy).toHaveLength(1);
    expect(body.versionHeavy[0].name).toBe('rolling.bin');
    expect(body.versionHeavy[0].versionCount).toBe(2);
    expect(body.versionHeavy[0].historyBytes).toBe(200_000);
    expect(body.reclaimable.versionBytes).toBe(200_000);
  });

  it('counts what the trash is holding on to', async () => {
    const client = await newClient().register();
    const file = (await client.upload('doomed.bin', Buffer.alloc(50_000, 7))).body.files[0];
    await client.delete(`/api/files/${file.id}`);

    const { body } = await client.get('/api/insights');
    expect(body.reclaimable.trashCount).toBe(1);
    expect(body.reclaimable.trashBytes).toBe(50_000);
  });

  it('is scoped to the caller', async () => {
    const alice = await newClient().register();
    await alice.upload('alice.bin', Buffer.alloc(90_000, 5));

    const bob = await newClient().register();
    const { body } = await bob.get('/api/insights');
    expect(body.largest).toHaveLength(0);
    expect(body.duplicates).toHaveLength(0);
  });
});

describe('share receipts', () => {
  beforeEach(resetDatabase);

  it('records who opened a link and when', async () => {
    const client = await newClient().register();
    const file = (await client.upload('poster.txt', 'look at me', { contentType: 'text/plain' })).body.files[0];
    const share = (await client.post('/api/shares').send({ fileId: file.id })).body.share;

    await anon().get(`/api/s/${share.slug}`);
    await anon().get(`/api/s/${share.slug}/content`);

    const { body } = await client.get(`/api/shares/${share.id}/receipts`);
    const types = body.receipts.map((r: { type: string }) => r.type);
    expect(types).toContain('share.view');
    expect(types).toContain('share.download');
    expect(body.receipts[0].anonymous).toBe(true);
    expect(body.receipts[0].ip).toBeTruthy();
  });

  it('records a failed password attempt', async () => {
    const client = await newClient().register();
    const file = (await client.upload('sealed.txt', 'nope', { contentType: 'text/plain' })).body.files[0];
    const share = (await client.post('/api/shares').send({ fileId: file.id, password: 'granite-seam' })).body
      .share;

    await anon().post(`/api/s/${share.slug}/unlock`).send({ password: 'guessing' });

    const { body } = await client.get(`/api/shares/${share.id}/receipts`);
    expect(body.receipts.some((r: { type: string }) => r.type === 'share.denied')).toBe(true);
  });

  it('returns nothing for a link that is not yours', async () => {
    const owner = await newClient().register();
    const other = await newClient().register();
    const file = (await owner.upload('mine.txt', 'mine', { contentType: 'text/plain' })).body.files[0];
    const share = (await owner.post('/api/shares').send({ fileId: file.id })).body.share;
    await anon().get(`/api/s/${share.slug}`);

    expect((await other.get(`/api/shares/${share.id}/receipts`)).body.receipts).toHaveLength(0);
  });
});

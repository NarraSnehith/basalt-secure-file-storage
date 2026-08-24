import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { anon, binaryParser, closeAll, newClient, resetDatabase, type Client } from './helpers.js';

async function publicFile(client: Client, name = 'poster.txt', body = 'public bytes') {
  const file = (await client.upload(name, body, { contentType: 'text/plain' })).body.files[0];
  const res = await client.patch(`/api/files/${file.id}`).send({ visibility: 'public' });
  expect(res.status).toBe(200);
  return { file: res.body.file, shares: res.body.shares };
}

describe('sharing', () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it('makes a file reachable by anyone once it is public', async () => {
    const client = await newClient().register();
    const { file } = await publicFile(client);
    const slug = file.publicUrl.split('/f/')[1];

    const meta = await anon().get(`/api/s/${slug}`);
    expect(meta.status).toBe(200);
    expect(meta.body.share.file.name).toBe('poster.txt');
    expect(meta.body.share.ownerName).toBe('Test User');

    const bytes = await anon().get(`/api/s/${slug}/content`).redirects(1).buffer(true).parse(binaryParser);
    expect(bytes.status).toBe(200);
    expect(Buffer.from(bytes.body).toString()).toBe('public bytes');
    expect(bytes.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('keeps a private file unreachable even with a guessed slug', async () => {
    const client = await newClient().register();
    const file = (await client.upload('secret.txt', 'nope')).body.files[0];
    expect(file.visibility).toBe('private');
    expect(file.publicUrl).toBeNull();
    expect((await anon().get('/api/s/abcdefgh1234')).status).toBe(404);
  });

  it('revokes every link the moment the file goes private again', async () => {
    const client = await newClient().register();
    const { file } = await publicFile(client);
    const slug = file.publicUrl.split('/f/')[1];
    expect((await anon().get(`/api/s/${slug}/content`).redirects(1)).status).toBe(200);

    await client.patch(`/api/files/${file.id}`).send({ visibility: 'private' });
    expect((await anon().get(`/api/s/${slug}/content`).redirects(1)).status).toBe(404);
    expect((await anon().get(`/api/s/${slug}`)).status).toBe(404);
  });

  it('revokes links when the file is trashed', async () => {
    const client = await newClient().register();
    const { file } = await publicFile(client);
    const slug = file.publicUrl.split('/f/')[1];

    await client.delete(`/api/files/${file.id}`);
    expect((await anon().get(`/api/s/${slug}/content`).redirects(1)).status).toBe(404);
  });

  it('hides even the filename behind a password, and lets a grant through', async () => {
    const client = await newClient().register();
    const file = (await client.upload('nda.txt', 'confidential')).body.files[0];
    const share = (
      await client.post('/api/shares').send({ fileId: file.id, password: 'granite-seam', allowPreview: true })
    ).body.share;

    const locked = await anon().get(`/api/s/${share.slug}`);
    expect(locked.body.share.requiresPassword).toBe(true);
    expect(locked.body.share.file).toBeUndefined();

    expect((await anon().get(`/api/s/${share.slug}/content`).redirects(1)).status).toBe(401);

    const wrong = await anon().post(`/api/s/${share.slug}/unlock`).send({ password: 'wrong-one' });
    expect(wrong.status).toBe(403);

    const unlock = await anon().post(`/api/s/${share.slug}/unlock`).send({ password: 'granite-seam' });
    expect(unlock.status).toBe(200);

    const withGrant = await anon()
      .get(`/api/s/${share.slug}/content`).redirects(1)
      .set('X-Share-Grant', unlock.body.grant)
      .redirects(1).buffer(true).parse(binaryParser);
    expect(withGrant.status).toBe(200);
    expect(Buffer.from(withGrant.body).toString()).toBe('confidential');
  });

  it('will not accept a grant issued for a different link', async () => {
    const client = await newClient().register();
    const a = (await client.upload('a.txt', 'aaa')).body.files[0];
    const b = (await client.upload('b.txt', 'bbb')).body.files[0];
    const shareA = (await client.post('/api/shares').send({ fileId: a.id, password: 'password-one' })).body.share;
    const shareB = (await client.post('/api/shares').send({ fileId: b.id, password: 'password-two' })).body.share;

    const grantA = (await anon().post(`/api/s/${shareA.slug}/unlock`).send({ password: 'password-one' })).body.grant;
    const crossUse = await anon().get(`/api/s/${shareB.slug}/content`).redirects(1).set('X-Share-Grant', grantA);
    expect(crossUse.status).toBe(401);
  });

  it('stops serving once the download budget is spent', async () => {
    const client = await newClient().register();
    const file = (await client.upload('limited.txt', 'one shot')).body.files[0];
    const share = (await client.post('/api/shares').send({ fileId: file.id, maxDownloads: 1 })).body.share;

    expect((await anon().get(`/api/s/${share.slug}/content`).redirects(1)).status).toBe(200);
    const second = await anon().get(`/api/s/${share.slug}/content`).redirects(1);
    expect(second.status).toBe(410);
    expect(second.body.error.code).toBe('share_exhausted');
  });

  it('stops serving after the expiry moment', async () => {
    const { db } = await import('../src/db/client.js');
    const client = await newClient().register();
    const file = (await client.upload('soon.txt', 'expiring')).body.files[0];
    const share = (
      await client.post('/api/shares').send({ fileId: file.id, expiresAt: new Date(Date.now() + 3_600_000) })
    ).body.share;

    expect((await anon().get(`/api/s/${share.slug}`)).status).toBe(200);

    await db.updateTable('share_links').set({ expires_at: new Date(Date.now() - 1000) }).where('id', '=', share.id).execute();

    const res = await anon().get(`/api/s/${share.slug}`);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('share_expired');
  });

  it('refuses inline preview when the owner turned it off', async () => {
    const client = await newClient().register();
    const file = (await client.upload('view.txt', 'no peeking', { contentType: 'text/plain' })).body.files[0];
    const share = (await client.post('/api/shares').send({ fileId: file.id, allowPreview: false })).body.share;

    expect((await anon().get(`/api/s/${share.slug}/content?disposition=inline`).redirects(1)).status).toBe(403);
    expect((await anon().get(`/api/s/${share.slug}/content`).redirects(1)).status).toBe(200);
  });

  it('only lets the owner manage a link', async () => {
    const owner = await newClient().register();
    const other = await newClient().register();
    const file = (await owner.upload('mine.txt', 'mine')).body.files[0];
    const share = (await owner.post('/api/shares').send({ fileId: file.id })).body.share;

    expect((await other.patch(`/api/shares/${share.id}`).send({ label: 'hijacked' })).status).toBe(404);
    expect((await other.delete(`/api/shares/${share.id}`)).status).toBe(404);
    expect((await owner.delete(`/api/shares/${share.id}`)).status).toBe(204);
    expect((await anon().get(`/api/s/${share.slug}`)).status).toBe(404);
  });

  it('records who touched a shared file, for the owner to read', async () => {
    const client = await newClient().register();
    const { file } = await publicFile(client, 'audited.txt', 'watch me');
    const slug = file.publicUrl.split('/f/')[1];
    await anon().get(`/api/s/${slug}/content`).redirects(1);

    const feed = await client.get('/api/activity?limit=50');
    const types = feed.body.items.map((e: { type: string }) => e.type);
    expect(types).toContain('share.download');
    expect(types).toContain('file.upload');
  });
});

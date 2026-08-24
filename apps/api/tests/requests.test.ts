import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { anon, closeAll, newClient, resetDatabase, type Client } from './helpers.js';

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

/** Send a file through a request link the way a stranger's browser would. */
async function send(
  slug: string,
  filename: string,
  contents: Buffer,
  opts: { submitter?: string; grant?: string; checksum?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.grant) headers['X-Request-Grant'] = opts.grant;

  const opened = await anon()
    .post(`/api/r/${slug}/uploads`)
    .set(headers)
    .send({
      filename,
      size: contents.length,
      declaredMime: 'application/octet-stream',
      submitter: opts.submitter ?? null,
      checksum: opts.checksum ?? null,
    });
  if (opened.status !== 201 || opened.body.instant) return { opened, completed: opened };

  const session = opened.body.session as { id: string; chunkSize: number; chunkCount: number };
  for (let index = 0; index < session.chunkCount; index += 1) {
    const start = index * session.chunkSize;
    const chunk = contents.subarray(start, Math.min(start + session.chunkSize, contents.length));
    const put = await anon()
      .put(`/api/r/${slug}/uploads/${session.id}/chunks/${index}`)
      .set({ ...headers, 'Content-Type': 'application/octet-stream' })
      .send(chunk);
    if (put.status !== 200) return { opened, completed: put };
  }

  const completed = await anon()
    .post(`/api/r/${slug}/uploads/${session.id}/complete`)
    .set(headers)
    .send({ submitter: opts.submitter ?? null });
  return { opened, session, completed };
}

async function ownerWithRequest(
  overrides: Record<string, unknown> = {},
): Promise<{ owner: Client; folderId: string; slug: string; id: string }> {
  const owner = await newClient().register();
  const folder = (await owner.post('/api/folders').send({ name: 'Inbox' })).body.folder;
  const res = await owner.post('/api/requests').send({
    folderId: folder.id,
    title: 'Send me the signed contract',
    message: 'PDF please, by Friday.',
    ...overrides,
  });
  expect(res.status).toBe(201);
  return { owner, folderId: folder.id, slug: res.body.request.slug, id: res.body.request.id };
}

afterAll(closeAll);

describe('file requests', () => {
  beforeEach(resetDatabase);

  it('lets a stranger upload into a folder without an account', async () => {
    const { owner, folderId, slug } = await ownerWithRequest();
    const contents = Buffer.from('the signed contract, at last');

    const view = await anon().get(`/api/r/${slug}`);
    expect(view.status).toBe(200);
    expect(view.body.request.title).toBe('Send me the signed contract');
    expect(view.body.request.ownerName).toBe('Test User');

    const { completed } = await send(slug, 'contract.pdf', contents, { submitter: 'Jordan Ellis' });
    expect(completed.status).toBe(201);
    expect(completed.body.received.filename).toBe('contract.pdf');
    expect(completed.body.received.checksum).toBe(sha256(contents));

    // It landed in the owner's folder, attributed to the request.
    const listed = await owner.get(`/api/files?scope=folder&folderId=${folderId}`);
    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0].name).toBe('contract.pdf');
    expect(listed.body.items[0].requestId).toBeTruthy();
  });

  it('gives the owner an inbox of who sent what', async () => {
    const { owner, slug, id } = await ownerWithRequest();
    await send(slug, 'a.txt', Buffer.from('from ada'), { submitter: 'Ada' });
    await send(slug, 'b.txt', Buffer.from('from bo'), { submitter: 'Bo' });

    const { body } = await owner.get(`/api/requests/${id}/submissions`);
    expect(body.submissions).toHaveLength(2);
    expect(body.submissions.map((s: { submitter: string }) => s.submitter).sort()).toEqual(['Ada', 'Bo']);
    expect(body.submissions[0].present).toBe(true);
    expect(body.submissions[0].ip).toBeTruthy();
  });

  it('never lets a sender overwrite what the owner already has', async () => {
    const { owner, folderId, slug } = await ownerWithRequest();
    await owner.upload('report.txt', 'the owner’s own copy', { folderId, contentType: 'text/plain' });

    const { completed } = await send(slug, 'report.txt', Buffer.from('a stranger’s copy'));
    expect(completed.status).toBe(201);
    expect(completed.body.received.filename).toBe('report (2).txt');

    // The owner's file is untouched and still on version 1.
    const listed = await owner.get(`/api/files?scope=folder&folderId=${folderId}`);
    expect(listed.body.total).toBe(2);
    const original = listed.body.items.find((f: { name: string }) => f.name === 'report.txt');
    expect(original.version).toBe(1);
  });

  it('enforces the file count limit', async () => {
    const { slug } = await ownerWithRequest({ maxFiles: 2 });
    expect((await send(slug, 'one.txt', Buffer.from('1'))).completed.status).toBe(201);
    expect((await send(slug, 'two.txt', Buffer.from('2'))).completed.status).toBe(201);

    const third = await send(slug, 'three.txt', Buffer.from('3'));
    expect(third.opened.status).toBe(410);
    expect(third.opened.body.error.code).toBe('share_exhausted');
  });

  it('enforces the total size limit before accepting bytes', async () => {
    const { slug } = await ownerWithRequest({ maxBytes: 4096 });
    const tooBig = await anon()
      .post(`/api/r/${slug}/uploads`)
      .send({ filename: 'big.bin', size: 9000 });
    expect(tooBig.status).toBe(410);
    expect(tooBig.body.error.message).toMatch(/larger than the .* left on this link/i);
  });

  it('gives the room back when a sender abandons an upload', async () => {
    const { owner, slug, id } = await ownerWithRequest({ maxFiles: 1 });
    const opened = await anon().post(`/api/r/${slug}/uploads`).send({ filename: 'ghost.bin', size: 500_000 });
    expect(opened.status).toBe(201);

    // The slot is reserved, so a second sender is turned away…
    expect((await anon().post(`/api/r/${slug}/uploads`).send({ filename: 'other.bin', size: 10 })).status).toBe(410);

    // …until the first one gives up.
    expect((await anon().delete(`/api/r/${slug}/uploads/${opened.body.session.id}`)).status).toBe(204);
    expect((await anon().post(`/api/r/${slug}/uploads`).send({ filename: 'other.bin', size: 10 })).status).toBe(201);

    const { body } = await owner.get('/api/requests');
    expect(body.requests.find((r: { id: string }) => r.id === id).submissionCount).toBe(1);
  });

  it('hides the title behind a password and requires a grant to upload', async () => {
    const { slug } = await ownerWithRequest({ password: 'iron-gate-7' });

    const locked = await anon().get(`/api/r/${slug}`);
    expect(locked.body.request.requiresPassword).toBe(true);
    expect(locked.body.request.title).toBeUndefined();

    const refused = await anon().post(`/api/r/${slug}/uploads`).send({ filename: 'x.txt', size: 10 });
    expect(refused.status).toBe(401);

    expect((await anon().post(`/api/r/${slug}/unlock`).send({ password: 'wrong' })).status).toBe(403);

    const unlock = await anon().post(`/api/r/${slug}/unlock`).send({ password: 'iron-gate-7' });
    expect(unlock.status).toBe(200);

    const opened = await anon().get(`/api/r/${slug}`).set('X-Request-Grant', unlock.body.grant);
    expect(opened.body.request.title).toBe('Send me the signed contract');

    const { completed } = await send(slug, 'secret.txt', Buffer.from('behind the gate'), {
      grant: unlock.body.grant,
    });
    expect(completed.status).toBe(201);
  });

  it('will not accept a grant issued for another link', async () => {
    const a = await ownerWithRequest({ password: 'first-gate-1' });
    const b = await ownerWithRequest({ password: 'second-gate-2' });
    const grant = (await anon().post(`/api/r/${a.slug}/unlock`).send({ password: 'first-gate-1' })).body.grant;

    const res = await anon()
      .post(`/api/r/${b.slug}/uploads`)
      .set('X-Request-Grant', grant)
      .send({ filename: 'x.txt', size: 10 });
    expect(res.status).toBe(401);
  });

  it('stops working the moment the owner revokes it', async () => {
    const { owner, slug, id } = await ownerWithRequest();
    expect((await anon().get(`/api/r/${slug}`)).status).toBe(200);

    expect((await owner.delete(`/api/requests/${id}`)).status).toBe(204);
    expect((await anon().get(`/api/r/${slug}`)).status).toBe(404);
    expect((await anon().post(`/api/r/${slug}/uploads`).send({ filename: 'x.txt', size: 10 })).status).toBe(404);
  });

  it('stops working after its expiry', async () => {
    const { db } = await import('../src/db/client.js');
    const { slug, id } = await ownerWithRequest({ expiresAt: new Date(Date.now() + 3_600_000) });
    expect((await anon().get(`/api/r/${slug}`)).status).toBe(200);

    await db.updateTable('file_requests').set({ expires_at: new Date(Date.now() - 1000) }).where('id', '=', id).execute();
    const res = await anon().get(`/api/r/${slug}`);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('share_expired');
  });

  it('charges the owner’s quota, not the sender’s', async () => {
    const { owner, slug } = await ownerWithRequest();
    const before = (await owner.get('/api/files/stats')).body.usedBytes;
    const contents = Buffer.alloc(300_000, 9);

    expect((await send(slug, 'payload.bin', contents)).completed.status).toBe(201);

    const after = (await owner.get('/api/files/stats')).body.usedBytes;
    expect(after).toBe(before + contents.length);
  });

  it('keeps the request private to its owner', async () => {
    const { id } = await ownerWithRequest();
    const other = await newClient().register();

    expect((await other.get(`/api/requests/${id}/submissions`)).status).toBe(404);
    expect((await other.patch(`/api/requests/${id}`).send({ title: 'hijacked' })).status).toBe(404);
    expect((await other.delete(`/api/requests/${id}`)).status).toBe(404);
    expect((await other.get('/api/requests')).body.requests).toHaveLength(0);
  });

  it('tells a sender nothing about the drive they uploaded into', async () => {
    const { slug } = await ownerWithRequest();
    const { completed } = await send(slug, 'blind.txt', Buffer.from('no peeking'));

    // Only an echo of what was sent — no id, no folder, no owner internals.
    expect(Object.keys(completed.body)).toEqual(['received']);
    expect(Object.keys(completed.body.received).sort()).toEqual(['checksum', 'filename', 'sizeBytes']);
  });
});

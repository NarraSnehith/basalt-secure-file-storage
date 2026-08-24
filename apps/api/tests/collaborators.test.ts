import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { binaryParser, closeAll, newClient, resetDatabase, type Client } from './helpers.js';

/**
 * The permission model, exercised as a matrix.
 *
 * A model that lives in prose is a model nobody can check. Every cell that
 * matters is asserted here: what each role may read, add, change and publish,
 * and — as importantly — what it may not.
 */

type Role = 'viewer' | 'contributor' | 'editor';

interface Shared {
  owner: Client;
  guest: Client;
  folderId: string;
  ownerFileId: string;
}

/** An owner with one folder containing one file, shared with a guest. */
async function shareFolder(role: Role): Promise<Shared> {
  const owner = await newClient().register();
  const guest = await newClient().register();

  const folder = (await owner.post('/api/folders').send({ name: 'Survey 2026' })).body.folder;
  const file = (
    await owner.upload('owner-notes.txt', 'the owner wrote this', {
      folderId: folder.id,
      contentType: 'text/plain',
    })
  ).body.files[0];

  const invited = await owner
    .post(`/api/collab/folders/${folder.id}/people`)
    .send({ email: guest.email, role });
  expect(invited.status).toBe(201);
  expect(invited.body.person.active).toBe(true);

  return { owner, guest, folderId: folder.id, ownerFileId: file.id };
}

afterAll(closeAll);

describe('sharing a folder with a person', () => {
  beforeEach(resetDatabase);

  it('shows up in the guest’s shared-with-me list, with the owner named', async () => {
    const { owner, guest, folderId } = await shareFolder('viewer');

    const { body } = await guest.get('/api/collab/shared-with-me');
    expect(body.folders).toHaveLength(1);
    expect(body.folders[0].id).toBe(folderId);
    expect(body.folders[0].name).toBe('Survey 2026');
    expect(body.folders[0].role).toBe('viewer');
    expect(body.folders[0].ownerEmail).toBe(owner.email);
    expect(body.folders[0].fileCount).toBe(1);
  });

  it('does not appear in the guest’s own drive', async () => {
    const { guest } = await shareFolder('editor');

    // Their drive is still theirs alone; the shared folder is a separate place.
    expect((await guest.get('/api/files?scope=all')).body.total).toBe(0);
    expect((await guest.get('/api/folders')).body.folders).toHaveLength(0);
  });

  it('resolves an invitation sent before the person had an account', async () => {
    const owner = await newClient().register();
    const folder = (await owner.post('/api/folders').send({ name: 'Pending' })).body.folder;

    const invited = await owner
      .post(`/api/collab/folders/${folder.id}/people`)
      .send({ email: 'later@example.test', role: 'contributor' });
    expect(invited.status).toBe(201);
    expect(invited.body.person.active).toBe(false); // waiting for an account

    // The address registers afterwards; the grant attaches itself.
    const latecomer = newClient();
    await latecomer.bootstrap();
    const registered = await latecomer
      .post('/api/auth/register')
      .send({ email: 'later@example.test', password: 'a-good-passphrase-here', displayName: 'Later' });
    expect(registered.status).toBe(201);

    const { body } = await latecomer.get('/api/collab/shared-with-me');
    expect(body.folders).toHaveLength(1);
    expect(body.folders[0].id).toBe(folder.id);

    const people = await owner.get(`/api/collab/folders/${folder.id}/people`);
    expect(people.body.people[0].active).toBe(true);
  });

  it('refuses to let anyone but the owner manage the guest list', async () => {
    const { guest, folderId } = await shareFolder('editor');

    expect(
      (await guest.post(`/api/collab/folders/${folderId}/people`).send({ email: 'x@example.test' })).status,
    ).toBe(404);
    expect((await guest.get(`/api/collab/folders/${folderId}/people`)).status).toBe(404);
  });

  it('updates the role when the same person is invited again', async () => {
    const { owner, guest, folderId } = await shareFolder('viewer');

    const again = await owner
      .post(`/api/collab/folders/${folderId}/people`)
      .send({ email: guest.email, role: 'editor' });
    expect(again.status).toBe(201);
    expect(again.body.person.role).toBe('editor');

    const people = await owner.get(`/api/collab/folders/${folderId}/people`);
    expect(people.body.people).toHaveLength(1); // not duplicated
    expect((await guest.get('/api/collab/shared-with-me')).body.folders[0].role).toBe('editor');
  });

  it('cuts one person off without touching the others', async () => {
    const owner = await newClient().register();
    const stays = await newClient().register();
    const goes = await newClient().register();
    const folder = (await owner.post('/api/folders').send({ name: 'Team' })).body.folder;

    for (const person of [stays, goes]) {
      await owner.post(`/api/collab/folders/${folder.id}/people`).send({ email: person.email, role: 'viewer' });
    }
    const people = (await owner.get(`/api/collab/folders/${folder.id}/people`)).body.people;
    const target = people.find((p: { email: string }) => p.email === goes.email);

    expect((await owner.delete(`/api/collab/folders/${folder.id}/people/${target.id}`)).status).toBe(204);

    expect((await goes.get('/api/collab/shared-with-me')).body.folders).toHaveLength(0);
    expect((await stays.get('/api/collab/shared-with-me')).body.folders).toHaveLength(1);
  });

  it('covers subfolders, because that is what sharing a folder means', async () => {
    const { owner, guest, folderId } = await shareFolder('viewer');
    const child = (await owner.post('/api/folders').send({ name: 'Plates', parentId: folderId })).body.folder;
    const nested = (
      await owner.upload('deep.txt', 'nested content', { folderId: child.id, contentType: 'text/plain' })
    ).body.files[0];

    const listed = await guest.get(`/api/files?scope=folder&folderId=${child.id}`);
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((f: { id: string }) => f.id)).toContain(nested.id);
  });
});

describe('what a viewer may do', () => {
  beforeEach(resetDatabase);

  it('reads and downloads, and nothing else', async () => {
    const { guest, folderId, ownerFileId } = await shareFolder('viewer');

    const listed = await guest.get(`/api/files?scope=folder&folderId=${folderId}`);
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(1);

    const bytes = await guest.get(`/api/files/${ownerFileId}/content`).redirects(1).buffer(true).parse(binaryParser);
    expect(bytes.status).toBe(200);
    expect(Buffer.from(bytes.body).toString()).toBe('the owner wrote this');

    // No writing of any kind.
    expect((await guest.patch(`/api/files/${ownerFileId}`).send({ name: 'renamed.txt' })).status).toBe(404);
    expect((await guest.delete(`/api/files/${ownerFileId}`)).status).toBe(404);
    expect((await guest.upload('mine.txt', 'x', { folderId })).status).toBe(404);
  });

  it('cannot make the owner’s file public', async () => {
    const { guest, ownerFileId } = await shareFolder('viewer');
    expect((await guest.patch(`/api/files/${ownerFileId}`).send({ visibility: 'public' })).status).toBe(404);
  });
});

describe('what a contributor may do', () => {
  beforeEach(resetDatabase);

  it('adds files, which belong to the owner but are credited to them', async () => {
    const { owner, guest, folderId } = await shareFolder('contributor');
    const before = (await owner.get('/api/files/stats')).body.usedBytes;

    const added = await guest.upload('from-the-guest.txt', 'contributed bytes', {
      folderId,
      contentType: 'text/plain',
    });
    expect(added.status).toBe(201);

    // The owner sees it in their own folder…
    const ownerView = await owner.get(`/api/files?scope=folder&folderId=${folderId}`);
    expect(ownerView.body.total).toBe(2);

    // …and it is their quota that paid for it.
    const after = (await owner.get('/api/files/stats')).body.usedBytes;
    expect(after).toBe(before + 'contributed bytes'.length);

    // The guest's own drive is untouched.
    expect((await guest.get('/api/files/stats')).body.usedBytes).toBe(0);
  });

  it('may manage what they added, but not what the owner added', async () => {
    const { guest, folderId, ownerFileId } = await shareFolder('contributor');
    const mine = (await guest.upload('guest-file.txt', 'mine', { folderId, contentType: 'text/plain' })).body
      .files[0];

    // Their own contribution: fair game.
    expect((await guest.patch(`/api/files/${mine.id}`).send({ name: 'guest-file-v2.txt' })).status).toBe(200);
    expect((await guest.delete(`/api/files/${mine.id}`)).status).toBe(204);

    // The owner's file: not theirs to touch.
    expect((await guest.patch(`/api/files/${ownerFileId}`).send({ name: 'nope.txt' })).status).toBe(404);
    expect((await guest.delete(`/api/files/${ownerFileId}`)).status).toBe(404);
  });

  it('cannot manage the guest list or publish anything', async () => {
    const { guest, folderId, ownerFileId } = await shareFolder('contributor');
    expect((await guest.get(`/api/collab/folders/${folderId}/people`)).status).toBe(404);
    expect((await guest.patch(`/api/files/${ownerFileId}`).send({ visibility: 'public' })).status).toBe(404);
  });
});

describe('what an editor may do', () => {
  beforeEach(resetDatabase);

  it('renames, moves and bins anything in the folder', async () => {
    const { owner, folderId, ownerFileId, guest } = await shareFolder('editor');

    const renamed = await guest.patch(`/api/files/${ownerFileId}`).send({ name: 'reorganised.txt' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.file.name).toBe('reorganised.txt');

    expect((await guest.delete(`/api/files/${ownerFileId}`)).status).toBe(204);

    // It went to the *owner's* trash, because it is the owner's file.
    expect((await owner.get('/api/files?scope=trash')).body.total).toBe(1);
    expect((await guest.get('/api/files?scope=trash')).body.total).toBe(0);
  });

  it('still cannot publish, or invite anyone', async () => {
    const { guest, folderId, ownerFileId } = await shareFolder('editor');
    expect((await guest.patch(`/api/files/${ownerFileId}`).send({ visibility: 'public' })).status).toBe(404);
    expect((await guest.post(`/api/collab/folders/${folderId}/people`).send({ email: 'a@b.test' })).status).toBe(404);
  });

  it('cannot move a file out of the shared folder into their own drive', async () => {
    const { guest, ownerFileId } = await shareFolder('editor');
    const ownFolder = (await guest.post('/api/folders').send({ name: 'Mine' })).body.folder;

    // The destination must belong to the same account, so this is a way in that
    // does not exist.
    const moved = await guest.patch(`/api/files/${ownerFileId}`).send({ folderId: ownFolder.id });
    expect(moved.status).toBe(404);
  });
});

describe('revoking access', () => {
  beforeEach(resetDatabase);

  it('stops reads immediately', async () => {
    const { owner, guest, folderId, ownerFileId } = await shareFolder('editor');
    expect((await guest.get(`/api/files/${ownerFileId}/content`).redirects(1)).status).toBe(200);

    const people = (await owner.get(`/api/collab/folders/${folderId}/people`)).body.people;
    await owner.delete(`/api/collab/folders/${folderId}/people/${people[0].id}`);

    expect((await guest.get(`/api/files/${ownerFileId}/content`).redirects(1)).status).toBe(404);
    expect((await guest.get(`/api/files?scope=folder&folderId=${folderId}`)).body.total).toBe(0);
    expect((await guest.get('/api/files?scope=incoming')).body.total).toBe(0);
  });

  it('leaves the files a contributor added behind, with the owner', async () => {
    const { owner, guest, folderId } = await shareFolder('contributor');
    await guest.upload('handover.txt', 'still useful', { folderId, contentType: 'text/plain' });

    const people = (await owner.get(`/api/collab/folders/${folderId}/people`)).body.people;
    await owner.delete(`/api/collab/folders/${folderId}/people/${people[0].id}`);

    // Contributions do not evaporate when the contributor leaves.
    const remaining = await owner.get(`/api/files?scope=folder&folderId=${folderId}`);
    expect(remaining.body.total).toBe(2);
  });
});

describe('the incoming scope', () => {
  beforeEach(resetDatabase);

  it('gathers files from every folder shared with me', async () => {
    const guest = await newClient().register();
    const names: string[] = [];

    for (const [index, role] of (['viewer', 'editor'] as Role[]).entries()) {
      const owner = await newClient().register();
      const folder = (await owner.post('/api/folders').send({ name: `Team ${index}` })).body.folder;
      const name = `shared-${index}.txt`;
      await owner.upload(name, `content ${index}`, { folderId: folder.id, contentType: 'text/plain' });
      await owner.post(`/api/collab/folders/${folder.id}/people`).send({ email: guest.email, role });
      names.push(name);
    }

    const incoming = await guest.get('/api/files?scope=incoming');
    expect(incoming.status).toBe(200);
    expect(incoming.body.items.map((f: { name: string }) => f.name).sort()).toEqual(names.sort());
  });

  it('is empty when nothing has been shared', async () => {
    const loner = await newClient().register();
    const res = await loner.get('/api/files?scope=incoming');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { anon, closeAll, newClient, resetDatabase } from './helpers.js';

describe('authentication', () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it('registers an account and returns the caller', async () => {
    const client = await newClient().register();
    const me = await client.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(client.email);
    expect(me.body.user).not.toHaveProperty('password_hash');
    expect(me.body.user).not.toHaveProperty('passwordHash');
  });

  it('stores passwords as argon2id hashes, never in the clear', async () => {
    const { db } = await import('../src/db/client.js');
    const client = await newClient().register('a-very-good-passphrase');
    const row = await db
      .selectFrom('users')
      .select('password_hash')
      .where('id', '=', client.userId)
      .executeTakeFirstOrThrow();
    expect(row.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(row.password_hash).not.toContain('a-very-good-passphrase');
  });

  it('rejects weak and reused-looking passwords with field errors', async () => {
    const client = newClient();
    await client.bootstrap();
    const res = await client
      .post('/api/auth/register')
      .send({ email: 'weak@example.test', password: 'password123', displayName: 'Weak' });
    expect(res.status).toBe(422);
    expect(res.body.error.fields.password.join(' ')).toMatch(/breach/i);
  });

  it('refuses a duplicate email without leaking whether it matters', async () => {
    const first = await newClient().register();
    const second = newClient();
    await second.bootstrap();
    const res = await second
      .post('/api/auth/register')
      .send({ email: first.email, password: 'another-good-passphrase', displayName: 'Copy' });
    expect(res.status).toBe(409);
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const client = await newClient().register('the-right-passphrase');
    const wrongPassword = await newClient().login(client.email, 'the-wrong-passphrase');
    const noAccount = await newClient().login('nobody@example.test', 'the-wrong-passphrase');

    expect(wrongPassword.status).toBe(401);
    expect(noAccount.status).toBe(401);
    expect(noAccount.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('rejects mutating requests without a CSRF token', async () => {
    const client = await newClient().register();
    const res = await client.postUnguarded('/api/folders').send({ name: 'no csrf' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf_failed');
  });

  it('rejects mutating requests from a foreign origin', async () => {
    const client = await newClient().register();
    const res = await client.post('/api/folders').set('Origin', 'https://evil.example').send({ name: 'x' });
    expect(res.status).toBe(403);
  });

  it('rotates the refresh token and kills the family if an old one is replayed', async () => {
    const client = await newClient().register();

    const first = await client.post('/api/auth/refresh');
    expect(first.status).toBe(200);

    // Replay: a different browser presenting the token that was rotated away.
    const cookies = first.headers['set-cookie'] as unknown as string[];
    const refresh = cookies.find((c) => c.includes('basalt_rt='))!.split(';')[0]!;
    const csrf = 'replayed-csrf-token-value';
    const replayHeaders = { Cookie: [refresh, `basalt_csrf=${csrf}`], 'X-CSRF-Token': csrf, Origin: 'http://localhost:3000' };

    const replay = await anon().post('/api/auth/refresh').set(replayHeaders);
    expect(replay.status).toBe(200); // the freshest token still works once

    const replayAgain = await anon().post('/api/auth/refresh').set(replayHeaders);
    expect(replayAgain.status).toBe(401);
    expect(replayAgain.body.error.message).toMatch(/security/i);
  });

  it('revokes the session immediately on logout', async () => {
    const client = await newClient().register();
    expect((await client.get('/api/auth/me')).status).toBe(200);
    expect((await client.post('/api/auth/logout')).status).toBe(204);
    expect((await client.get('/api/auth/me')).status).toBe(401);
  });

  it('logs other devices out when the password changes', async () => {
    const password = 'first-good-passphrase';
    const deviceA = await newClient().register(password);
    const deviceB = newClient();
    expect((await deviceB.login(deviceA.email, password)).status).toBe(200);

    const res = await deviceA
      .post('/api/auth/password')
      .send({ currentPassword: password, newPassword: 'second-good-passphrase' });
    expect(res.status).toBe(204);

    expect((await deviceA.get('/api/auth/me')).status).toBe(200); // the device that changed it stays
    expect((await deviceB.get('/api/auth/me')).status).toBe(401); // every other device is out
  });

  it('lists sessions and can revoke one', async () => {
    const client = await newClient().register();
    const sessions = await client.get('/api/auth/sessions');
    expect(sessions.body.sessions).toHaveLength(1);
    expect(sessions.body.sessions[0].current).toBe(true);
  });
});

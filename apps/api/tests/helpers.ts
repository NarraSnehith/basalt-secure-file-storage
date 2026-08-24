import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { initStorage } from '../src/storage/index.js';

// createApp() deliberately does no I/O, so the suite prepares the blob and
// spool directories itself — the same call server.ts makes at boot.
await initStorage();

export const app: Express = createApp();

/**
 * A browser-shaped client: keeps cookies, tracks the CSRF token the way the real
 * front end does, and sends an Origin header so the CSRF guard is exercised on
 * every mutating call instead of being bypassed by the tests.
 */
export class Client {
  private readonly agent = request.agent(app);
  private csrf = '';
  userId = '';
  email = '';

  private headers(): Record<string, string> {
    return { Origin: 'http://localhost:3000', ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}) };
  }

  async bootstrap(): Promise<void> {
    const res = await this.agent.get('/api/auth/csrf');
    this.csrf = res.body.csrfToken;
  }

  get(url: string) {
    return this.agent.get(url).set(this.headers());
  }
  head(url: string) {
    return this.agent.head(url).set(this.headers());
  }
  post(url: string) {
    return this.agent.post(url).set(this.headers());
  }
  patch(url: string) {
    return this.agent.patch(url).set(this.headers());
  }
  delete(url: string) {
    return this.agent.delete(url).set(this.headers());
  }

  /** POST without the CSRF header, to prove the guard bites. */
  postUnguarded(url: string) {
    return this.agent.post(url).set({ Origin: 'http://localhost:3000' });
  }

  async register(password = 'basalt-test-passphrase'): Promise<this> {
    await this.bootstrap();
    const email = `user-${randomUUID().slice(0, 8)}@example.test`;
    const res = await this.post('/api/auth/register').send({ email, password, displayName: 'Test User' });
    if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    this.csrf = res.body.csrfToken;
    this.userId = res.body.user.id;
    this.email = email;
    return this;
  }

  async login(email: string, password: string) {
    await this.bootstrap();
    const res = await this.post('/api/auth/login').send({ email, password });
    if (res.status === 200) this.csrf = res.body.csrfToken;
    return res;
  }

  /** Upload one in-memory file through the real multipart pipeline. */
  upload(
    name: string,
    contents: Buffer | string,
    opts: { folderId?: string | null; visibility?: 'private' | 'public'; contentType?: string } = {},
  ) {
    let req = this.post('/api/files').attach('file', Buffer.from(contents), {
      filename: name,
      contentType: opts.contentType ?? 'application/octet-stream',
    });
    if (opts.folderId !== undefined) req = req.field('folderId', opts.folderId ?? '');
    if (opts.visibility) req = req.field('visibility', opts.visibility);
    return req;
  }
}

export const newClient = () => new Client();

/**
 * superagent parses text/* into `res.text`; for byte-exact assertions we want
 * the raw buffer, so download tests attach this parser explicitly.
 */
export function binaryParser(res: unknown, cb: (err: Error | null, body: Buffer) => void): void {
  const stream = res as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on('end', () => cb(null, Buffer.concat(chunks)));
}

/** Anonymous requests — a share-link visitor with no session at all. */
export const anon = () => request(app);

export async function resetDatabase(): Promise<void> {
  // users cascades to files, folders, shares and sessions.
  await db.deleteFrom('users').execute();
  await db.deleteFrom('events').execute();
}

export async function closeAll(): Promise<void> {
  await db.destroy();
}

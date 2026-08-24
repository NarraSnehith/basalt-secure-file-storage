import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { initStorage } from '../src/storage/index.js';

// createApp() deliberately does no I/O, so the suite prepares the blob and
// spool directories itself — the same call server.ts makes at boot.
await initStorage();

// Opt-in diagnostic (BASALT_POOL_WATCH=1): report pool pressure whenever
// something queues for a connection. node-postgres waits on that forever, so a
// pool too small for a request's background writes hangs rather than degrades —
// worth being able to see.
if (process.env.BASALT_POOL_WATCH) {
  const { pool } = await import('../src/db/client.js');
  const timer = setInterval(() => {
    if (pool.waitingCount > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `[pool] waiting=${pool.waitingCount} total=${pool.totalCount} idle=${pool.idleCount}`,
      );
    }
  }, 500);
  timer.unref();
}

export const app: Express = createApp();

/**
 * Every request in the suite carries a response deadline.
 *
 * Without one, a request that never completes surfaces as "test timed out" with
 * no indication of which call hung — the least useful failure a test suite can
 * produce. With one, the failure names the method and path.
 */
const RESPONSE_TIMEOUT = 8000;
const deadline = { response: RESPONSE_TIMEOUT, deadline: RESPONSE_TIMEOUT * 2 };

/**
 * A browser-shaped client: keeps cookies, tracks the CSRF token the way the real
 * front end does, and sends an Origin header so the CSRF guard is exercised on
 * every mutating call instead of being bypassed by the tests.
 */
/**
 * Accounts this file created, so cleanup can remove exactly those.
 *
 * `DELETE FROM users` would be simpler, but it reaches across test files: if
 * two files' processes overlap for even a moment, one wipes the other's
 * signed-in account and its requests start coming back 401. Every API query is
 * owner-scoped anyway, so tests do not need a globally empty database — only
 * one without their own leftovers.
 */
const createdUsers = new Set<string>();

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
    return this.agent.get(url).set(this.headers()).timeout(deadline);
  }
  head(url: string) {
    return this.agent.head(url).set(this.headers()).timeout(deadline);
  }
  post(url: string) {
    return this.agent.post(url).set(this.headers()).timeout(deadline);
  }
  patch(url: string) {
    return this.agent.patch(url).set(this.headers()).timeout(deadline);
  }
  put(url: string) {
    return this.agent.put(url).set(this.headers()).timeout(deadline);
  }
  delete(url: string) {
    return this.agent.delete(url).set(this.headers()).timeout(deadline);
  }

  /** POST without the CSRF header, to prove the guard bites. */
  postUnguarded(url: string) {
    return this.agent.post(url).set({ Origin: 'http://localhost:3000' }).timeout(deadline);
  }

  async register(password = 'basalt-test-passphrase'): Promise<this> {
    await this.bootstrap();
    const email = `user-${randomUUID().slice(0, 8)}@example.test`;
    const res = await this.post('/api/auth/register').send({ email, password, displayName: 'Test User' });
    if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    this.csrf = res.body.csrfToken;
    this.userId = res.body.user.id;
    this.email = email;
    createdUsers.add(this.userId);
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
    opts: {
      folderId?: string | null;
      visibility?: 'private' | 'public';
      contentType?: string;
      onConflict?: 'version' | 'rename';
    } = {},
  ) {
    let req = this.post('/api/files').attach('file', Buffer.from(contents), {
      filename: name,
      contentType: opts.contentType ?? 'application/octet-stream',
    });
    if (opts.folderId !== undefined) req = req.field('folderId', opts.folderId ?? '');
    if (opts.visibility) req = req.field('visibility', opts.visibility);
    if (opts.onConflict) req = req.field('onConflict', opts.onConflict);
    return req;
  }

  /**
   * Drive a resumable upload the way the browser does: open a session, send the
   * chunks the server asks for, then finalise. `skip` leaves those chunk indices
   * unsent so a test can prove that resuming works.
   */
  async chunkedUpload(
    name: string,
    contents: Buffer,
    opts: {
      folderId?: string | null;
      checksum?: string | null;
      skip?: number[];
      contentType?: string;
      onConflict?: 'version' | 'rename';
    } = {},
  ) {
    const opened = await this.post('/api/uploads').send({
      filename: name,
      size: contents.length,
      declaredMime: opts.contentType ?? 'application/octet-stream',
      folderId: opts.folderId ?? null,
      checksum: opts.checksum ?? null,
      onConflict: opts.onConflict ?? 'version',
    });
    if (opened.status !== 201) return { opened, session: null, completed: null };
    if (opened.body.instant) return { opened, session: null, completed: opened };

    const session = opened.body.session as { id: string; chunkSize: number; chunkCount: number };
    const skip = new Set(opts.skip ?? []);

    for (let index = 0; index < session.chunkCount; index += 1) {
      if (skip.has(index)) continue;
      const start = index * session.chunkSize;
      const chunk = contents.subarray(start, Math.min(start + session.chunkSize, contents.length));
      const res = await this.put(`/api/uploads/${session.id}/chunks/${index}`)
        .set('Content-Type', 'application/octet-stream')
        .send(chunk);
      if (res.status !== 200) return { opened, session, completed: res };
    }

    const completed = await this.post(`/api/uploads/${session.id}/complete`);
    return { opened, session, completed };
  }

  /** Send the chunks that a previous attempt left out. */
  async resume(sessionId: string, contents: Buffer) {
    const status = await this.get(`/api/uploads/${sessionId}`);
    const session = status.body.session as { chunkSize: number; missing: number[] };
    for (const index of session.missing) {
      const start = index * session.chunkSize;
      const chunk = contents.subarray(start, Math.min(start + session.chunkSize, contents.length));
      await this.put(`/api/uploads/${sessionId}/chunks/${index}`)
        .set('Content-Type', 'application/octet-stream')
        .send(chunk);
    }
    return this.post(`/api/uploads/${sessionId}/complete`);
  }
}

export const newClient = () => new Client();

/**
 * superagent parses text/* into `res.text`; for byte-exact assertions we want
 * the raw buffer, so download tests attach this parser explicitly.
 */
/**
 * Downloads must be read with `.redirects(1)`.
 *
 * The local driver streams the bytes itself; an object-store driver answers with
 * a 302 to a short-lived presigned URL so the bytes never occupy an API process.
 * Both are correct, so the assertions follow the redirect and the same suite
 * validates either backend:
 *
 *   STORAGE_DRIVER=s3 S3_BUCKET=… S3_ENDPOINT=… npm test
 */
export function binaryParser(res: unknown, cb: (err: Error | null, body: Buffer) => void): void {
  const stream = res as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on('end', () => cb(null, Buffer.concat(chunks)));
}

/** Anonymous requests — a share-link visitor with no session at all. */
export const anon = () => {
  const agent = request(app);
  return {
    get: (url: string) => agent.get(url).timeout(deadline),
    head: (url: string) => agent.head(url).timeout(deadline),
    post: (url: string) => agent.post(url).timeout(deadline),
    put: (url: string) => agent.put(url).timeout(deadline),
    patch: (url: string) => agent.patch(url).timeout(deadline),
    delete: (url: string) => agent.delete(url).timeout(deadline),
  };
};

/** Remove the accounts this test file created, and nothing else. */
export async function resetDatabase(): Promise<void> {
  if (createdUsers.size === 0) return;
  const ids = [...createdUsers];
  createdUsers.clear();
  // Deleting a user cascades to their files, folders, blobs, shares, sessions
  // and upload sessions.
  await db.deleteFrom('users').where('id', 'in', ids).execute();
  await db.deleteFrom('events').where('actor_id', 'in', ids).execute();
}

export async function closeAll(): Promise<void> {
  await db.destroy();
}

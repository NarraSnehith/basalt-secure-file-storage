import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The deployment-wide storage ceiling.
 *
 * This is what stands between a public deployment and an object-store bill:
 * per-account quotas cannot bound it, because ten accounts at the 10 GB default
 * is 100 GB. It is the one control whose purpose is to *stop* serving, so it is
 * worth proving it fires — before the bytes move, and again at commit.
 *
 * The value is substituted rather than set in `vitest.config.ts` because the
 * ceiling has to be chosen relative to what the database already holds:
 * `storedBytes()` counts every blob in the deployment and the suite's cleanup is
 * scoped per file, so the other files' blobs are still there and the baseline is
 * not zero.
 *
 * It has to be a getter on an unfrozen copy, not a Proxy over `env` itself:
 * `env` is `Object.freeze`d, and a `get` trap is required by the language to
 * return the true value of a read-only property — lying throws a TypeError.
 */
const ceiling = { bytes: 0 };

vi.mock('../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/env.js')>();
  return {
    ...actual,
    env: Object.defineProperty({ ...actual.env }, 'GLOBAL_STORAGE_LIMIT_BYTES', {
      get: () => ceiling.bytes,
      enumerable: true,
      configurable: true,
    }),
  };
});

const { closeAll, newClient, resetDatabase } = await import('./helpers.js');
const { storedBytes } = await import('../src/modules/files/ingest.js');

afterAll(closeAll);

describe('global storage ceiling', () => {
  beforeEach(async () => {
    ceiling.bytes = 0; // 0 means "no ceiling"; every test opts in explicitly
    await resetDatabase();
  });

  it('is off by default, so an ordinary deployment is unaffected', async () => {
    const client = await newClient().register();
    expect((await client.upload('ordinary.bin', Buffer.alloc(4096, 1))).status).toBe(201);
  });

  it('accepts what fits and refuses what does not', async () => {
    const client = await newClient().register();
    ceiling.bytes = (await storedBytes()) + 8192;

    expect((await client.upload('fits.bin', Buffer.alloc(4096, 1))).status).toBe(201);

    // 4096 stored plus 8192 requested is past the 8192 of headroom.
    const over = await client.upload('over.bin', Buffer.alloc(8192, 2));
    expect(over.status).toBe(507);
    expect(over.body.error.code).toBe('capacity_reached');
    expect(over.body.error.details.limitBytes).toBe(ceiling.bytes);
  });

  it('refuses a resumable upload when it is opened, not after it transfers', async () => {
    const client = await newClient().register();
    ceiling.bytes = (await storedBytes()) + 1; // a single byte of headroom

    const res = await client
      .post('/api/uploads')
      .send({ filename: 'huge.bin', size: 1_000_000 });

    expect(res.status).toBe(507);
    expect(res.body.error.code).toBe('capacity_reached');
    // Nothing to resume: the client never gets a session to send chunks to.
    expect(res.body.session).toBeUndefined();
  });

  it('measures de-duplicated content once, so a copy does not eat the ceiling', async () => {
    const client = await newClient().register();
    const bytes = Buffer.alloc(4096, 7);
    const before = await storedBytes();
    ceiling.bytes = before + 100_000; // ample; the ceiling is not what is under test

    expect((await client.upload('first.bin', bytes)).status).toBe(201);
    const afterFirst = await storedBytes();
    expect(afterFirst).toBe(before + 4096);

    expect((await client.upload('second.bin', bytes, { onConflict: 'rename' })).status).toBe(201);
    expect(await storedBytes()).toBe(afterFirst); // the copy added nothing
  });

  it('refuses conservatively before a hash is known, even for content that would de-duplicate', async () => {
    const client = await newClient().register();
    const bytes = Buffer.alloc(4096, 9);
    ceiling.bytes = (await storedBytes()) + 4096;
    expect((await client.upload('first.bin', bytes)).status).toBe(201);

    // Storing this again would cost nothing, and `commitFile` knows that — but
    // a multipart upload has not been read yet when the ceiling is checked, so
    // there is no hash to compare and the pre-flight has to assume the worst.
    // Erring towards refusal is the right way round for a spend backstop.
    const copy = await client.upload('second.bin', bytes, { onConflict: 'rename' });
    expect(copy.status).toBe(507);
  });

  it('counts unswept blobs, which the store is still charging for', async () => {
    const client = await newClient().register();
    const file = (await client.upload('doomed.bin', Buffer.alloc(4096, 3))).body.files[0];

    const withFile = await storedBytes();
    await client.delete(`/api/files/${file.id}`); // binned, but the object remains
    expect(await storedBytes()).toBe(withFile);
  });
});

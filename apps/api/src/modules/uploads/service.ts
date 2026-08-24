import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { Request } from 'express';
import { sql } from 'kysely';
import { db } from '../../db/client.js';
import type { UploadSessionRow, UserRow } from '../../db/types.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { formatBytes } from '../../lib/bytes.js';
import { sanitizeFilename } from '../../lib/filenames.js';
import { logger } from '../../lib/logger.js';
import {
  createSpool,
  digestSpool,
  removeSpool,
  spoolExists,
  spoolPath,
  streamChunkInto,
} from '../../storage/spool.js';
import { recordEvent } from '../activity/service.js';
import { releaseSlot } from '../requests/service.js';
import type { FileDTO } from '../files/dto.js';
import {
  assertAcceptable,
  findOwnedBlob,
  ingest,
  ingestKnownBlob,
  type IngestResult,
} from '../files/ingest.js';

/**
 * Resumable uploads.
 *
 * The complaint this exists to answer is the oldest one about cloud storage:
 * a transfer dies at 97% and starts over. A session records what the file is
 * supposed to be, hands the client a chunk size, and then accepts chunks in any
 * order, any number of times, from any number of connections. Which chunks have
 * landed is server state, so "what do you still need?" is a question the client
 * can ask after a dropped connection, a closed laptop, or a reload.
 *
 * Two things make it safe rather than merely convenient:
 *
 *  · the bytes are verified. The client declares a size and (optionally) a
 *    SHA-256; at completion we hash what we actually received and refuse the
 *    upload if it disagrees. A chunk may also carry its own digest.
 *  · the session is bounded. Sessions expire, are limited per account, and the
 *    spool file is sparse, so an abandoned 5 GB upload costs only the blocks
 *    that arrived and is swept within the hour.
 */

const MIN_CHUNK = 256 * 1024;
const MAX_CHUNK = 32 * 1024 * 1024;
const TARGET_CHUNKS = 400;
const MAX_CHUNK_COUNT = 100_000;
const SESSION_TTL_MS = 24 * 3_600_000;
const MAX_OPEN_SESSIONS = 24;

export interface SessionDTO {
  id: string;
  filename: string;
  sizeBytes: number;
  chunkSize: number;
  chunkCount: number;
  receivedCount: number;
  /** Indices still needed — exactly what a resuming client should send. */
  missing: number[];
  uploadedBytes: number;
  status: 'open' | 'completing' | 'complete' | 'aborted';
  folderId: string | null;
  createdAt: string;
  expiresAt: string;
}

/**
 * Chunk size is chosen server-side: big enough that per-chunk overhead is
 * irrelevant, small enough that a failure costs little, and bounded so a huge
 * file cannot produce a bitmap with a million bits in it.
 */
export function chooseChunkSize(size: number): number {
  const ideal = Math.ceil(size / TARGET_CHUNKS);
  const rounded = Math.ceil(ideal / MIN_CHUNK) * MIN_CHUNK;
  return Math.min(MAX_CHUNK, Math.max(MIN_CHUNK, rounded));
}

const bitmapBytes = (chunkCount: number): number => Math.ceil(chunkCount / 8);

/** Which chunks are still missing, read from the bitmap. */
function missingChunks(received: Buffer, chunkCount: number, limit = 4096): number[] {
  const missing: number[] = [];
  for (let i = 0; i < chunkCount && missing.length < limit; i += 1) {
    const byte = received[i >> 3] ?? 0;
    if ((byte & (1 << (i & 7))) === 0) missing.push(i);
  }
  return missing;
}

function toDTO(row: UploadSessionRow): SessionDTO {
  const chunkCount = row.chunk_count;
  const missing = missingChunks(row.received, chunkCount);
  return {
    id: row.id,
    filename: row.filename,
    sizeBytes: Number(row.size_bytes),
    chunkSize: row.chunk_size,
    chunkCount,
    receivedCount: row.received_count,
    missing,
    // Complete chunks only, so the number never overstates progress.
    uploadedBytes: Math.min(Number(row.size_bytes), row.received_count * row.chunk_size),
    status: row.status,
    folderId: row.folder_id,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

export interface CreateSessionInput {
  filename: string;
  size: number;
  declaredMime?: string | null;
  folderId?: string | null;
  /** Hex SHA-256 of the whole file, when the client could afford to compute it. */
  checksum?: string | null;
  onConflict?: 'version' | 'rename';
  requestId?: string | null;
  submitter?: string | null;
  visibility?: 'private' | 'public';
}

export type CreateSessionResult =
  | { kind: 'instant'; result: IngestResult }
  | { kind: 'session'; session: SessionDTO };

/**
 * Open a session — or skip it entirely.
 *
 * If the client offers a content hash we already hold for this account, there is
 * nothing to transfer: the file is registered against the existing bytes and the
 * upload is over before it began. That is the pleasant half of content
 * addressing, and it is why the client bothers to hash first.
 */
export async function createSession(
  user: UserRow,
  input: CreateSessionInput,
  req?: Request,
): Promise<CreateSessionResult> {
  const filename = sanitizeFilename(input.filename, 'upload');
  const size = input.size;

  await assertAcceptable(user, { filename, size, folderId: input.folderId ?? null });

  if (input.checksum) {
    if (!/^[0-9a-f]{64}$/i.test(input.checksum)) {
      throw new AppError('validation_failed', 'checksum must be a hex SHA-256 digest.', {
        fields: { checksum: ['Expected 64 hex characters.'] },
      });
    }
    const checksum = Buffer.from(input.checksum, 'hex');
    const known = await findOwnedBlob(user.id, checksum);
    if (known && known.size === size) {
      const result = await ingestKnownBlob(
        user,
        { blobId: known.id, filename, declaredMime: input.declaredMime ?? null },
        {
          folderId: input.folderId ?? null,
          onConflict: input.onConflict ?? 'version',
          source: input.requestId ? 'request' : 'upload',
          ...(input.visibility ? { visibility: input.visibility } : {}),
          submitter: input.submitter ?? null,
          requestId: input.requestId ?? null,
        },
        req,
      );
      return { kind: 'instant', result };
    }
  }

  const open = await db
    .selectFrom('upload_sessions')
    .select(sql<string>`count(*)`.as('n'))
    .where('owner_id', '=', user.id)
    .where('status', 'in', ['open', 'completing'])
    .executeTakeFirst();
  if (Number(open?.n ?? 0) >= MAX_OPEN_SESSIONS) {
    throw new AppError('rate_limited', 'Too many uploads in progress. Finish or cancel one first.', {
      details: { maxConcurrent: MAX_OPEN_SESSIONS },
    });
  }

  const chunkSize = chooseChunkSize(size);
  const chunkCount = Math.max(1, Math.ceil(size / chunkSize));
  if (chunkCount > MAX_CHUNK_COUNT) {
    throw new AppError('payload_too_large', 'That file is too large to upload in one session.');
  }

  const spoolKey = `${randomUUID().replace(/-/g, '')}.upload`;
  await createSpool(spoolKey, size);

  const row = await db
    .insertInto('upload_sessions')
    .values({
      owner_id: user.id,
      folder_id: input.folderId ?? null,
      filename,
      declared_mime: input.declaredMime ?? null,
      size_bytes: size,
      expected_checksum: input.checksum ? Buffer.from(input.checksum, 'hex') : null,
      chunk_size: chunkSize,
      chunk_count: chunkCount,
      received: Buffer.alloc(bitmapBytes(chunkCount)),
      spool_key: spoolKey,
      on_conflict: input.onConflict ?? 'version',
      request_id: input.requestId ?? null,
      submitter: input.submitter ?? null,
      expires_at: new Date(Date.now() + SESSION_TTL_MS),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await recordEvent({
    type: 'upload.start',
    actorId: user.id,
    subject: filename,
    metadata: { sizeBytes: size, chunkSize, chunkCount, resumable: true },
    req,
  });

  return { kind: 'session', session: toDTO(row) };
}

async function loadSession(id: string, ownerId: string): Promise<UploadSessionRow> {
  const row = await db
    .selectFrom('upload_sessions')
    .selectAll()
    .where('id', '=', id)
    .where('owner_id', '=', ownerId)
    .executeTakeFirst();
  if (!row) throw new AppError('not_found', 'That upload session does not exist.');
  return row;
}

export async function getSession(id: string, ownerId: string): Promise<SessionDTO> {
  return toDTO(await loadSession(id, ownerId));
}

export async function listOpenSessions(ownerId: string): Promise<SessionDTO[]> {
  const rows = await db
    .selectFrom('upload_sessions')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('status', 'in', ['open', 'completing'])
    .where('expires_at', '>', new Date())
    .orderBy('created_at', 'desc')
    .limit(50)
    .execute();
  return rows.map(toDTO);
}

export interface ChunkInput {
  sessionId: string;
  ownerId: string;
  index: number;
  body: Readable;
  /** Content-Length, when the client sent one. */
  declaredLength?: number | undefined;
  /** Optional per-chunk hex SHA-256, verified before the chunk is accepted. */
  expectedSha?: string | undefined;
}

export interface ChunkResult {
  received: number;
  total: number;
  complete: boolean;
  bytes: number;
}

/**
 * Accept one chunk.
 *
 * Idempotent by construction: the chunk is written at a fixed offset and the
 * bitmap is updated with set_bit, so a client that retries a chunk it already
 * sent overwrites identical bytes and does not inflate the counter.
 */
export async function receiveChunk(input: ChunkInput): Promise<ChunkResult> {
  const session = await loadSession(input.sessionId, input.ownerId);

  if (session.status !== 'open') {
    throw new AppError('conflict', `This upload is ${session.status}, not accepting chunks.`);
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    throw new AppError('gone', 'This upload session has expired. Start it again.');
  }
  if (!Number.isInteger(input.index) || input.index < 0 || input.index >= session.chunk_count) {
    throw new AppError('bad_request', `Chunk index must be between 0 and ${session.chunk_count - 1}.`);
  }

  const size = Number(session.size_bytes);
  const offset = input.index * session.chunk_size;
  const expected = Math.min(session.chunk_size, size - offset);

  if (input.declaredLength !== undefined && input.declaredLength !== expected) {
    throw new AppError('bad_request', `Chunk ${input.index} must be exactly ${expected} bytes.`, {
      details: { expectedBytes: expected, declaredBytes: input.declaredLength },
    });
  }
  if (!(await spoolExists(session.spool_key))) {
    await abandonSession(session.id, 'spool_missing');
    throw new AppError('gone', 'The partial upload is no longer on disk. Start again.');
  }

  const written = await streamChunkInto(session.spool_key, offset, input.body, expected);

  if (written.overflowed || written.bytes !== expected) {
    // The bit stays clear, so the client can simply send this chunk again.
    throw new AppError('bad_request', `Chunk ${input.index} was ${written.bytes} bytes, expected ${expected}.`, {
      details: { expectedBytes: expected, receivedBytes: written.bytes },
    });
  }
  if (input.expectedSha && input.expectedSha.toLowerCase() !== written.sha256) {
    throw new AppError('bad_request', `Chunk ${input.index} failed its checksum — resend it.`);
  }

  // One statement, so two connections uploading different chunks cannot lose an
  // update, and a repeated chunk adds nothing.
  const updated = await db
    .updateTable('upload_sessions')
    .set({
      received: sql<Buffer>`set_bit(received, ${input.index}, 1)`,
      received_count: sql<number>`received_count + (1 - get_bit(received, ${input.index}))`,
    })
    .where('id', '=', session.id)
    .where('status', '=', 'open')
    .returning(['received_count', 'chunk_count'])
    .executeTakeFirstOrThrow();

  return {
    received: updated.received_count,
    total: updated.chunk_count,
    complete: updated.received_count >= updated.chunk_count,
    bytes: written.bytes,
  };
}

/**
 * Finish: verify every chunk arrived, hash the assembled file, compare it with
 * what the client promised, and hand it to the same ingest path a one-shot
 * upload uses.
 */
export async function completeSession(id: string, ownerId: string, req?: Request): Promise<IngestResult> {
  const session = await loadSession(id, ownerId);

  if (session.status === 'complete') {
    throw new AppError('conflict', 'This upload was already completed.');
  }
  if (session.received_count < session.chunk_count) {
    const missing = missingChunks(session.received, session.chunk_count, 64);
    throw new AppError('bad_request', `${session.chunk_count - session.received_count} chunks are still missing.`, {
      details: { missing, received: session.received_count, total: session.chunk_count },
    });
  }

  // Claim the session so two "complete" calls cannot both ingest it.
  const claimed = await db
    .updateTable('upload_sessions')
    .set({ status: 'completing' })
    .where('id', '=', session.id)
    .where('status', '=', 'open')
    .returning('id')
    .executeTakeFirst();
  if (!claimed) throw new AppError('conflict', 'This upload is already being finalised.');

  const owner = await db.selectFrom('users').selectAll().where('id', '=', ownerId).executeTakeFirstOrThrow();

  try {
    const { checksum, size, head } = await digestSpool(session.spool_key);

    if (size !== Number(session.size_bytes)) {
      throw new AppError('bad_request', `Assembled ${formatBytes(size)}, expected ${formatBytes(Number(session.size_bytes))}.`);
    }
    if (session.expected_checksum && !checksum.equals(session.expected_checksum)) {
      // Someone's bytes are wrong: a corrupted chunk, or a client sending
      // different content than it declared. Either way we do not store it.
      throw new AppError('bad_request', 'The assembled file does not match the checksum you declared.');
    }

    const result = await ingest(
      owner,
      {
        filename: session.filename,
        declaredMime: session.declared_mime,
        spoolPath: spoolPath(session.spool_key),
        size,
        checksum,
        head,
      },
      {
        folderId: session.folder_id,
        onConflict: session.on_conflict,
        source: session.request_id ? 'request' : 'upload',
        submitter: session.submitter,
        requestId: session.request_id,
      },
      req,
    );

    await db.updateTable('upload_sessions').set({ status: 'complete' }).where('id', '=', session.id).execute();
    return result;
  } catch (err) {
    // Back to 'open': the bytes are still on disk, so a transient failure (a
    // full quota that the user then frees) can be retried without re-uploading.
    await db
      .updateTable('upload_sessions')
      .set({ status: 'open' })
      .where('id', '=', session.id)
      .where('status', '=', 'completing')
      .execute();
    throw err;
  }
}

export async function abandonSession(id: string, reason: string, ownerId?: string): Promise<void> {
  let query = db
    .selectFrom('upload_sessions')
    .select(['id', 'spool_key', 'owner_id', 'filename', 'request_id', 'size_bytes', 'status'])
    .where('id', '=', id);
  if (ownerId) query = query.where('owner_id', '=', ownerId);
  const session = await query.executeTakeFirst();
  if (!session) {
    if (ownerId) throw new AppError('not_found', 'That upload session does not exist.');
    return;
  }

  await removeSpool(session.spool_key);
  const closed = await db
    .updateTable('upload_sessions')
    .set({ status: 'aborted' })
    .where('id', '=', session.id)
    .where('status', '<>', 'complete')
    .returning('id')
    .executeTakeFirst();

  // A request link reserved room for this file when the session opened; an
  // upload that never finished must not consume the sender's allowance.
  if (closed && session.request_id) {
    await releaseSlot(session.request_id, Number(session.size_bytes)).catch(() => {});
  }

  logger.debug({ sessionId: id, reason }, 'upload session abandoned');
  await recordEvent({
    type: 'upload.abort',
    actorId: session.owner_id,
    subject: session.filename,
    metadata: { reason },
  });
}

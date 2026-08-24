import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { AppError } from '../../lib/errors.js';
import { noStore, parseBody, parseParams, route, uuid } from '../../lib/http.js';
import { resolveUploadTarget } from '../collaborators/access.js';
import {
  abandonSession,
  completeSession,
  createSession,
  getSession,
  listOpenSessions,
  receiveChunk,
} from './service.js';

const createSchema = z.object({
  filename: z.string().trim().min(1, 'A filename is required.').max(255),
  size: z.coerce.number().int().min(1, 'Size must be at least one byte.').max(5 * 1024 ** 4),
  declaredMime: z.string().max(255).nullish(),
  folderId: uuid.nullish(),
  checksum: z.string().regex(/^[0-9a-fA-F]{64}$/, 'Expected a hex SHA-256 digest.').nullish(),
  onConflict: z.enum(['version', 'rename']).default('version'),
  visibility: z.enum(['private', 'public']).optional(),
});

const sessionParams = z.object({ id: uuid });
const chunkParams = z.object({ id: uuid, index: z.coerce.number().int().min(0).max(99_999) });

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

uploadsRouter.get(
  '/',
  route(async (req, res) => {
    noStore(res);
    res.json({ sessions: await listOpenSessions(req.auth!.user.id) });
  }),
);

/**
 * Open a session. May answer with a finished file instead: if the client's
 * declared hash matches content this account already holds, there is nothing to
 * transfer.
 */
uploadsRouter.post(
  '/',
  rateLimit({ name: 'upload-session', windowMs: 60_000, max: 240 }),
  route(async (req, res) => {
    const input = parseBody(createSchema, req);
    // Uploading into a folder shared with you spends the owner's quota, so the
    // session is opened against them while remaining yours to drive.
    const target = await resolveUploadTarget(req.auth!.user, input.folderId ?? null);

    const outcome = await createSession(
      target.quotaHolder,
      {
        filename: input.filename,
        size: input.size,
        declaredMime: input.declaredMime ?? null,
        folderId: target.folderId,
        checksum: input.checksum ?? null,
        onConflict: input.onConflict,
        actorId: target.actorId,
        ...(input.visibility ? { visibility: input.visibility } : {}),
      },
      req,
    );

    noStore(res);
    if (outcome.kind === 'instant') {
      res.status(201).json({
        instant: true,
        file: outcome.result.file,
        deduped: true,
        versioned: outcome.result.versioned,
        version: outcome.result.version,
      });
      return;
    }
    res.status(201).json({ instant: false, session: outcome.session });
  }),
);

uploadsRouter.get(
  '/:id',
  route(async (req, res) => {
    const { id } = parseParams(sessionParams, req);
    noStore(res);
    res.json({ session: await getSession(id, req.auth!.user.id) });
  }),
);

/**
 * Accept one chunk.
 *
 * The body is consumed as a stream rather than parsed: an 8 MB chunk should cost
 * 8 MB of network and a few kilobytes of heap, not a buffer per concurrent
 * request. Nothing upstream parses application/octet-stream, so `req` is still
 * a readable stream here.
 */
uploadsRouter.put(
  '/:id/chunks/:index',
  route(async (req, res) => {
    const { id, index } = parseParams(chunkParams, req);
    const declared = req.get('content-length');
    const sha = req.get('x-chunk-sha256');

    if (sha && !/^[0-9a-fA-F]{64}$/.test(sha)) {
      throw new AppError('bad_request', 'X-Chunk-Sha256 must be a hex SHA-256 digest.');
    }

    const result = await receiveChunk({
      sessionId: id,
      ownerId: req.auth!.user.id,
      index,
      body: req,
      declaredLength: declared === undefined ? undefined : Number(declared),
      expectedSha: sha ?? undefined,
    });

    noStore(res);
    res.json(result);
  }),
);

uploadsRouter.post(
  '/:id/complete',
  route(async (req, res) => {
    const { id } = parseParams(sessionParams, req);
    const result = await completeSession(id, req.auth!.user.id, req);
    noStore(res);
    res.status(201).json({
      file: result.file,
      deduped: result.deduped,
      versioned: result.versioned,
      version: result.version,
    });
  }),
);

uploadsRouter.delete(
  '/:id',
  route(async (req, res) => {
    const { id } = parseParams(sessionParams, req);
    await abandonSession(id, 'client_cancelled', req.auth!.user.id);
    res.status(204).end();
  }),
);

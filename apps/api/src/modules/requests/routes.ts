import { Router, type Request as ExpressRequest } from 'express';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { AppError } from '../../lib/errors.js';
import { noStore, parseBody, parseParams, route, uuid } from '../../lib/http.js';
import { signRequestGrant, verifyRequestGrant } from '../../lib/tokens.js';
import { completeSession, createSession, getSession, receiveChunk, abandonSession } from '../uploads/service.js';
import { recordEvent } from '../activity/service.js';
import {
  assertRoomFor,
  checkRequestPassword,
  createRequest,
  listRequests,
  listSubmissions,
  recordSubmission,
  releaseSlot,
  reserveSlot,
  resolveRequest,
  revokeRequest,
  updateRequest,
} from './service.js';

const futureDate = z.coerce
  .date()
  .refine((d) => d.getTime() > Date.now() + 30_000, 'Pick a time in the future.')
  .refine((d) => d.getTime() < Date.now() + 365 * 86_400_000, 'Expiry cannot be more than a year out.');

const createSchema = z.object({
  folderId: uuid,
  title: z.string().trim().min(1, 'Give the request a title.').max(120),
  message: z.string().trim().max(500).nullish(),
  password: z.string().min(6, 'Use at least 6 characters.').max(128).nullish(),
  maxFiles: z.coerce.number().int().min(1).max(1000).nullish(),
  maxBytes: z.coerce.number().int().min(1024).max(50 * 1024 ** 3).nullish(),
  expiresAt: futureDate.nullish(),
});

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    message: z.string().trim().max(500).nullable().optional(),
    password: z.string().min(6).max(128).nullable().optional(),
    maxFiles: z.coerce.number().int().min(1).max(1000).nullable().optional(),
    maxBytes: z.coerce.number().int().min(1024).max(50 * 1024 ** 3).nullable().optional(),
    expiresAt: futureDate.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');

const slugParams = z.object({ slug: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Not a valid link.') });

// ─────────────────────────── owner side: /api/requests ───────────────────────

export const requestsRouter = Router();
requestsRouter.use(requireAuth);

requestsRouter.get(
  '/',
  route(async (req, res) => {
    noStore(res);
    res.json({ requests: await listRequests(req.auth!.user.id) });
  }),
);

requestsRouter.post(
  '/',
  rateLimit({ name: 'request-create', windowMs: 60_000, max: 30 }),
  route(async (req, res) => {
    const input = parseBody(createSchema, req);
    const created = await createRequest(
      req.auth!.user.id,
      {
        folderId: input.folderId,
        title: input.title,
        message: input.message ?? null,
        password: input.password ?? null,
        maxFiles: input.maxFiles ?? null,
        maxBytes: input.maxBytes ?? null,
        expiresAt: input.expiresAt ?? null,
      },
      req,
    );
    res.status(201).json({ request: created });
  }),
);

requestsRouter.get(
  '/:id/submissions',
  route(async (req, res) => {
    const { id } = parseParams(z.object({ id: uuid }), req);
    res.json({ submissions: await listSubmissions(req.auth!.user.id, id) });
  }),
);

requestsRouter.patch(
  '/:id',
  route(async (req, res) => {
    const { id } = parseParams(z.object({ id: uuid }), req);
    const patch = parseBody(updateSchema, req);
    res.json({ request: await updateRequest(req.auth!.user.id, id, patch, req) });
  }),
);

requestsRouter.delete(
  '/:id',
  route(async (req, res) => {
    const { id } = parseParams(z.object({ id: uuid }), req);
    await revokeRequest(req.auth!.user.id, id, req);
    res.status(204).end();
  }),
);

// ─────────────────────────── public side: /api/r/:slug ───────────────────────

export const publicRequestsRouter = Router();

const browseLimit = rateLimit({ name: 'request-view', windowMs: 60_000, max: 120 });
const unlockLimit = rateLimit({
  name: 'request-unlock',
  windowMs: 15 * 60_000,
  max: 10,
  key: (req) => String(req.params.slug ?? '').slice(0, 64),
  message: 'Too many password attempts for this link. Try again later.',
});
const openLimit = rateLimit({
  name: 'request-upload',
  windowMs: 60 * 60_000,
  max: 60,
  key: (req) => String(req.params.slug ?? '').slice(0, 64),
  message: 'This link has taken too many uploads from you recently.',
});

/** Has the caller already entered the password for this link? */
async function unlocked(req: ExpressRequest, slug: string): Promise<boolean> {
  const token = String(req.get('x-request-grant') ?? req.query.g ?? '').trim();
  return token ? verifyRequestGrant(token, slug) : false;
}

async function gate(req: ExpressRequest, slug: string) {
  const request = await resolveRequest(slug);
  if (request.requiresPassword && !(await unlocked(req, slug))) {
    throw new AppError('share_password_required', 'This upload link is password protected.');
  }
  return request;
}

publicRequestsRouter.get(
  '/:slug',
  browseLimit,
  route(async (req, res) => {
    const { slug } = parseParams(slugParams, req);
    const request = await resolveRequest(slug);
    noStore(res);

    // Before the password is entered, say only that one is needed. The title and
    // message can carry information the owner did not mean to publish.
    if (request.requiresPassword && !(await unlocked(req, slug))) {
      res.json({ request: { slug, requiresPassword: true, ownerName: request.ownerName } });
      return;
    }

    res.json({
      request: {
        slug,
        requiresPassword: request.requiresPassword,
        unlocked: true,
        title: request.title,
        message: request.message,
        ownerName: request.ownerName,
        maxFiles: request.maxFiles,
        maxBytes: request.maxBytes,
        remainingFiles: request.remainingFiles,
        remainingBytes: request.remainingBytes,
        expiresAt: request.expiresAt,
        // Reported rather than thrown, so the page can say "this link is closed"
        // instead of showing the sender an error.
        full:
          (request.remainingFiles !== null && request.remainingFiles <= 0) ||
          (request.remainingBytes !== null && request.remainingBytes <= 0),
      },
    });
  }),
);

publicRequestsRouter.post(
  '/:slug/unlock',
  unlockLimit,
  route(async (req, res) => {
    const { slug } = parseParams(slugParams, req);
    const { password } = parseBody(z.object({ password: z.string().min(1).max(200) }), req);
    const request = await resolveRequest(slug);

    if (!request.requiresPassword) {
      res.json({ grant: await signRequestGrant(slug) });
      return;
    }
    if (!(await checkRequestPassword(request, password))) {
      await recordEvent({ type: 'request.denied', metadata: { requestId: request.id, reason: 'bad_password' }, req });
      throw new AppError('share_password_invalid', 'That password is not correct.');
    }

    noStore(res);
    res.json({ grant: await signRequestGrant(slug), expiresIn: 3600 });
  }),
);

/**
 * Open a resumable session against this link.
 *
 * The session is created *as the owner* — their folder, their quota — but with
 * `onConflict: 'rename'` pinned: a stranger sending "invoice.pdf" must never be
 * able to bury the owner's existing invoice.pdf under a new version. Room is
 * reserved against the link's limits up front and released if the upload never
 * completes.
 */
publicRequestsRouter.post(
  '/:slug/uploads',
  openLimit,
  route(async (req, res) => {
    const { slug } = parseParams(slugParams, req);
    const input = parseBody(
      z.object({
        filename: z.string().trim().min(1).max(255),
        size: z.coerce.number().int().min(1).max(50 * 1024 ** 3),
        declaredMime: z.string().max(255).nullish(),
        checksum: z.string().regex(/^[0-9a-fA-F]{64}$/).nullish(),
        submitter: z.string().trim().max(80).nullish(),
      }),
      req,
    );

    const request = await gate(req, slug);
    assertRoomFor(request, input.size);

    const owner = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', request.ownerId)
      .executeTakeFirstOrThrow();

    await reserveSlot(request.id, input.size);
    try {
      const outcome = await createSession(
        owner,
        {
          filename: input.filename,
          size: input.size,
          declaredMime: input.declaredMime ?? null,
          folderId: request.folderId,
          checksum: input.checksum ?? null,
          onConflict: 'rename',
          requestId: request.id,
          submitter: input.submitter ?? null,
        },
        req,
      );

      noStore(res);
      if (outcome.kind === 'instant') {
        await recordSubmission(
          request.id,
          {
            fileId: outcome.result.file.id,
            filename: outcome.result.file.name,
            sizeBytes: outcome.result.file.sizeBytes,
            submitter: input.submitter ?? null,
          },
          req,
        );
        res.status(201).json({ instant: true, filename: outcome.result.file.name });
        return;
      }
      res.status(201).json({ instant: false, session: outcome.session });
    } catch (err) {
      await releaseSlot(request.id, input.size);
      throw err;
    }
  }),
);

/**
 * Chunk and completion endpoints for an anonymous sender.
 *
 * The credential is the session id — an unguessable UUID bound to this link — so
 * the checks are: the link is still valid, and the session belongs to it. Note
 * that the response deliberately never exposes anything about the owner's drive.
 */
async function sessionForRequest(slug: string, sessionId: string, req: ExpressRequest) {
  const request = await gate(req, slug);
  const session = await db
    .selectFrom('upload_sessions')
    .select(['id', 'owner_id', 'request_id', 'size_bytes'])
    .where('id', '=', sessionId)
    .executeTakeFirst();
  if (!session || session.request_id !== request.id) {
    throw new AppError('not_found', 'That upload session does not exist.');
  }
  return { request, session };
}

publicRequestsRouter.put(
  '/:slug/uploads/:sessionId/chunks/:index',
  route(async (req, res) => {
    const { slug, sessionId, index } = parseParams(
      slugParams.extend({ sessionId: uuid, index: z.coerce.number().int().min(0).max(99_999) }),
      req,
    );
    const { session } = await sessionForRequest(slug, sessionId, req);
    const declared = req.get('content-length');
    const sha = req.get('x-chunk-sha256');
    if (sha && !/^[0-9a-fA-F]{64}$/.test(sha)) {
      throw new AppError('bad_request', 'X-Chunk-Sha256 must be a hex SHA-256 digest.');
    }

    const result = await receiveChunk({
      sessionId,
      ownerId: session.owner_id,
      index,
      body: req,
      declaredLength: declared === undefined ? undefined : Number(declared),
      expectedSha: sha ?? undefined,
    });
    noStore(res);
    res.json(result);
  }),
);

publicRequestsRouter.get(
  '/:slug/uploads/:sessionId',
  route(async (req, res) => {
    const { slug, sessionId } = parseParams(slugParams.extend({ sessionId: uuid }), req);
    const { session } = await sessionForRequest(slug, sessionId, req);
    noStore(res);
    res.json({ session: await getSession(sessionId, session.owner_id) });
  }),
);

publicRequestsRouter.post(
  '/:slug/uploads/:sessionId/complete',
  route(async (req, res) => {
    const { slug, sessionId } = parseParams(slugParams.extend({ sessionId: uuid }), req);
    const { request, session } = await sessionForRequest(slug, sessionId, req);
    const submitter = String(req.body?.submitter ?? '').trim().slice(0, 80) || null;

    const result = await completeSession(sessionId, session.owner_id, req);
    await recordSubmission(
      request.id,
      {
        fileId: result.file.id,
        filename: result.file.name,
        sizeBytes: result.file.sizeBytes,
        submitter,
      },
      req,
    );

    noStore(res);
    // The sender is told what they sent, and nothing about where it landed.
    res.status(201).json({
      received: { filename: result.file.name, sizeBytes: result.file.sizeBytes, checksum: result.file.checksum },
    });
  }),
);

publicRequestsRouter.delete(
  '/:slug/uploads/:sessionId',
  route(async (req, res) => {
    const { slug, sessionId } = parseParams(slugParams.extend({ sessionId: uuid }), req);
    const { session } = await sessionForRequest(slug, sessionId, req);
    await abandonSession(sessionId, 'sender_cancelled', session.owner_id);
    res.status(204).end();
  }),
);

import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth, requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { AppError } from '../../lib/errors.js';
import { noStore, parseBody, parseParams, parseQuery, route, uuid } from '../../lib/http.js';
import { signShareGrant, verifyShareGrant } from '../../lib/tokens.js';
import { recordEvent } from '../activity/service.js';
import { streamBlob } from '../files/download.js';
import { registerDownload } from '../files/service.js';
import { receiptsRoute } from '../insights/routes.js';
import { createShareSchema, slugParams, unlockSchema, updateShareSchema } from './schemas.js';
import {
  checkSharePassword,
  claimDownload,
  createShare,
  listAllShares,
  listSharesForFile,
  resolveShare,
  revokeShare,
  touchShare,
  updateShare,
} from './service.js';

// ───────────────────────── owner-facing: /api/shares ────────────────────────

export const sharesRouter = Router();
sharesRouter.use(requireAuth);

sharesRouter.get(
  '/',
  route(async (req, res) => {
    noStore(res);
    res.json({ shares: await listAllShares(req.auth!.user.id) });
  }),
);

sharesRouter.get(
  '/for/:fileId',
  route(async (req, res) => {
    const { fileId } = parseParams(z.object({ fileId: uuid }), req);
    res.json({ shares: await listSharesForFile(req.auth!.user.id, fileId) });
  }),
);

sharesRouter.post(
  '/',
  rateLimit({ name: 'share-create', windowMs: 60_000, max: 60 }),
  route(async (req, res) => {
    const input = parseBody(createShareSchema, req);
    const share = await createShare(
      req.auth!.user.id,
      input.fileId,
      {
        label: input.label ?? null,
        password: input.password ?? null,
        expiresAt: input.expiresAt ?? null,
        maxDownloads: input.maxDownloads ?? null,
        allowPreview: input.allowPreview,
      },
      req,
    );
    res.status(201).json({ share });
  }),
);

/** Who has opened this link, and when. */
sharesRouter.get('/:id/receipts', receiptsRoute);

sharesRouter.patch(
  '/:id',
  route(async (req, res) => {
    const { id } = parseParams(z.object({ id: uuid }), req);
    const patch = parseBody(updateShareSchema, req);
    res.json({ share: await updateShare(req.auth!.user.id, id, patch, req) });
  }),
);

sharesRouter.delete(
  '/:id',
  route(async (req, res) => {
    const { id } = parseParams(z.object({ id: uuid }), req);
    await revokeShare(req.auth!.user.id, id, req);
    res.status(204).end();
  }),
);

// ───────────────────────── public: /api/s/:slug ─────────────────────────────

export const publicSharesRouter = Router();

const browseLimit = rateLimit({ name: 'share-view', windowMs: 60_000, max: 120 });
const unlockLimit = rateLimit({
  name: 'share-unlock',
  windowMs: 15 * 60_000,
  max: 10,
  key: (req) => String(req.params.slug ?? '').slice(0, 64),
  message: 'Too many password attempts for this link. Try again later.',
});

/** Was this request already unlocked? (owner sessions skip the password.) */
async function isUnlocked(req: Parameters<typeof optionalAuth>[0], slug: string, ownerId?: string): Promise<boolean> {
  if (ownerId && req.auth?.user.id === ownerId) return true;
  const token = (req.get('x-share-grant') ?? (req.query.g as string | undefined) ?? '').trim();
  return token ? verifyShareGrant(token, slug) : false;
}

publicSharesRouter.get(
  '/:slug',
  browseLimit,
  optionalAuth,
  route(async (req, res) => {
    const { slug } = parseParams(slugParams, req);
    const share = await resolveShare(slug);
    noStore(res);

    // Nothing about the file — not even its name — before the password is in.
    if (share.requiresPassword && !(await isUnlocked(req, slug))) {
      await recordEvent({ type: 'share.view', shareId: share.shareId, fileId: share.fileId, metadata: { locked: true }, req });
      res.json({
        share: {
          slug,
          requiresPassword: true,
          ownerName: share.ownerName,
          createdAt: share.createdAt,
          expiresAt: share.expiresAt,
        },
      });
      return;
    }

    await touchShare(share.shareId);
    await recordEvent({ type: 'share.view', shareId: share.shareId, fileId: share.fileId, subject: share.name, req });

    res.json({
      share: {
        slug,
        requiresPassword: share.requiresPassword,
        unlocked: true,
        ownerName: share.ownerName,
        createdAt: share.createdAt,
        expiresAt: share.expiresAt,
        maxDownloads: share.maxDownloads,
        downloadCount: share.downloadCount,
        remainingDownloads:
          share.maxDownloads === null ? null : Math.max(0, share.maxDownloads - share.downloadCount),
        allowPreview: share.allowPreview,
        file: {
          name: share.name,
          kind: share.kind,
          mimeType: share.mimeType,
          sizeBytes: share.sizeBytes,
          checksum: share.checksum,
        },
      },
    });
  }),
);

publicSharesRouter.post(
  '/:slug/unlock',
  unlockLimit,
  route(async (req, res) => {
    const { slug } = parseParams(slugParams, req);
    const { password } = parseBody(unlockSchema, req);
    const share = await resolveShare(slug);

    if (!share.requiresPassword) {
      res.json({ grant: await signShareGrant(slug) });
      return;
    }

    if (!(await checkSharePassword(share, password))) {
      await recordEvent({
        type: 'share.denied',
        shareId: share.shareId,
        fileId: share.fileId,
        metadata: { reason: 'bad_password' },
        req,
      });
      throw new AppError('share_password_invalid', 'That password is not correct.');
    }

    noStore(res);
    res.json({ grant: await signShareGrant(slug), expiresIn: 1800 });
  }),
);

const servePublic = route(async (req, res) => {
  const { slug } = parseParams(slugParams, req);
  const { disposition } = parseQuery(
    z.object({ disposition: z.enum(['inline', 'attachment', 'auto']).default('attachment') }),
    req,
  );
  const share = await resolveShare(slug);

  if (share.requiresPassword && !(await isUnlocked(req, slug))) {
    throw new AppError('share_password_required', 'This link is password protected.');
  }
  if (disposition === 'inline' && !share.allowPreview) {
    throw new AppError('forbidden', 'Preview is disabled for this link — download it instead.');
  }

  const isFullDownload = req.method === 'GET' && !req.get('range');

  // Claim the download *before* streaming: a budget that is checked after the
  // bytes have left is not a budget.
  if (isFullDownload && disposition !== 'inline') {
    if (!(await claimDownload(share.shareId))) {
      throw new AppError('share_exhausted', 'This link has reached its download limit.');
    }
  }

  await streamBlob(req, res, share, { wants: disposition, isPublic: true });

  if (isFullDownload) {
    await registerDownload(share.fileId);
    await recordEvent({
      type: disposition === 'inline' ? 'share.view' : 'share.download',
      shareId: share.shareId,
      fileId: share.fileId,
      subject: share.name,
      metadata: { disposition },
      req,
    });
  }
});

publicSharesRouter.get('/:slug/content', browseLimit, optionalAuth, servePublic);
publicSharesRouter.head('/:slug/content', browseLimit, optionalAuth, servePublic);

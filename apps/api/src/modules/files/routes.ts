import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { AppError, isAppError } from '../../lib/errors.js';
import { noStore, parseBody, parseParams, parseQuery, route, uuid } from '../../lib/http.js';
import { recordEvent } from '../activity/service.js';
import { streamBlob } from './download.js';
import type { FileDTO } from './dto.js';
import {
  dispositionSchema,
  idsSchema,
  listQuerySchema,
  patchFileSchema,
  uploadFieldsSchema,
} from './schemas.js';
import { ingest } from './ingest.js';
import {
  emptyTrash,
  getFile,
  listFiles,
  moveFile,
  purgeFiles,
  registerDownload,
  renameFile,
  resolveOwnDownload,
  restoreFiles,
  setStarred,
  setVisibility,
  storageStats,
  trashFiles,
} from './service.js';
import { discardBlobs, receiveMultipart } from './upload.js';
import { deleteVersion, listVersions, restoreVersion } from './versions.js';

const idParams = z.object({ id: uuid });

export const filesRouter = Router();
filesRouter.use(requireAuth);

// ── upload ───────────────────────────────────────────────────────────────────
filesRouter.post(
  '/',
  rateLimit({ name: 'upload', windowMs: 60_000, max: 120, message: 'Slow down — too many uploads in a minute.' }),
  route(async (req, res) => {
    const { blobs, fields } = await receiveMultipart(req, {
      maxBytes: env.MAX_UPLOAD_BYTES,
      maxFiles: env.MAX_FILES_PER_UPLOAD,
    });

    let parsedFields;
    try {
      parsedFields = uploadFieldsSchema.parse(fields);
    } catch (err) {
      await discardBlobs(blobs);
      throw new AppError('validation_failed', 'Upload metadata was invalid.', {
        details: { fields: Object.keys(fields) },
        cause: err,
      });
    }

    const created: FileDTO[] = [];
    const rejected: Array<{ name: string; code: string; message: string }> = [];
    const failures: AppError[] = [];
    // Reported back so the client can say "already in your drive, added
    // instantly" rather than pretending it transferred something.
    let dedupedCount = 0;
    let versionedCount = 0;

    // Per-file outcomes: one bad file in a drag-and-drop of twelve should not
    // discard the other eleven.
    for (const blob of blobs) {
      try {
        const result = await ingest(
          req.auth!.user,
          {
            filename: blob.filename,
            declaredMime: blob.declaredMime,
            spoolPath: blob.spoolPath,
            size: blob.size,
            checksum: blob.checksum,
            head: blob.head,
          },
          {
            folderId: parsedFields.folderId ?? null,
            visibility: parsedFields.visibility,
            onConflict: parsedFields.onConflict,
            source: 'upload',
          },
          req,
        );
        created.push(result.file);
        if (result.deduped) dedupedCount += 1;
        if (result.versioned) versionedCount += 1;
      } catch (err) {
        if (isAppError(err)) {
          rejected.push({ name: blob.filename, code: err.code, message: err.message });
          failures.push(err);
        } else {
          throw err;
        }
      }
    }

    noStore(res);
    // Nothing landed: answer with the status the first failure actually earned
    // (413 too large, 415 unsupported, 507 out of space) instead of flattening
    // every cause into one generic code.
    if (created.length === 0) {
      const first = failures[0];
      throw new AppError(first?.code ?? 'upload_failed', first?.message ?? 'Upload failed.', {
        details: { rejected, ...(first?.details ?? {}) },
      });
    }
    res.status(201).json({ files: created, rejected, deduped: dedupedCount, versioned: versionedCount });
  }),
);

// ── listing & stats (before /:id so the words are not read as ids) ───────────
filesRouter.get(
  '/',
  route(async (req, res) => {
    const query = parseQuery(listQuerySchema, req);
    const result = await listFiles(req.auth!.user.id, {
      scope: query.scope,
      folderId: query.folderId ?? null,
      q: query.q,
      kind: query.kind,
      sort: query.sort,
      dir: query.dir,
      limit: query.limit,
      cursor: query.cursor,
    });
    res.json(result);
  }),
);

filesRouter.get(
  '/stats',
  route(async (req, res) => {
    noStore(res);
    res.json(await storageStats(req.auth!.user));
  }),
);

// ── bulk actions ─────────────────────────────────────────────────────────────
filesRouter.post(
  '/actions/trash',
  route(async (req, res) => {
    const { ids } = parseBody(idsSchema, req);
    res.json({ trashed: await trashFiles(req.auth!.user.id, ids, req) });
  }),
);

filesRouter.post(
  '/actions/restore',
  route(async (req, res) => {
    const { ids } = parseBody(idsSchema, req);
    res.json({ restored: await restoreFiles(req.auth!.user.id, ids, req) });
  }),
);

filesRouter.post(
  '/actions/purge',
  route(async (req, res) => {
    const { ids } = parseBody(idsSchema, req);
    res.json({ purged: await purgeFiles(req.auth!.user.id, ids, req) });
  }),
);

filesRouter.post(
  '/actions/move',
  route(async (req, res) => {
    const { ids, folderId } = parseBody(idsSchema.extend({ folderId: uuid.nullish() }), req);
    const moved: FileDTO[] = [];
    const failed: Array<{ id: string; message: string }> = [];
    for (const id of ids) {
      try {
        moved.push(await moveFile(req.auth!.user.id, id, folderId ?? null, req));
      } catch (err) {
        if (isAppError(err)) failed.push({ id, message: err.message });
        else throw err;
      }
    }
    res.json({ files: moved, failed });
  }),
);

filesRouter.post(
  '/actions/star',
  route(async (req, res) => {
    const { ids, starred } = parseBody(idsSchema.extend({ starred: z.boolean() }), req);
    const files: FileDTO[] = [];
    for (const id of ids) files.push(await setStarred(req.auth!.user.id, id, starred));
    res.json({ files });
  }),
);

filesRouter.delete(
  '/trash',
  route(async (req, res) => {
    res.json({ purged: await emptyTrash(req.auth!.user.id, req) });
  }),
);

// ── version history ─────────────────────────────────────────────────────────
const versionParams = z.object({ id: uuid, version: z.coerce.number().int().min(1).max(100_000) });

filesRouter.get(
  '/:id/versions',
  route(async (req, res) => {
    const { id } = parseParams(idParams, req);
    res.json({ versions: await listVersions(req.auth!.user.id, id) });
  }),
);

filesRouter.post(
  '/:id/versions/:version/restore',
  route(async (req, res) => {
    const { id, version } = parseParams(versionParams, req);
    res.json({ file: await restoreVersion(req.auth!.user.id, id, version, req) });
  }),
);

filesRouter.delete(
  '/:id/versions/:version',
  route(async (req, res) => {
    const { id, version } = parseParams(versionParams, req);
    res.json(await deleteVersion(req.auth!.user.id, id, version, req));
  }),
);

// ── single file ──────────────────────────────────────────────────────────────
filesRouter.get(
  '/:id',
  route(async (req, res) => {
    const { id } = parseParams(idParams, req);
    res.json(await getFile(req.auth!.user.id, id));
  }),
);

const serveOwn = route(async (req, res) => {
  const { id } = parseParams(idParams, req);
  const { disposition, version } = parseQuery(dispositionSchema, req);
  const blob = await resolveOwnDownload(req.auth!.user.id, id, version);
  await streamBlob(req, res, blob, { wants: disposition, isPublic: false });

  // Count a download once per full transfer, and never for a range probe.
  if (req.method === 'GET' && !req.get('range')) {
    await registerDownload(id);
    await recordEvent({ type: 'file.download', actorId: req.auth!.user.id, fileId: id, subject: blob.name, req });
  }
});

filesRouter.get('/:id/content', serveOwn);
filesRouter.head('/:id/content', serveOwn);

filesRouter.patch(
  '/:id',
  route(async (req, res) => {
    const { id } = parseParams(idParams, req);
    const patch = parseBody(patchFileSchema, req);
    const userId = req.auth!.user.id;

    let file: FileDTO | null = null;
    if (patch.name !== undefined) file = await renameFile(userId, id, patch.name, req);
    if (patch.folderId !== undefined) file = await moveFile(userId, id, patch.folderId ?? null, req);
    if (patch.starred !== undefined) file = await setStarred(userId, id, patch.starred);
    if (patch.visibility !== undefined) {
      const result = await setVisibility(userId, id, patch.visibility, req);
      res.json(result);
      return;
    }
    res.json(file ? await getFile(userId, id) : await getFile(userId, id));
  }),
);

filesRouter.delete(
  '/:id',
  route(async (req, res) => {
    const { id } = parseParams(idParams, req);
    const trashed = await trashFiles(req.auth!.user.id, [id], req);
    if (trashed === 0) throw new AppError('not_found', 'File not found.');
    res.status(204).end();
  }),
);

import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';
import { parseBody, parseParams, route, uuid } from '../../lib/http.js';
import { recordEvent } from '../activity/service.js';
import {
  breadcrumbs,
  createFolder,
  listFolders,
  moveFolder,
  renameFolder,
  restoreFolder,
  trashFolder,
} from './service.js';

const nameSchema = z.string().trim().min(1, 'Give the folder a name.').max(255);
const idParams = z.object({ id: uuid });

export const foldersRouter = Router();
foldersRouter.use(requireAuth);

foldersRouter.get(
  '/',
  route(async (req, res) => {
    res.json({ folders: await listFolders(req.auth!.user.id) });
  }),
);

foldersRouter.post(
  '/',
  route(async (req, res) => {
    const input = parseBody(
      z.object({ name: nameSchema, parentId: uuid.nullish() }),
      req,
    );
    const folder = await createFolder(req.auth!.user.id, input);
    await recordEvent({ type: 'folder.create', actorId: req.auth!.user.id, subject: folder.name, req });
    res.status(201).json({ folder });
  }),
);

foldersRouter.get(
  '/:id/breadcrumbs',
  route(async (req, res) => {
    const { id } = parseParams(idParams, req);
    res.json({ trail: await breadcrumbs(req.auth!.user.id, id) });
  }),
);

foldersRouter.patch(
  '/:id',
  route(async (req, res) => {
    const { id } = parseParams(idParams, req);
    const input = parseBody(
      z.object({ name: nameSchema.optional(), parentId: uuid.nullish() }).refine(
        (v) => v.name !== undefined || v.parentId !== undefined,
        'Nothing to update.',
      ),
      req,
    );

    let folder = null;
    if (input.name !== undefined) {
      folder = await renameFolder(req.auth!.user.id, id, input.name);
      await recordEvent({ type: 'folder.rename', actorId: req.auth!.user.id, subject: folder.name, req });
    }
    if (input.parentId !== undefined) {
      folder = await moveFolder(req.auth!.user.id, id, input.parentId ?? null);
    }
    res.json({ folder });
  }),
);

foldersRouter.delete(
  '/:id',
  route(async (req, res) => {
    const { id } = parseParams(idParams, req);
    const counts = await trashFolder(req.auth!.user.id, id, env.TRASH_RETENTION_DAYS);
    await recordEvent({
      type: 'folder.trash',
      actorId: req.auth!.user.id,
      metadata: counts,
      req,
    });
    res.json(counts);
  }),
);

foldersRouter.post(
  '/:id/restore',
  route(async (req, res) => {
    const { id } = parseParams(idParams, req);
    await restoreFolder(req.auth!.user.id, id);
    await recordEvent({ type: 'folder.restore', actorId: req.auth!.user.id, req });
    res.status(204).end();
  }),
);

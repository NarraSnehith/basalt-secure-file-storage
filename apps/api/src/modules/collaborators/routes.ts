import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { noStore, parseBody, parseParams, route, uuid } from '../../lib/http.js';
import { emailSchema } from '../auth/schemas.js';
import { listSharedWithMe } from './access.js';
import {
  inviteCollaborator,
  listCollaborators,
  revokeCollaborator,
  sharedOutFolderIds,
} from './service.js';

const roleSchema = z.enum(['viewer', 'contributor', 'editor']);

/**
 * Collaborators live under the folder they apply to — `/folders/:id/people` —
 * because that is the thing being shared. "Shared with me" is the mirror of it
 * and hangs off the root.
 */
export const collaboratorsRouter = Router();
collaboratorsRouter.use(requireAuth);

/** Folders other people have shared with me. */
collaboratorsRouter.get(
  '/shared-with-me',
  route(async (req, res) => {
    noStore(res);
    res.json({ folders: await listSharedWithMe(req.auth!.user) });
  }),
);

/** Which of my own folders I have shared out, for badging the sidebar. */
collaboratorsRouter.get(
  '/shared-out',
  route(async (req, res) => {
    noStore(res);
    res.json({ folderIds: await sharedOutFolderIds(req.auth!.user.id) });
  }),
);

collaboratorsRouter.get(
  '/folders/:id/people',
  route(async (req, res) => {
    const { id } = parseParams(z.object({ id: uuid }), req);
    res.json({ people: await listCollaborators(req.auth!.user.id, id) });
  }),
);

collaboratorsRouter.post(
  '/folders/:id/people',
  // An invitation is a write to somebody else's inbox in spirit, even without
  // email delivery; worth a limit so a script cannot enumerate addresses.
  rateLimit({ name: 'invite', windowMs: 60_000, max: 30 }),
  route(async (req, res) => {
    const { id } = parseParams(z.object({ id: uuid }), req);
    const input = parseBody(z.object({ email: emailSchema, role: roleSchema.default('viewer') }), req);
    const person = await inviteCollaborator(req.auth!.user, id, input, req);
    res.status(201).json({ person });
  }),
);

collaboratorsRouter.delete(
  '/folders/:id/people/:personId',
  route(async (req, res) => {
    const { id, personId } = parseParams(z.object({ id: uuid, personId: uuid }), req);
    await revokeCollaborator(req.auth!.user.id, id, personId, req);
    res.status(204).end();
  }),
);

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { parseQuery, route } from '../../lib/http.js';
import { listActivity } from './service.js';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().regex(/^\d+$/).optional(),
  fileId: z.string().uuid().optional(),
  type: z.string().max(200).optional(),
});

export const activityRouter = Router();

activityRouter.get(
  '/',
  requireAuth,
  route(async (req, res) => {
    const q = parseQuery(querySchema, req);
    const items = await listActivity(req.auth!.user.id, {
      limit: q.limit,
      before: q.before,
      fileId: q.fileId,
      types: q.type?.split(',').filter(Boolean),
    });
    res.json({
      items,
      nextCursor: items.length === q.limit ? items[items.length - 1]!.id : null,
    });
  }),
);

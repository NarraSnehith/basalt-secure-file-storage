import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { noStore, parseParams, route, uuid } from '../../lib/http.js';
import { buildInsights, shareReceipts } from './service.js';

export const insightsRouter = Router();
insightsRouter.use(requireAuth);

insightsRouter.get(
  '/',
  route(async (req, res) => {
    noStore(res);
    res.json(await buildInsights(req.auth!.user));
  }),
);

export const receiptsRoute = route(async (req, res) => {
  const { id } = parseParams(z.object({ id: uuid }), req);
  noStore(res);
  res.json({ receipts: await shareReceipts(req.auth!.user.id, id) });
});

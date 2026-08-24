import express, { type Express, type Request } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { env, isProd } from './config/env.js';
import { assertDatabaseReachable } from './db/client.js';
import { AppError } from './lib/errors.js';
import { route } from './lib/http.js';
import { requestContext, httpLogger } from './middleware/context.js';
import { csrfGuard, issueCsrfCookie } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { rateLimit } from './middleware/rate-limit.js';
import { activityRouter } from './modules/activity/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { filesRouter } from './modules/files/routes.js';
import { foldersRouter } from './modules/folders/routes.js';
import { collaboratorsRouter } from './modules/collaborators/routes.js';
import { insightsRouter } from './modules/insights/routes.js';
import { publicRequestsRouter, requestsRouter } from './modules/requests/routes.js';
import { publicSharesRouter, sharesRouter } from './modules/shares/routes.js';
import { uploadsRouter } from './modules/uploads/routes.js';

const globalLimit = rateLimit({ name: 'global', windowMs: 60_000, max: 1200 });

/** Exported so the exemption itself is covered by a test. */
export const isChunkUpload = (req: Pick<Request, 'method' | 'path'>): boolean =>
  req.method === 'PUT' && /\/chunks\/\d+$/.test(req.path);

export function createApp(): Express {
  const app = express();

  // Only honour X-Forwarded-* when we are actually behind a proxy, otherwise a
  // client could spoof its own IP and defeat every rate limit.
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);
  app.disable('x-powered-by');
  app.disable('etag'); // we set precise ETags on the routes that need them

  app.use(
    helmet({
      // This process only ever emits JSON and file bytes, never a document, so
      // the strictest possible policy is also the correct one.
      contentSecurityPolicy: { useDefaults: false, directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"] } },
      crossOriginResourcePolicy: false, // set per-response in the download path
      referrerPolicy: { policy: 'no-referrer' },
      hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    }),
  );

  app.use(
    cors({
      origin: (origin, cb) => {
        // Same-origin / server-to-server requests arrive without an Origin.
        if (!origin) return cb(null, true);
        const allowed = [env.WEB_ORIGIN, ...(isProd ? [] : ['http://localhost:3000', 'http://127.0.0.1:3000'])];
        return allowed.includes(origin) ? cb(null, true) : cb(new AppError('forbidden', 'Origin not allowed.'));
      },
      credentials: true,
      // PUT carries upload chunks; the grant headers carry proof that a
      // password-protected share or upload link was unlocked.
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'X-CSRF-Token',
        'X-Share-Grant',
        'X-Request-Grant',
        'X-Chunk-Sha256',
        'X-Request-Id',
        'Authorization',
        'Range',
        'If-None-Match',
      ],
      exposedHeaders: ['X-Request-Id', 'Content-Range', 'Accept-Ranges', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
      maxAge: 600,
    }),
  );

  app.use(requestContext);
  app.use(httpLogger);
  app.use(cookieParser());
  // JSON bodies are small by definition here; file bytes arrive as multipart and
  // are streamed by the upload route, never buffered by a body parser.
  app.use(express.json({ limit: '128kb' }));
  // Any safe request establishes the double-submit cookie, so a first-time
  // visitor can sign in without a separate handshake round trip.
  app.use('/api', issueCsrfCookie);

  app.get(
    '/api/health',
    route(async (_req, res) => {
      const started = Date.now();
      try {
        await assertDatabaseReachable();
        res.json({
          status: 'ok',
          service: 'basalt-api',
          storage: env.STORAGE_DRIVER,
          dbLatencyMs: Date.now() - started,
          uptimeSeconds: Math.round(process.uptime()),
        });
      } catch {
        res.status(503).json({ status: 'degraded', service: 'basalt-api', error: 'database unreachable' });
      }
    }),
  );

  /*
   * A floor under everything, so a single client cannot monopolise the process.
   *
   * Upload chunks are deliberately exempt. One resumable upload is around four
   * hundred PUTs, so three files in a minute would trip a global request cap —
   * the limiter would break the feature it was meant to protect. Chunks are
   * bounded by something better than a request counter: a session has to exist,
   * every chunk is validated against its declared size and offset, and an
   * account may only hold a couple of dozen open sessions at once.
   */
  app.use('/api', (req, res, next) => {
    if (isChunkUpload(req)) return next();
    return globalLimit(req, res, next);
  });

  // Public share and upload-link endpoints carry no ambient credentials, so CSRF
  // does not apply; everything else is cookie-authenticated and guarded.
  app.use('/api/s', publicSharesRouter);
  app.use('/api/r', publicRequestsRouter);

  app.use('/api/auth', csrfGuard, authRouter);
  app.use('/api/folders', csrfGuard, foldersRouter);
  app.use('/api/files', csrfGuard, filesRouter);
  app.use('/api/uploads', csrfGuard, uploadsRouter);
  app.use('/api/shares', csrfGuard, sharesRouter);
  app.use('/api/requests', csrfGuard, requestsRouter);
  app.use('/api/activity', csrfGuard, activityRouter);
  app.use('/api/insights', csrfGuard, insightsRouter);
  app.use('/api/collab', csrfGuard, collaboratorsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

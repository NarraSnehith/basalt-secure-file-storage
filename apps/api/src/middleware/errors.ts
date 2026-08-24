import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, isAppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isProd } from '../config/env.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError('not_found', `No route matches ${req.method} ${req.path}.`));
};

/**
 * The single exit point for failures. Known (AppError) failures are reported
 * verbatim; anything else is logged with its stack and reduced to a generic
 * 500 so internals — SQL, paths, driver messages — never reach a client.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = (res.locals?.requestId as string | undefined) ?? null;

  if (isAppError(err)) {
    if (err.status >= 500) {
      logger.error({ err, requestId, path: req.path }, 'request failed');
    }
    if (!res.headersSent) {
      res.status(err.status).json({ ...err.toJSON(), requestId });
    }
    return;
  }

  // express.json() body-parser failures arrive as plain SyntaxErrors.
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      error: { code: 'bad_request', message: 'Request body is not valid JSON.' },
      requestId,
    });
    return;
  }

  logger.error({ err, requestId, path: req.path, method: req.method }, 'unhandled error');

  if (res.headersSent) {
    res.destroy();
    return;
  }

  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong on our side. The incident was logged.',
      ...(isProd ? {} : { debug: err instanceof Error ? err.message : String(err) }),
    },
    requestId,
  });
};

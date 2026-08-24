import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { AppError, type FieldErrors } from './errors.js';

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export const route =
  <T>(fn: (req: Request, res: Response, next: NextFunction) => Promise<T>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

function toFieldErrors(error: z.ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

function parse<S extends ZodTypeAny>(schema: S, value: unknown, what: string): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError('validation_failed', `Invalid ${what}.`, { fields: toFieldErrors(result.error) });
  }
  return result.data;
}

export const parseBody = <S extends ZodTypeAny>(schema: S, req: Request): z.infer<S> =>
  parse(schema, req.body, 'request body');

export const parseQuery = <S extends ZodTypeAny>(schema: S, req: Request): z.infer<S> =>
  parse(schema, req.query, 'query parameters');

export const parseParams = <S extends ZodTypeAny>(schema: S, req: Request): z.infer<S> =>
  parse(schema, req.params, 'path parameters');

/** Client IP, honouring X-Forwarded-For only when the app is told to trust it. */
export function clientIp(req: Request): string {
  const ip = req.ip ?? req.socket.remoteAddress ?? '';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export const userAgent = (req: Request): string | null =>
  (req.get('user-agent') ?? '').slice(0, 512) || null;

export const uuid = z.string().uuid('must be a valid id');

export const noStore = (res: Response): void => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
};

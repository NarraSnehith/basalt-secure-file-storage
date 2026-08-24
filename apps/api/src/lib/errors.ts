/**
 * One error type crosses the whole app. Handlers throw it, the error
 * middleware turns it into an RFC-9457-shaped JSON body. Anything that is *not*
 * an AppError is treated as a bug: logged with its stack, reported as a bare
 * 500 with no internals leaked to the client.
 */
export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'forbidden'
  | 'csrf_failed'
  | 'not_found'
  | 'conflict'
  | 'gone'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'share_password_required'
  | 'share_password_invalid'
  | 'share_expired'
  | 'share_exhausted'
  | 'upload_failed'
  | 'internal_error'
  | 'service_unavailable';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  invalid_credentials: 401,
  forbidden: 403,
  csrf_failed: 403,
  not_found: 404,
  conflict: 409,
  gone: 410,
  payload_too_large: 413,
  unsupported_media_type: 415,
  quota_exceeded: 507,
  rate_limited: 429,
  share_password_required: 401,
  share_password_invalid: 403,
  share_expired: 410,
  share_exhausted: 410,
  upload_failed: 400,
  internal_error: 500,
  service_unavailable: 503,
};

export type FieldErrors = Record<string, string[]>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: FieldErrors;
  readonly details?: Record<string, unknown>;
  readonly expose = true;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { fields?: FieldErrors; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    if (opts.fields) this.fields = opts.fields;
    if (opts.details) this.details = opts.details;
    Error.captureStackTrace?.(this, AppError);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields ? { fields: this.fields } : {}),
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export const badRequest = (m: string, d?: Record<string, unknown>) => new AppError('bad_request', m, { details: d });
export const unauthenticated = (m = 'You need to sign in to do that.') => new AppError('unauthenticated', m);
export const forbidden = (m = 'You do not have access to this resource.') => new AppError('forbidden', m);
export const notFound = (what = 'Resource') => new AppError('not_found', `${what} not found.`);
export const conflict = (m: string, d?: Record<string, unknown>) => new AppError('conflict', m, { details: d });
export const tooLarge = (m: string, d?: Record<string, unknown>) => new AppError('payload_too_large', m, { details: d });
export const quotaExceeded = (m: string, d?: Record<string, unknown>) => new AppError('quota_exceeded', m, { details: d });
export const internal = (m = 'Something went wrong on our side.', cause?: unknown) =>
  new AppError('internal_error', m, { cause });

export const isAppError = (e: unknown): e is AppError =>
  e instanceof AppError || (typeof e === 'object' && e !== null && (e as AppError).name === 'AppError');

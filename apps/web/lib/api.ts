/**
 * The one place the browser talks to the API.
 *
 * Responsibilities kept here so no component has to think about them:
 *   · attach the CSRF header on every mutating call (read from the cookie the
 *     API sets, so it is always the current one)
 *   · turn error envelopes into a typed ApiError with per-field messages
 *   · refresh the access token exactly once when a call comes back 401, then
 *     replay the original request — concurrent 401s share one refresh
 */

/**
 * Where the API lives, as far as the browser is concerned.
 *
 * Default `/api` assumes a single-origin deployment (one proxy in front of both
 * services) — the simplest and safest shape, because cookies stay first-party.
 * In development the two run on separate ports and the browser talks to the API
 * directly: the Next dev server's rewrite proxy quietly fails on request bodies
 * over ~10 MB, which is unusable for a file service. Cross-origin is fine here
 * because both ports are the same *site*, so SameSite cookies still travel, and
 * the API's CORS allowlist names the web origin explicitly.
 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? '/api').replace(/\/$/, '');

export interface FieldErrors {
  [field: string]: string[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: FieldErrors;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: { fields?: FieldErrors; details?: Record<string, unknown>; requestId?: string } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = extra.fields;
    this.details = extra.details;
    this.requestId = extra.requestId;
  }

  /** First message for a field, for inline form errors. */
  field(name: string): string | undefined {
    return this.fields?.[name]?.[0];
  }

  get isAuth(): boolean {
    return this.status === 401;
  }
}

export const CSRF_COOKIE = 'basalt_csrf';

export function readCsrfToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

const UNSAFE = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Internal: prevents an infinite refresh loop. */
  retried?: boolean;
  raw?: boolean;
}

let refreshInFlight: Promise<boolean> | null = null;
type Listener = () => void;
const sessionLostListeners = new Set<Listener>();

/** Components subscribe so a lost session can bounce the user to sign-in once. */
export function onSessionLost(listener: Listener): () => void {
  sessionLostListeners.add(listener);
  return () => sessionLostListeners.delete(listener);
}

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': readCsrfToken() },
        credentials: 'include',
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // Let the next 401 start a fresh attempt.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();
  return refreshInFlight;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };

  if (UNSAFE.has(method)) headers['X-CSRF-Token'] = readCsrfToken();
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    // 'include' so cookies travel when the API is on another port; identical to
    // 'same-origin' behaviour when it is not.
    credentials: 'include',
    ...(options.body !== undefined
      ? { body: options.body instanceof FormData ? options.body : JSON.stringify(options.body) }
      : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    const error = (payload as { error?: { code?: string; message?: string; fields?: FieldErrors; details?: Record<string, unknown> } } | null)?.error;
    const code = error?.code ?? 'internal_error';

    // A stale access token is normal after 15 minutes — refresh and replay once.
    // The API says whether a refresh token is even present, so a signed-out
    // visitor does not pay for an attempt that cannot succeed.
    const refreshable = (error?.details as { refreshable?: boolean } | undefined)?.refreshable !== false;
    if (res.status === 401 && code === 'unauthenticated' && refreshable && !options.retried && path !== '/auth/refresh') {
      if (await refreshSession()) {
        return request<T>(path, { ...options, retried: true });
      }
      for (const listener of sessionLostListeners) listener();
    }

    throw new ApiError(res.status, code, error?.message ?? 'Something went wrong.', {
      fields: error?.fields,
      details: error?.details,
      requestId: (payload as { requestId?: string } | null)?.requestId,
    });
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};

/** Content URL for a file the signed-in owner is viewing. */
export const fileContentUrl = (id: string, disposition: 'inline' | 'attachment' = 'attachment'): string =>
  `${API_BASE}/files/${id}/content?disposition=${disposition}`;

/** Content URL for a public share, optionally carrying a password grant. */
export function shareContentUrl(
  slug: string,
  disposition: 'inline' | 'attachment',
  grant?: string | null,
): string {
  const params = new URLSearchParams({ disposition });
  if (grant) params.set('g', grant);
  return `${API_BASE}/s/${slug}/content?${params.toString()}`;
}

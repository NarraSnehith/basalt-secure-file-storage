/**
 * The part of a resumable upload that is worth writing exactly once: send a set
 * of chunk indices, several at a time, retrying an individual chunk rather than
 * the file, and reporting byte-level progress as it goes.
 *
 * Transport is injected, because the two callers differ in everything except
 * this loop — the signed-in dock talks to /uploads with a CSRF header, the
 * public upload page talks to /r/:slug/uploads with a grant — and the retry
 * logic should not be written twice and drift.
 */

export class ChunkError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ChunkError';
  }
}

export interface SendChunksOptions {
  file: File | Blob;
  chunkSize: number;
  /** Indices still needed, as reported by the server. */
  missing: number[];
  concurrency?: number;
  attempts?: number;
  signal: AbortSignal;
  /** Upload one chunk. Must reject with a ChunkError to control retry policy. */
  put: (index: number, blob: Blob, onProgress: (loaded: number) => void) => Promise<void>;
  /** Called whenever the confirmed/in-flight byte total changes. */
  onProgress: (confirmedChunks: number, inflightBytes: number) => void;
}

export async function sendChunks(opts: SendChunksOptions): Promise<void> {
  const { file, chunkSize, signal, put } = opts;
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const attempts = Math.max(1, opts.attempts ?? 3);

  const inflight = new Map<number, number>();
  let confirmed = 0;

  const report = () => {
    let bytes = 0;
    for (const value of inflight.values()) bytes += value;
    opts.onProgress(confirmed, bytes);
  };

  const sendOne = async (index: number): Promise<void> => {
    const start = index * chunkSize;
    const blob = file.slice(start, Math.min(start + chunkSize, file.size));

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await put(index, blob, (loaded) => {
          inflight.set(index, loaded);
          report();
        });
        inflight.delete(index);
        confirmed += 1;
        report();
        return;
      } catch (err) {
        inflight.delete(index);
        report();
        if (signal.aborted) throw err;
        const retryable = !(err instanceof ChunkError) || err.retryable;
        if (!retryable || attempt === attempts) throw err;
        // A chunk usually fails because the network hiccuped, not because the
        // bytes are wrong; back off a little and send the same range again.
        await new Promise((done) => setTimeout(done, 300 * attempt));
      }
    }
  };

  const queue = [...opts.missing];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (;;) {
        const index = queue.shift();
        if (index === undefined) return;
        await sendOne(index);
      }
    }),
  );
}

/**
 * PUT one chunk over XHR — the only transport that reports request-body
 * progress, which is the whole reason a progress bar can be honest.
 */
export function putChunkXhr(
  url: string,
  blob: Blob,
  headers: Record<string, string>,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    for (const [key, value] of Object.entries(headers)) {
      if (value) xhr.setRequestHeader(key, value);
    }
    xhr.responseType = 'json';

    const onAbort = () => xhr.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => signal.removeEventListener('abort', onAbort);

    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      const body = xhr.response as { error?: { message?: string; code?: string } } | null;
      reject(
        new ChunkError(
          body?.error?.message ?? `Chunk was rejected (${xhr.status}).`,
          body?.error?.code ?? String(xhr.status),
          // 5xx and 429 are worth waiting out; a 4xx about these bytes is not.
          xhr.status >= 500 || xhr.status === 429,
        ),
      );
    };
    xhr.onerror = () => {
      cleanup();
      reject(new ChunkError('Connection lost.', 'network', true));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new ChunkError('The connection timed out.', 'timeout', true));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new ChunkError('Aborted.', 'aborted', false));
    };
    xhr.send(blob);
  });
}

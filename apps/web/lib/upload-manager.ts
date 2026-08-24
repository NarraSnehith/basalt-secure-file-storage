import { API_BASE, readCsrfToken } from './api';
import { ChunkError, putChunkXhr, sendChunks } from './chunked';
import { hashFile } from './sha256';
import type { StoredFile } from './types';

/**
 * Transfer queue for resumable uploads.
 *
 * The shape of the problem: a 500 MB upload takes minutes, and in those minutes
 * a laptop sleeps, a train enters a tunnel, a tab gets reloaded. So the client
 * never treats an upload as one indivisible act:
 *
 *  1. hash the file first, and ask the server whether it already has these
 *     bytes. If it does, the upload is finished before it starts.
 *  2. otherwise open a session and send chunks, several at a time, retrying
 *     individual chunks rather than the file.
 *  3. on a network failure, pause instead of failing — the server is holding
 *     everything received so far, and resuming asks it what is still missing.
 *  4. remember session ids locally, so after a reload the dock can offer to
 *     finish an upload the user thought they had lost. The browser will not
 *     hand back the file contents without another gesture, so that one asks
 *     them to re-pick the file; everything already transferred still counts.
 */

export type TransferStatus =
  | 'hashing'
  | 'queued'
  | 'uploading'
  | 'paused'
  | 'done'
  | 'error'
  | 'cancelled';

export interface Transfer {
  id: string;
  sessionId: string | null;
  name: string;
  size: number;
  folderId: string | null;
  status: TransferStatus;
  /** Bytes the server has confirmed, plus progress on chunks in flight. */
  loaded: number;
  rate: number;
  samples: number[];
  /** 0..1 while the file is being hashed. */
  hashProgress: number;
  error: string | null;
  errorCode: string | null;
  attempt: number;
  startedAt: number | null;
  finishedAt: number | null;
  chunkSize: number;
  chunkCount: number;
  chunksDone: number;
  /** Finished without transferring anything: the account already had it. */
  instant: boolean;
  deduped: boolean;
  versioned: boolean;
  version: number;
  /** An adopted session whose file the browser can no longer read. */
  needsFile: boolean;
}

export interface ServerSession {
  id: string;
  filename: string;
  sizeBytes: number;
  chunkSize: number;
  chunkCount: number;
  receivedCount: number;
  missing: number[];
  uploadedBytes: number;
  folderId: string | null;
}

export interface UploadManagerOptions {
  maxBytes: number;
  /** Files transferring at once. */
  concurrency?: number;
  /** Chunks in flight per file. */
  chunkConcurrency?: number;
  onChange: (transfers: Transfer[]) => void;
  onUploaded: (files: StoredFile[], meta: { deduped: boolean; versioned: boolean }) => void;
  onQuotaChanged?: () => void;
}

/** Mirrors the server's blocklist so the rejection is instant and explained. */
const BLOCKED = new Set([
  'php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phps', 'phtml', 'phar',
  'jsp', 'jspx', 'jsw', 'jsv', 'jspf', 'asp', 'aspx', 'asa', 'asax', 'ascx',
  'ashx', 'asmx', 'axd', 'cshtml', 'vbhtml', 'cgi', 'fcgi', 'pht', 'shtml',
  'htaccess', 'htpasswd', 'ini', 'config',
]);

/** Above this, hashing costs more than the instant upload can save. */
const HASH_LIMIT = 512 * 1024 * 1024;
const STORAGE_KEY = 'basalt:sessions';

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

interface Job {
  transfer: Transfer;
  file: File | null;
  /** Aborts everything in flight for this transfer. */
  controller: AbortController | null;
  running: boolean;
}

interface Remembered {
  id: string;
  sessionId: string;
  name: string;
  size: number;
  folderId: string | null;
}

export class UploadManager {
  private readonly jobs = new Map<string, Job>();
  private readonly order: string[] = [];
  private readonly opts: UploadManagerOptions;
  private readonly concurrency: number;
  private readonly chunkConcurrency: number;
  private active = 0;
  private seq = 0;

  constructor(opts: UploadManagerOptions) {
    this.opts = opts;
    this.concurrency = opts.concurrency ?? 2;
    this.chunkConcurrency = opts.chunkConcurrency ?? 3;
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private emit(): void {
    this.opts.onChange(this.order.map((id) => ({ ...this.jobs.get(id)!.transfer })));
  }

  private blank(name: string, size: number, folderId: string | null): Transfer {
    this.seq += 1;
    return {
      id: `t${Date.now().toString(36)}-${this.seq}`,
      sessionId: null,
      name,
      size,
      folderId,
      status: 'queued',
      loaded: 0,
      rate: 0,
      samples: [],
      hashProgress: 0,
      error: null,
      errorCode: null,
      attempt: 0,
      startedAt: null,
      finishedAt: null,
      chunkSize: 0,
      chunkCount: 0,
      chunksDone: 0,
      instant: false,
      deduped: false,
      versioned: false,
      version: 1,
      needsFile: false,
    };
  }

  add(files: File[], folderId: string | null): void {
    for (const file of files) {
      const transfer = this.blank(file.name, file.size, folderId);

      // Fail fast, with a reason, rather than sending 400 MB to be refused.
      const ext = extensionOf(file.name);
      if (file.size === 0) {
        transfer.status = 'error';
        transfer.error = 'This file is empty.';
        transfer.errorCode = 'empty';
      } else if (file.size > this.opts.maxBytes) {
        transfer.status = 'error';
        transfer.error = `Over the ${Math.round(this.opts.maxBytes / 1024 / 1024)} MB limit for one file.`;
        transfer.errorCode = 'too_large';
      } else if (BLOCKED.has(ext)) {
        transfer.status = 'error';
        transfer.error = `.${ext} files are not accepted. Zip it and upload that.`;
        transfer.errorCode = 'blocked';
      }

      this.jobs.set(transfer.id, {
        transfer,
        file,
        controller: null,
        running: false,
      });
      this.order.push(transfer.id);
    }
    this.emit();
    this.pump();
  }

  /**
   * Adopt sessions the server still has open — the tail of an upload that a
   * reload interrupted. They start life needing the file back.
   */
  adopt(sessions: ServerSession[]): void {
    const remembered = this.remembered();
    for (const session of sessions) {
      if ([...this.jobs.values()].some((j) => j.transfer.sessionId === session.id)) continue;

      const transfer = this.blank(session.filename, session.sizeBytes, session.folderId);
      transfer.sessionId = session.id;
      transfer.chunkSize = session.chunkSize;
      transfer.chunkCount = session.chunkCount;
      transfer.chunksDone = session.receivedCount;
      transfer.loaded = session.uploadedBytes;
      transfer.status = 'paused';
      transfer.needsFile = true;
      transfer.error = 'Interrupted. Choose the file again to finish it.';
      transfer.id = remembered.find((r) => r.sessionId === session.id)?.id ?? transfer.id;

      this.jobs.set(transfer.id, {
        transfer,
        file: null,
        controller: null,
        running: false,
      });
      this.order.push(transfer.id);
    }
    this.emit();
  }

  /** Hand back a file for an adopted session, after checking it is the same one. */
  attachFile(id: string, file: File): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (file.size !== job.transfer.size) {
      job.transfer.error = `That file is ${file.size} bytes; this upload was ${job.transfer.size}.`;
      this.emit();
      return false;
    }
    job.file = file;
    job.transfer.needsFile = false;
    job.transfer.error = null;
    job.transfer.status = 'queued';
    this.emit();
    this.pump();
    return true;
  }

  // ── the queue ─────────────────────────────────────────────────────────────

  private pump(): void {
    while (this.active < this.concurrency) {
      const next = this.order
        .map((id) => this.jobs.get(id)!)
        .find((job) => job.transfer.status === 'queued' && !job.running && job.file);
      if (!next) return;
      this.active += 1;
      next.running = true;
      void this.run(next).finally(() => {
        this.active -= 1;
        next.running = false;
        this.pump();
      });
    }
  }

  private async run(job: Job): Promise<void> {
    const { transfer } = job;
    const file = job.file!;
    job.controller = new AbortController();
    const { signal } = job.controller;

    transfer.attempt += 1;
    transfer.error = null;
    transfer.errorCode = null;
    transfer.startedAt ??= Date.now();

    try {
      // ── 1. open (or re-open) a session ────────────────────────────────────
      if (!transfer.sessionId) {
        let checksum: string | null = null;
        if (file.size <= HASH_LIMIT) {
          transfer.status = 'hashing';
          this.emit();
          checksum = await hashFile(file, {
            signal,
            onProgress: (fraction) => {
              transfer.hashProgress = fraction;
              this.emit();
            },
          });
        }

        transfer.status = 'uploading';
        this.emit();

        const opened = await this.post<{
          instant: boolean;
          file?: StoredFile;
          versioned?: boolean;
          version?: number;
          session?: ServerSession;
        }>('/uploads', {
          filename: file.name,
          size: file.size,
          declaredMime: file.type || null,
          folderId: transfer.folderId,
          checksum,
          onConflict: 'version',
        }, signal);

        if (opened.instant && opened.file) {
          transfer.status = 'done';
          transfer.instant = true;
          transfer.deduped = true;
          transfer.versioned = Boolean(opened.versioned);
          transfer.version = opened.version ?? 1;
          transfer.loaded = transfer.size;
          transfer.finishedAt = Date.now();
          this.emit();
          this.opts.onUploaded([opened.file], { deduped: true, versioned: Boolean(opened.versioned) });
          this.opts.onQuotaChanged?.();
          return;
        }

        const session = opened.session!;
        transfer.sessionId = session.id;
        transfer.chunkSize = session.chunkSize;
        transfer.chunkCount = session.chunkCount;
        this.remember(transfer);
      }

      // ── 2. find out what is actually still needed ─────────────────────────
      // The server is the authority, not our own bookkeeping: after a pause,
      // a reload, or a retry, this is the only honest answer.
      const status = await this.get<{ session: ServerSession }>(`/uploads/${transfer.sessionId}`, signal);
      const missing = status.session.missing;
      transfer.chunksDone = status.session.receivedCount;
      transfer.chunkSize = status.session.chunkSize;
      transfer.chunkCount = status.session.chunkCount;
      transfer.loaded = status.session.uploadedBytes;
      transfer.status = 'uploading';
      this.emit();

      // ── 3. send the chunks ────────────────────────────────────────────────
      let lastSample = Date.now();
      let lastLoaded = transfer.loaded;

      await sendChunks({
        file,
        chunkSize: transfer.chunkSize,
        missing,
        concurrency: this.chunkConcurrency,
        signal,
        put: (index, blob, onProgress) =>
          putChunkXhr(
            `${API_BASE}/uploads/${transfer.sessionId}/chunks/${index}`,
            blob,
            { 'X-CSRF-Token': readCsrfToken() },
            signal,
            onProgress,
          ),
        onProgress: (confirmedChunks, inflightBytes) => {
          transfer.chunksDone = status.session.receivedCount + confirmedChunks;
          transfer.loaded = Math.min(
            transfer.size,
            transfer.chunksDone * transfer.chunkSize + inflightBytes,
          );

          const now = Date.now();
          if (now - lastSample >= 250) {
            const instant = ((transfer.loaded - lastLoaded) / (now - lastSample)) * 1000;
            transfer.rate = transfer.rate ? transfer.rate * 0.7 + instant * 0.3 : instant;
            transfer.samples = [...transfer.samples.slice(-39), Math.max(0, instant)];
            lastSample = now;
            lastLoaded = transfer.loaded;
            this.emit();
          }
        },
      });

      // ── 4. finalise ───────────────────────────────────────────────────────
      const completed = await this.post<{
        file: StoredFile;
        deduped: boolean;
        versioned: boolean;
        version: number;
      }>(`/uploads/${transfer.sessionId}/complete`, undefined, signal);

      transfer.status = 'done';
      transfer.loaded = transfer.size;
      transfer.deduped = completed.deduped;
      transfer.versioned = completed.versioned;
      transfer.version = completed.version;
      transfer.finishedAt = Date.now();
      this.forget(transfer.id);
      this.emit();
      this.opts.onUploaded([completed.file], {
        deduped: completed.deduped,
        versioned: completed.versioned,
      });
      this.opts.onQuotaChanged?.();
    } catch (err) {
      if (signal.aborted && transfer.status === 'cancelled') {
        this.emit();
        return;
      }

      const problem = describe(err);
      if (problem.retryable) {
        // The server still holds everything received; this is a pause, not a
        // failure, and resuming will pick up where it stopped.
        transfer.status = 'paused';
        transfer.error = problem.message;
      } else {
        transfer.status = 'error';
        transfer.error = problem.message;
        transfer.errorCode = problem.code;
        this.forget(transfer.id);
      }
      transfer.rate = 0;
      this.emit();
    }
  }

  // ── controls ──────────────────────────────────────────────────────────────

  pause(id: string): void {
    const job = this.jobs.get(id);
    if (!job || (job.transfer.status !== 'uploading' && job.transfer.status !== 'hashing')) return;
    job.transfer.status = 'paused';
    job.transfer.rate = 0;
    job.controller?.abort();
    this.emit();
  }

  resume(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.transfer.needsFile || !job.file) return; // the UI must supply the file
    job.transfer.status = 'queued';
    job.transfer.error = null;
    this.emit();
    this.pump();
  }

  retry(id: string): void {
    const job = this.jobs.get(id);
    if (!job || job.transfer.status === 'uploading') return;
    if (job.transfer.errorCode && ['too_large', 'blocked', 'empty'].includes(job.transfer.errorCode)) return;
    job.transfer.status = 'queued';
    job.transfer.error = null;
    job.transfer.errorCode = null;
    job.transfer.rate = 0;
    job.transfer.samples = [];
    this.emit();
    this.pump();
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    const wasActive = job.transfer.status === 'uploading' || job.transfer.status === 'hashing';
    job.transfer.status = 'cancelled';
    job.transfer.rate = 0;
    job.controller?.abort();
    if (job.transfer.sessionId) {
      // Tell the server so it can drop the spool file and free any reservation.
      void fetch(`${API_BASE}/uploads/${job.transfer.sessionId}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': readCsrfToken() },
        credentials: 'include',
      }).catch(() => undefined);
      this.forget(job.transfer.id);
    }
    void wasActive;
    this.emit();
  }

  cancelAll(): void {
    for (const id of [...this.order]) {
      const status = this.jobs.get(id)?.transfer.status;
      if (status === 'uploading' || status === 'queued' || status === 'paused' || status === 'hashing') {
        this.cancel(id);
      }
    }
  }

  dismiss(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    if (['uploading', 'queued', 'hashing', 'paused'].includes(job.transfer.status)) this.cancel(id);
    this.jobs.delete(id);
    const at = this.order.indexOf(id);
    if (at >= 0) this.order.splice(at, 1);
    this.forget(id);
    this.emit();
  }

  clearFinished(): void {
    for (const id of [...this.order]) {
      const status = this.jobs.get(id)?.transfer.status;
      if (status === 'done' || status === 'cancelled' || status === 'error') this.dismiss(id);
    }
  }

  // ── transport ─────────────────────────────────────────────────────────────

  private async post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'X-CSRF-Token': readCsrfToken(),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      credentials: 'include',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw await httpError(res);
    return (await res.json()) as T;
  }

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw await httpError(res);
    return (await res.json()) as T;
  }

  // ── remembering sessions across reloads ───────────────────────────────────

  private remembered(): Remembered[] {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as Remembered[];
    } catch {
      return [];
    }
  }

  private remember(transfer: Transfer): void {
    if (!transfer.sessionId) return;
    const entries = this.remembered().filter((e) => e.id !== transfer.id);
    entries.push({
      id: transfer.id,
      sessionId: transfer.sessionId,
      name: transfer.name,
      size: transfer.size,
      folderId: transfer.folderId,
    });
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-20)));
    } catch {
      /* private mode — resuming after a reload simply will not be offered */
    }
  }

  private forget(id: string): void {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(this.remembered().filter((e) => e.id !== id)),
      );
    } catch {
      /* ignore */
    }
  }
}

/** Same contract as ChunkError, for failures outside the chunk loop. */
class TransferError extends ChunkError {}

async function httpError(res: Response): Promise<TransferError> {
  const body = (await res.json().catch(() => null)) as
    | { error?: { message?: string; code?: string } }
    | null;
  const message =
    body?.error?.message ??
    (res.status === 413
      ? 'The server rejected this file as too large.'
      : res.status === 507
        ? 'Not enough space left in your account.'
        : `Upload failed (${res.status}).`);
  // 5xx and 429 are worth waiting out; a 4xx about the file itself is not.
  return new TransferError(message, body?.error?.code ?? String(res.status), res.status >= 500 || res.status === 429);
}

function describe(err: unknown): { message: string; code: string; retryable: boolean } {
  if (err instanceof ChunkError) return { message: err.message, code: err.code, retryable: err.retryable };
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { message: 'Paused.', code: 'aborted', retryable: true };
  }
  if (err instanceof TypeError) {
    // fetch() rejects with a TypeError when the network is unreachable.
    return { message: 'Connection lost. It will pick up where it left off.', code: 'network', retryable: true };
  }
  return { message: err instanceof Error ? err.message : 'Upload failed.', code: 'unknown', retryable: false };
}

/** Aggregate numbers for the dock header. */
export function summarise(transfers: Transfer[]) {
  const live = transfers.filter((t) => ['uploading', 'queued', 'hashing'].includes(t.status));
  const paused = transfers.filter((t) => t.status === 'paused');
  const failed = transfers.filter((t) => t.status === 'error');
  const done = transfers.filter((t) => t.status === 'done');
  const totalBytes = live.reduce((n, t) => n + t.size, 0);
  const loadedBytes = live.reduce((n, t) => n + t.loaded, 0);
  const rate = transfers.filter((t) => t.status === 'uploading').reduce((n, t) => n + t.rate, 0);

  return {
    active: live.length,
    paused: paused.length,
    failed: failed.length,
    done: done.length,
    instant: done.filter((t) => t.instant).length,
    totalBytes,
    loadedBytes,
    rate,
    percent: totalBytes > 0 ? Math.min(100, (loadedBytes / totalBytes) * 100) : 0,
    etaSeconds: rate > 0 ? (totalBytes - loadedBytes) / rate : null,
  };
}

import { API_BASE, readCsrfToken } from './api';
import type { StoredFile } from './types';

/**
 * Transfer queue for uploads.
 *
 * fetch() still cannot report request-body progress, so uploads go through
 * XMLHttpRequest — that is the only way to draw an honest progress bar. The
 * manager adds the parts a real transfer needs: bounded concurrency, a smoothed
 * throughput estimate, per-transfer cancel and retry, and client-side checks
 * that reject a doomed file before a single byte leaves the machine.
 */

export type TransferStatus = 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';

export interface Transfer {
  id: string;
  name: string;
  size: number;
  folderId: string | null;
  visibility: 'private' | 'public';
  status: TransferStatus;
  loaded: number;
  rate: number;
  /** Recent throughput samples, for the sparkline in the dock. */
  samples: number[];
  error: string | null;
  errorCode: string | null;
  attempt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface UploadManagerOptions {
  maxBytes: number;
  concurrency?: number;
  onChange: (transfers: Transfer[]) => void;
  onUploaded: (files: StoredFile[]) => void;
  onQuotaChanged?: () => void;
}

/** Mirrors the server's blocklist so the rejection is instant and explained. */
const BLOCKED = new Set([
  'php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phps', 'phtml', 'phar',
  'jsp', 'jspx', 'jsw', 'jsv', 'jspf', 'asp', 'aspx', 'asa', 'asax', 'ascx',
  'ashx', 'asmx', 'axd', 'cshtml', 'vbhtml', 'cgi', 'fcgi', 'pht', 'shtml',
  'htaccess', 'htpasswd', 'ini', 'config',
]);

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

interface Job {
  transfer: Transfer;
  file: File;
  xhr: XMLHttpRequest | null;
}

export class UploadManager {
  private readonly jobs = new Map<string, Job>();
  private readonly order: string[] = [];
  private active = 0;
  private readonly concurrency: number;
  private readonly maxBytes: number;
  private readonly opts: UploadManagerOptions;
  private seq = 0;

  constructor(opts: UploadManagerOptions) {
    this.opts = opts;
    this.maxBytes = opts.maxBytes;
    this.concurrency = opts.concurrency ?? 3;
  }

  private snapshot(): Transfer[] {
    return this.order.map((id) => ({ ...this.jobs.get(id)!.transfer }));
  }

  private emit(): void {
    this.opts.onChange(this.snapshot());
  }

  add(files: File[], folderId: string | null, visibility: 'private' | 'public' = 'private'): void {
    for (const file of files) {
      this.seq += 1;
      const id = `t${Date.now().toString(36)}-${this.seq}`;
      const transfer: Transfer = {
        id,
        name: file.name,
        size: file.size,
        folderId,
        visibility,
        status: 'queued',
        loaded: 0,
        rate: 0,
        samples: [],
        error: null,
        errorCode: null,
        attempt: 0,
        startedAt: null,
        finishedAt: null,
      };

      // Fail fast, with a reason, rather than uploading 400 MB to be told no.
      const ext = extensionOf(file.name);
      if (file.size === 0) {
        transfer.status = 'error';
        transfer.error = 'This file is empty.';
        transfer.errorCode = 'empty';
      } else if (file.size > this.maxBytes) {
        transfer.status = 'error';
        transfer.error = `Over the ${Math.round(this.maxBytes / 1024 / 1024)} MB limit for a single file.`;
        transfer.errorCode = 'too_large';
      } else if (BLOCKED.has(ext)) {
        transfer.status = 'error';
        transfer.error = `.${ext} files are not accepted. Zip it and upload that.`;
        transfer.errorCode = 'blocked';
      }

      this.jobs.set(id, { transfer, file, xhr: null });
      this.order.push(id);
    }
    this.emit();
    this.pump();
  }

  private pump(): void {
    while (this.active < this.concurrency) {
      const next = this.order
        .map((id) => this.jobs.get(id)!)
        .find((job) => job.transfer.status === 'queued');
      if (!next) return;
      this.start(next);
    }
  }

  private start(job: Job): void {
    const { transfer, file } = job;
    this.active += 1;
    transfer.status = 'uploading';
    transfer.attempt += 1;
    transfer.startedAt = Date.now();
    transfer.loaded = 0;
    transfer.error = null;
    this.emit();

    const form = new FormData();
    form.append('folderId', transfer.folderId ?? '');
    form.append('visibility', transfer.visibility);
    form.append('file', file, file.name);

    const xhr = new XMLHttpRequest();
    job.xhr = xhr;
    xhr.open('POST', `${API_BASE}/files`, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-CSRF-Token', readCsrfToken());
    xhr.responseType = 'json';

    let lastTime = Date.now();
    let lastLoaded = 0;

    xhr.upload.onprogress = (event) => {
      transfer.loaded = event.loaded;
      const now = Date.now();
      const elapsed = now - lastTime;
      // Sample about five times a second — enough for a live number, few
      // enough that React is not re-rendering the dock on every packet.
      if (elapsed >= 200) {
        const instant = ((event.loaded - lastLoaded) / elapsed) * 1000;
        // Exponential smoothing: the raw number is far too jumpy to read.
        transfer.rate = transfer.rate ? transfer.rate * 0.7 + instant * 0.3 : instant;
        transfer.samples = [...transfer.samples.slice(-39), instant];
        lastTime = now;
        lastLoaded = event.loaded;
        this.emit();
      }
    };

    xhr.onload = () => {
      this.active -= 1;
      job.xhr = null;
      transfer.finishedAt = Date.now();

      if (xhr.status >= 200 && xhr.status < 300) {
        const body = xhr.response as { files?: StoredFile[]; rejected?: Array<{ message: string }> } | null;
        const uploaded = body?.files ?? [];
        const rejection = body?.rejected?.[0];
        if (uploaded.length > 0) {
          transfer.status = 'done';
          transfer.loaded = transfer.size;
          this.opts.onUploaded(uploaded);
          this.opts.onQuotaChanged?.();
        } else {
          transfer.status = 'error';
          transfer.error = rejection?.message ?? 'The server did not store this file.';
        }
      } else {
        const body = xhr.response as { error?: { message?: string; code?: string } } | null;
        transfer.status = 'error';
        transfer.errorCode = body?.error?.code ?? String(xhr.status);
        transfer.error =
          body?.error?.message ??
          (xhr.status === 413
            ? 'The server rejected this file as too large.'
            : xhr.status === 507
              ? 'Not enough space left in your account.'
              : `Upload failed (${xhr.status}).`);
      }
      this.emit();
      this.pump();
    };

    xhr.onerror = () => {
      this.active -= 1;
      job.xhr = null;
      transfer.status = 'error';
      transfer.error = 'Connection lost during upload.';
      transfer.errorCode = 'network';
      transfer.finishedAt = Date.now();
      this.emit();
      this.pump();
    };

    xhr.onabort = () => {
      this.active -= 1;
      job.xhr = null;
      if (transfer.status === 'uploading') transfer.status = 'cancelled';
      transfer.finishedAt = Date.now();
      this.emit();
      this.pump();
    };

    xhr.send(form);
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.xhr) {
      job.xhr.abort();
    } else if (job.transfer.status === 'queued') {
      job.transfer.status = 'cancelled';
      this.emit();
    }
  }

  cancelAll(): void {
    for (const id of [...this.order]) this.cancel(id);
  }

  retry(id: string): void {
    const job = this.jobs.get(id);
    if (!job || job.transfer.status === 'uploading') return;
    job.transfer.status = 'queued';
    job.transfer.error = null;
    job.transfer.errorCode = null;
    job.transfer.rate = 0;
    job.transfer.samples = [];
    this.emit();
    this.pump();
  }

  dismiss(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.transfer.status === 'uploading' || job.transfer.status === 'queued') this.cancel(id);
    this.jobs.delete(id);
    const index = this.order.indexOf(id);
    if (index >= 0) this.order.splice(index, 1);
    this.emit();
  }

  clearFinished(): void {
    for (const id of [...this.order]) {
      const status = this.jobs.get(id)?.transfer.status;
      if (status === 'done' || status === 'cancelled') this.dismiss(id);
    }
  }
}

/** Aggregate numbers for the dock header. */
export function summarise(transfers: Transfer[]) {
  const active = transfers.filter((t) => t.status === 'uploading' || t.status === 'queued');
  const failed = transfers.filter((t) => t.status === 'error');
  const done = transfers.filter((t) => t.status === 'done');
  const totalBytes = active.reduce((n, t) => n + t.size, 0);
  const loadedBytes = active.reduce((n, t) => n + t.loaded, 0);
  const rate = transfers.filter((t) => t.status === 'uploading').reduce((n, t) => n + t.rate, 0);
  return {
    active: active.length,
    failed: failed.length,
    done: done.length,
    totalBytes,
    loadedBytes,
    rate,
    percent: totalBytes > 0 ? Math.min(100, (loadedBytes / totalBytes) * 100) : 0,
    etaSeconds: rate > 0 ? (totalBytes - loadedBytes) / rate : null,
  };
}

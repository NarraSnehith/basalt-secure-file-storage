import type { Readable } from 'node:stream';

export interface ByteRange {
  /** inclusive */
  start: number;
  /** inclusive */
  end: number;
}

export interface BlobSource {
  /** Path to the spooled temp file that holds the fully-received upload. */
  path: string;
  size: number;
  contentType: string;
}

/**
 * Storage is a two-method port. Uploads are spooled to a temp file first (that
 * is where size limits, hashing and magic-byte sniffing happen), then handed to
 * a driver — so swapping local disk for S3, R2 or MinIO touches nothing else.
 */
export interface StorageDriver {
  readonly name: string;
  /** Move/copy a spooled blob into permanent storage under `key`. */
  put(key: string, source: BlobSource): Promise<void>;
  /** Open a read stream, optionally for a byte range (video seeking). */
  read(key: string, range?: ByteRange): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /**
   * When the backend can serve bytes directly (S3/CDN), return a short-lived
   * URL and let the client fetch it. Local disk returns null and the API
   * streams the file itself.
   */
  signedUrl?(key: string, opts: { filename: string; contentType: string; disposition: 'inline' | 'attachment'; ttlSeconds: number }): Promise<string | null>;
}

import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { contentDisposition } from '../lib/filenames.js';
import type { BlobSource, ByteRange, StorageDriver } from './driver.js';

export interface S3Options {
  bucket: string;
  region: string;
  endpoint?: string | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  forcePathStyle?: boolean;
  /**
   * Canned ACL, only if your bucket actually wants one. Left unset by default:
   * buckets on R2, B2 and modern AWS (Object Ownership = bucket owner enforced)
   * have ACLs disabled and *reject* the header outright.
   */
  acl?: string | undefined;
  /**
   * Server-side encryption header, likewise opt-in. R2 and B2 encrypt at rest
   * unconditionally and refuse the header; AWS applies SSE-S3 by default.
   */
  serverSideEncryption?: string | undefined;
}

/**
 * S3-compatible driver — plain AWS S3, Cloudflare R2, Backblaze B2, MinIO,
 * Wasabi, Spaces.
 *
 * Downloads are handed off with a presigned URL so file bytes never occupy an
 * API process, and the response headers (filename, disposition) are pinned into
 * the signature rather than trusted from the query string.
 *
 * Deliberately sends the *minimum* set of headers. Every optional one is a way
 * for a provider to reject the request: R2 and B2 refuse `x-amz-acl` and
 * `x-amz-server-side-encryption` entirely, and an AWS bucket with ACLs disabled
 * — the default for anything made since 2023 — refuses the first as well. Both
 * are opt-in for the setups that need them.
 */
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly acl: string | undefined;
  private readonly sse: string | undefined;

  constructor(opts: S3Options) {
    this.bucket = opts.bucket;
    this.acl = opts.acl;
    this.sse = opts.serverSideEncryption;
    this.client = new S3Client({
      region: opts.region,
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      forcePathStyle: opts.forcePathStyle ?? false,
      ...(opts.accessKeyId && opts.secretAccessKey
        ? { credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } }
        : {}),
    });
  }

  async put(key: string, source: BlobSource): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(source.path),
        ContentLength: source.size,
        ContentType: source.contentType,
        // Objects stay private because the bucket is private and every download
        // goes through our authorisation, not because of a header.
        ...(this.acl ? { ACL: this.acl as never } : {}),
        ...(this.sse ? { ServerSideEncryption: this.sse as never } : {}),
      }),
    );
    await unlink(source.path).catch(() => {});
  }

  async read(key: string, range?: ByteRange): Promise<Readable> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }),
    );
    return res.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async signedUrl(
    key: string,
    opts: { filename: string; contentType: string; disposition: 'inline' | 'attachment'; ttlSeconds: number },
  ): Promise<string | null> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: opts.contentType,
        ResponseContentDisposition: contentDisposition(opts.filename, opts.disposition),
      }),
      { expiresIn: opts.ttlSeconds },
    );
  }
}

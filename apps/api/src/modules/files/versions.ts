import type { Request } from 'express';
import { db } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { recordEvent } from '../activity/service.js';
import { toFileDTO, type FileDTO } from './dto.js';
import { releaseUnreferencedBlobs } from './service.js';

/**
 * Version history.
 *
 * Uploading over a file adds a revision instead of producing "report (2).pdf",
 * which is the actual answer to two complaints at once: the pile of numbered
 * near-duplicates, and having overwritten the good copy with no way back.
 *
 * Restoring is additive — it appends the old bytes as a *new* revision rather
 * than truncating history — so "restore, look, restore back" is always possible
 * and nothing is ever destroyed by an undo.
 */

export interface VersionDTO {
  id: string;
  version: number;
  name: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  source: 'upload' | 'request' | 'restore';
  note: string | null;
  createdAt: string;
  current: boolean;
  /** True when these exact bytes are also referenced elsewhere. */
  shared: boolean;
}

async function ownedFile(ownerId: string, fileId: string) {
  const row = await db
    .selectFrom('files')
    .select(['id', 'name', 'owner_id', 'version', 'version_count', 'blob_id', 'folder_id'])
    .where('id', '=', fileId)
    .where('owner_id', '=', ownerId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw new AppError('not_found', 'File not found.');
  return row;
}

export async function listVersions(ownerId: string, fileId: string): Promise<VersionDTO[]> {
  const file = await ownedFile(ownerId, fileId);

  const rows = await db
    .selectFrom('file_versions')
    .innerJoin('blobs', 'blobs.id', 'file_versions.blob_id')
    .select([
      'file_versions.id',
      'file_versions.version',
      'file_versions.name',
      'file_versions.mime_type',
      'file_versions.size_bytes',
      'file_versions.source',
      'file_versions.note',
      'file_versions.created_at',
      'file_versions.blob_id',
      'blobs.checksum_sha256',
      'blobs.ref_count',
    ])
    .where('file_versions.file_id', '=', fileId)
    .orderBy('file_versions.version', 'desc')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    checksum: Buffer.from(row.checksum_sha256).toString('hex'),
    source: row.source,
    note: row.note,
    createdAt: new Date(row.created_at).toISOString(),
    current: row.version === file.version,
    shared: row.ref_count > 1,
  }));
}

/** Append an older revision's bytes as the newest revision. */
export async function restoreVersion(
  ownerId: string,
  fileId: string,
  version: number,
  req?: Request,
): Promise<FileDTO> {
  const file = await ownedFile(ownerId, fileId);
  if (version === file.version) {
    throw new AppError('conflict', 'That version is already the current one.');
  }

  const row = await db.transaction().execute(async (trx) => {
    const source = await trx
      .selectFrom('file_versions')
      .selectAll()
      .where('file_id', '=', fileId)
      .where('version', '=', version)
      .executeTakeFirst();
    if (!source) throw new AppError('not_found', 'That version does not exist.');

    const current = await trx
      .selectFrom('files')
      .selectAll()
      .where('id', '=', fileId)
      .forUpdate()
      .executeTakeFirstOrThrow();

    const next = current.version + 1;
    await trx
      .insertInto('file_versions')
      .values({
        file_id: fileId,
        version: next,
        blob_id: source.blob_id,
        name: source.name,
        mime_type: source.mime_type,
        declared_mime: source.declared_mime,
        mime_mismatch: source.mime_mismatch,
        size_bytes: source.size_bytes,
        source: 'restore',
        note: `Restored from version ${version}`,
        created_by: ownerId,
      })
      .execute();

    return trx
      .updateTable('files')
      .set({
        blob_id: source.blob_id,
        mime_type: source.mime_type,
        declared_mime: source.declared_mime,
        mime_mismatch: source.mime_mismatch,
        size_bytes: source.size_bytes,
        checksum_sha256: await trx
          .selectFrom('blobs')
          .select('checksum_sha256')
          .where('id', '=', source.blob_id)
          .executeTakeFirstOrThrow()
          .then((b) => b.checksum_sha256),
        version: next,
        version_count: current.version_count + 1,
        content_text: null,
        content_indexed: false,
      })
      .where('id', '=', fileId)
      .returningAll()
      .executeTakeFirstOrThrow();
  });

  await recordEvent({
    type: 'file.version_restore',
    actorId: ownerId,
    fileId,
    subject: file.name,
    metadata: { restoredFrom: version, newVersion: row.version },
    req,
  });

  return toFileDTO(row);
}

/**
 * Drop a superseded revision. The current one cannot be deleted — that is what
 * moving the file to the trash is for — and the space only comes back if no
 * other revision or file shares those bytes.
 */
export async function deleteVersion(
  ownerId: string,
  fileId: string,
  version: number,
  req?: Request,
): Promise<{ freedBytes: number }> {
  const file = await ownedFile(ownerId, fileId);
  if (version === file.version) {
    throw new AppError('conflict', 'The current version cannot be deleted. Restore another one first.');
  }

  const removed = await db
    .deleteFrom('file_versions')
    .where('file_id', '=', fileId)
    .where('version', '=', version)
    .returning(['blob_id', 'size_bytes'])
    .executeTakeFirst();
  if (!removed) throw new AppError('not_found', 'That version does not exist.');

  await db
    .updateTable('files')
    .set((eb) => ({ version_count: eb('version_count', '-', 1) }))
    .where('id', '=', fileId)
    .execute();

  const blob = await db
    .selectFrom('blobs')
    .select(['ref_count', 'size_bytes'])
    .where('id', '=', removed.blob_id)
    .executeTakeFirst();
  const freed = blob && blob.ref_count === 0 ? Number(blob.size_bytes) : 0;
  if (freed > 0) await releaseUnreferencedBlobs(ownerId);

  await recordEvent({
    type: 'file.version_delete',
    actorId: ownerId,
    fileId,
    subject: file.name,
    metadata: { version, freedBytes: freed },
    req,
  });

  return { freedBytes: freed };
}

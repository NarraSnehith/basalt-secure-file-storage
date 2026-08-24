import { sql } from 'kysely';
import { db } from '../../db/client.js';
import type { UserRow } from '../../db/types.js';

/**
 * Storage insights.
 *
 * "You are out of space" is not actionable. These are the four questions someone
 * actually has at that moment — what is biggest, what is duplicated, what have I
 * never touched, and what is version history costing me — each answered with
 * rows the UI can act on directly.
 */

export interface DuplicateGroup {
  checksum: string;
  sizeBytes: number;
  /** Copies pointing at the same bytes; the first is the oldest. */
  files: Array<{ id: string; name: string; folderId: string | null; createdAt: string }>;
  /** What deleting the redundant copies would free — zero, thanks to dedup. */
  wastedBytes: number;
}

export interface InsightsReport {
  largest: Array<{ id: string; name: string; kind: string; sizeBytes: number; createdAt: string }>;
  duplicates: DuplicateGroup[];
  stale: Array<{ id: string; name: string; sizeBytes: number; createdAt: string; lastAccessedAt: string | null }>;
  versionHeavy: Array<{ id: string; name: string; versionCount: number; historyBytes: number }>;
  reclaimable: {
    trashBytes: number;
    trashCount: number;
    versionBytes: number;
    unreferencedBytes: number;
  };
  dedupSavedBytes: number;
}

const STALE_DAYS = 90;

export async function buildInsights(user: UserRow): Promise<InsightsReport> {
  const staleBefore = new Date(Date.now() - STALE_DAYS * 86_400_000);

  const [largest, duplicateRows, stale, versionHeavy, reclaim] = await Promise.all([
    db
      .selectFrom('files')
      .select(['id', 'name', 'kind', 'size_bytes', 'created_at'])
      .where('owner_id', '=', user.id)
      .where('deleted_at', 'is', null)
      .orderBy('size_bytes', 'desc')
      .limit(10)
      .execute(),

    /*
     * Files that share a blob. Because storage is content-addressed these cost
     * nothing extra — which is the point worth showing. They are still clutter,
     * so the report lists them for tidying rather than for saving space, and
     * says so.
     */
    db
      .selectFrom('files')
      .innerJoin('blobs', 'blobs.id', 'files.blob_id')
      .select([
        'blobs.checksum_sha256',
        'blobs.size_bytes',
        sql<string>`count(*)`.as('copies'),
        sql<string>`json_agg(json_build_object(
            'id', files.id, 'name', files.name, 'folderId', files.folder_id,
            'createdAt', files.created_at
          ) ORDER BY files.created_at)`.as('files'),
      ])
      .where('files.owner_id', '=', user.id)
      .where('files.deleted_at', 'is', null)
      .groupBy(['blobs.checksum_sha256', 'blobs.size_bytes'])
      .having(sql<boolean>`count(*) > 1`)
      .orderBy(sql`blobs.size_bytes * (count(*) - 1)`, 'desc')
      .limit(10)
      .execute(),

    db
      .selectFrom('files')
      .select(['id', 'name', 'size_bytes', 'created_at', 'last_accessed_at'])
      .where('owner_id', '=', user.id)
      .where('deleted_at', 'is', null)
      .where('created_at', '<', staleBefore)
      .where((eb) => eb.or([eb('last_accessed_at', 'is', null), eb('last_accessed_at', '<', staleBefore)]))
      .orderBy('size_bytes', 'desc')
      .limit(10)
      .execute(),

    // Files whose superseded revisions still occupy space.
    db
      .selectFrom('files')
      .innerJoin('file_versions', 'file_versions.file_id', 'files.id')
      .innerJoin('blobs', 'blobs.id', 'file_versions.blob_id')
      .select([
        'files.id',
        'files.name',
        'files.version_count',
        sql<string>`coalesce(sum(distinct blobs.size_bytes), 0)`.as('history_bytes'),
      ])
      .where('files.owner_id', '=', user.id)
      .where('files.deleted_at', 'is', null)
      .whereRef('file_versions.blob_id', '<>', 'files.blob_id')
      .groupBy(['files.id', 'files.name', 'files.version_count'])
      .orderBy(sql`coalesce(sum(distinct blobs.size_bytes), 0)`, 'desc')
      .limit(10)
      .execute(),

    db
      .selectFrom('blobs')
      .select([
        sql<string>`coalesce(sum(size_bytes) filter (where ref_count = 0), 0)`.as('unreferenced'),
        sql<string>`coalesce(sum((ref_count - 1) * size_bytes) filter (where ref_count > 1), 0)`.as('saved'),
      ])
      .where('owner_id', '=', user.id)
      .executeTakeFirst(),
  ]);

  const [trash, versionTotal] = await Promise.all([
    db
      .selectFrom('files')
      .select([sql<string>`coalesce(sum(size_bytes),0)`.as('bytes'), sql<string>`count(*)`.as('count')])
      .where('owner_id', '=', user.id)
      .where('deleted_at', 'is not', null)
      .executeTakeFirst(),
    db
      .selectFrom('file_versions')
      .innerJoin('files', 'files.id', 'file_versions.file_id')
      .innerJoin('blobs', 'blobs.id', 'file_versions.blob_id')
      .select(sql<string>`coalesce(sum(distinct blobs.size_bytes), 0)`.as('bytes'))
      .where('files.owner_id', '=', user.id)
      .whereRef('file_versions.blob_id', '<>', 'files.blob_id')
      .executeTakeFirst(),
  ]);

  return {
    largest: largest.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      sizeBytes: Number(row.size_bytes),
      createdAt: new Date(row.created_at).toISOString(),
    })),
    duplicates: duplicateRows.map((row) => ({
      checksum: Buffer.from(row.checksum_sha256).toString('hex'),
      sizeBytes: Number(row.size_bytes),
      files: (row.files as unknown as DuplicateGroup['files']).map((f) => ({
        ...f,
        createdAt: new Date(f.createdAt).toISOString(),
      })),
      // Nothing, because the bytes were only ever stored once.
      wastedBytes: 0,
    })),
    stale: stale.map((row) => ({
      id: row.id,
      name: row.name,
      sizeBytes: Number(row.size_bytes),
      createdAt: new Date(row.created_at).toISOString(),
      lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at).toISOString() : null,
    })),
    versionHeavy: versionHeavy.map((row) => ({
      id: row.id,
      name: row.name,
      versionCount: row.version_count,
      historyBytes: Number(row.history_bytes),
    })),
    reclaimable: {
      trashBytes: Number(trash?.bytes ?? 0),
      trashCount: Number(trash?.count ?? 0),
      versionBytes: Number(versionTotal?.bytes ?? 0),
      unreferencedBytes: Number(reclaim?.unreferenced ?? 0),
    },
    dedupSavedBytes: Number(reclaim?.saved ?? 0),
  };
}

export interface Receipt {
  id: string;
  type: string;
  createdAt: string;
  ip: string | null;
  userAgent: string | null;
  /** True when the visitor was not the owner's own session. */
  anonymous: boolean;
}

/**
 * Who has opened a link, and when.
 *
 * The owner already has this information — it is in the audit trail — but
 * "did they even look at it?" is a question about one link, so it deserves an
 * answer shaped like one link rather than a filtered firehose.
 */
export async function shareReceipts(ownerId: string, shareId: string): Promise<Receipt[]> {
  const owned = await db
    .selectFrom('share_links')
    .select('id')
    .where('id', '=', shareId)
    .where('owner_id', '=', ownerId)
    .executeTakeFirst();
  if (!owned) return [];

  const rows = await db
    .selectFrom('events')
    .select(['id', 'type', 'created_at', 'ip', 'user_agent', 'actor_id'])
    .where('share_id', '=', shareId)
    .where('type', 'in', ['share.view', 'share.download', 'share.denied'])
    .orderBy('id', 'desc')
    .limit(100)
    .execute();

  return rows.map((row) => ({
    id: String(row.id),
    type: row.type,
    createdAt: new Date(row.created_at).toISOString(),
    ip: row.ip,
    userAgent: row.user_agent,
    anonymous: row.actor_id !== ownerId,
  }));
}

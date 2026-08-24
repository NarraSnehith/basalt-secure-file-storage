import type { Request } from 'express';
import { db } from '../../db/client.js';
import { clientIp, userAgent } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';

/**
 * Append-only audit trail. Every state change and every access to a shared file
 * lands here; the dashboard renders it as the user's activity feed, and it is
 * the first thing you would read after a suspected account compromise.
 */
export type EventType =
  | 'auth.register' | 'auth.login' | 'auth.login_failed' | 'auth.logout'
  | 'auth.password_changed' | 'auth.refresh_reuse' | 'auth.session_revoked'
  | 'file.upload' | 'file.download' | 'file.rename' | 'file.move'
  | 'file.version' | 'file.version_restore' | 'file.version_delete'
  | 'file.trash' | 'file.restore' | 'file.purge' | 'file.visibility'
  | 'folder.create' | 'folder.rename' | 'folder.trash' | 'folder.restore'
  | 'folder.share' | 'folder.unshare'
  | 'share.create' | 'share.update' | 'share.revoke'
  | 'share.view' | 'share.download' | 'share.denied'
  | 'request.create' | 'request.revoke' | 'request.submit' | 'request.denied'
  | 'upload.start' | 'upload.resume' | 'upload.abort';

export interface EventInput {
  type: EventType;
  actorId?: string | null;
  fileId?: string | null;
  shareId?: string | null;
  subject?: string | null;
  metadata?: Record<string, unknown>;
  req?: Request;
}

export async function recordEvent(input: EventInput): Promise<void> {
  try {
    await db
      .insertInto('events')
      .values({
        type: input.type,
        actor_id: input.actorId ?? null,
        file_id: input.fileId ?? null,
        share_id: input.shareId ?? null,
        subject: input.subject ?? null,
        ip: input.req ? clientIp(input.req) || null : null,
        user_agent: input.req ? userAgent(input.req) : null,
        metadata: (input.metadata ?? {}) as never,
      })
      .execute();
  } catch (err) {
    // An audit write must never turn a successful action into a 500 — but a
    // silent gap in the trail is worth an error-level line in the log.
    logger.error({ err, type: input.type }, 'failed to record audit event');
  }
}

export interface ActivityQuery {
  limit: number;
  before?: string | undefined;
  fileId?: string | undefined;
  types?: string[] | undefined;
}

export async function listActivity(userId: string, q: ActivityQuery) {
  let query = db
    .selectFrom('events')
    .leftJoin('files', 'files.id', 'events.file_id')
    .select([
      'events.id',
      'events.type',
      'events.file_id',
      'events.share_id',
      'events.subject',
      'events.ip',
      'events.user_agent',
      'events.metadata',
      'events.created_at',
      'files.name as file_name',
      'files.deleted_at as file_deleted_at',
    ])
    // Own actions, plus anonymous hits on the user's own share links.
    .where((eb) =>
      eb.or([
        eb('events.actor_id', '=', userId),
        eb.exists(
          eb
            .selectFrom('share_links')
            .select('share_links.id')
            .whereRef('share_links.id', '=', 'events.share_id')
            .where('share_links.owner_id', '=', userId),
        ),
      ]),
    )
    .orderBy('events.id', 'desc')
    .limit(Math.min(q.limit, 200));

  if (q.before) query = query.where('events.id', '<', q.before);
  if (q.fileId) query = query.where('events.file_id', '=', q.fileId);
  if (q.types?.length) query = query.where('events.type', 'in', q.types);

  const rows = await query.execute();

  return rows.map((r) => ({
    id: String(r.id),
    type: r.type,
    fileId: r.file_id,
    shareId: r.share_id,
    fileName: r.file_name ?? r.subject,
    fileDeleted: Boolean(r.file_deleted_at) || (!r.file_name && !!r.file_id),
    subject: r.subject,
    ip: r.ip,
    userAgent: r.user_agent,
    metadata: r.metadata,
    createdAt: new Date(r.created_at).toISOString(),
    anonymous: !r.share_id ? false : true,
  }));
}

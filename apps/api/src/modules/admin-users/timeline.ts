// Kullanıcı birleşik geçmişi — #183 (KV-33 §13). Sözleşme: contracts/domains/admin.ts (admin.users.timeline, .timeline.summary).
//
// Salt okuma. Bir hesabın anket, yorum, medya, rapor (yaptığı / yapılan), moderasyon (içeriği ve hesabı üzerindeki / verdiği) ve
// yaptırım olayları tek zaman çizgisinde birleştirilir. Veri politikası: IP/cihaz bilgisi YOKTUR, raporlayanın kimliği gösterilmez.
// Metinler kısaltılır (en çok 140 karakter); silinmiş/anonimleştirilmiş hesabın içeriği zaten "Silinmiş içerik" olarak kaldırılmıştır.
import { Prisma, type PrismaClient } from "@kararver/db";
import { decodeCursor, encodeCursor } from "../../http/cursor.ts";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";

export const TIMELINE_KINDS = ["POLL", "COMMENT", "MEDIA", "REPORT_FILED", "REPORT_AGAINST", "MODERATION", "MODERATION_BY", "SANCTION"] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export type TimelineRow = {
  kind: TimelineKind;
  id: string;
  at: Date;
  title: string | null;
  status: string | null;
  detail: string | null;
  reason: string | null;
  pollId: string | null;
  commentId: string | null;
  mediaId: string | null;
  reportId: string | null;
  communityId: string | null;
  actorId: string | null;
  actorUsername: string | null;
};

export type TimelineFilter = {
  kinds: TimelineKind[] | null;
  communityId?: string;
  contentId?: string;
  from?: Date;
  to?: Date;
  after: { at: Date; kind: string; id: string } | null;
};

export type TimelineSummary = { counts: Record<TimelineKind, number>; firstAt: Date | null; lastAt: Date | null };

export interface UserTimelineStore {
  exists(userId: string): Promise<boolean>;
  list(userId: string, filter: TimelineFilter, limit: number, now: Date): Promise<TimelineRow[]>;
  summary(userId: string, now: Date): Promise<TimelineSummary>;
}

/** Kullanıcıya ait bütün olaylar; sütun sırası her kolda aynıdır. Kısıtlar hep kullanıcıdan başlar (indeksli author_id/reporter_id/...). */
function unionSql(userId: string, now: Date): Prisma.Sql {
  const u = Prisma.sql`${userId}::uuid`;
  return Prisma.sql`
    SELECT 'POLL'::text AS kind, p.id AS id, p.created_at AS at, left(p.title, 140) AS title, p.status::text AS status, NULL::text AS detail, NULL::text AS reason,
           p.id AS poll_id, NULL::uuid AS comment_id, NULL::uuid AS media_id, NULL::uuid AS report_id, p.community_id AS community_id, NULL::uuid AS actor_id, NULL::text AS actor_username
      FROM polls p WHERE p.author_id = ${u}
    UNION ALL
    SELECT 'COMMENT', c.id, c.created_at, left(c.body, 140), c.status::text, NULL, NULL, c.poll_id, c.id, NULL::uuid, NULL::uuid, p.community_id, NULL::uuid, NULL
      FROM comments c JOIN polls p ON p.id = c.poll_id WHERE c.author_id = ${u}
    UNION ALL
    SELECT 'MEDIA', m.id, m.created_at, NULL, m.status::text, m.purpose::text, NULL, NULL::uuid, NULL::uuid, m.id, NULL::uuid, NULL::uuid, NULL::uuid, NULL
      FROM media_assets m WHERE m.uploader_id = ${u}
    UNION ALL
    SELECT 'REPORT_FILED', r.id, r.created_at, NULL, r.status::text, r.reason::text, NULL, coalesce(r.poll_id, c.poll_id), r.comment_id, r.media_id, r.id, coalesce(p.community_id, cp.community_id), NULL::uuid, NULL
      FROM reports r
      LEFT JOIN polls p ON p.id = r.poll_id
      LEFT JOIN comments c ON c.id = r.comment_id
      LEFT JOIN polls cp ON cp.id = c.poll_id
     WHERE r.reporter_id = ${u}
    UNION ALL
    SELECT 'REPORT_AGAINST', r.id, r.created_at, NULL, r.status::text, r.reason::text, NULL, coalesce(r.poll_id, c.poll_id), r.comment_id, r.media_id, r.id, coalesce(p.community_id, cp.community_id), NULL::uuid, NULL
      FROM reports r
      LEFT JOIN polls p ON p.id = r.poll_id
      LEFT JOIN comments c ON c.id = r.comment_id
      LEFT JOIN polls cp ON cp.id = c.poll_id
      LEFT JOIN media_assets m ON m.id = r.media_id
     WHERE r.reported_user_id = ${u} OR p.author_id = ${u} OR c.author_id = ${u} OR m.uploader_id = ${u}
    UNION ALL
    SELECT 'MODERATION', a.id, a.created_at, NULL, a.to_status, a.action::text, a.reason, coalesce(a.poll_id, c.poll_id), a.comment_id, a.media_id, a.report_id, coalesce(p.community_id, cp.community_id), a.actor_id, au.username
      FROM moderation_actions a
      JOIN users au ON au.id = a.actor_id
      LEFT JOIN polls p ON p.id = a.poll_id
      LEFT JOIN comments c ON c.id = a.comment_id
      LEFT JOIN polls cp ON cp.id = c.poll_id
      LEFT JOIN media_assets m ON m.id = a.media_id
     WHERE a.target_user_id = ${u} OR p.author_id = ${u} OR c.author_id = ${u} OR m.uploader_id = ${u}
    UNION ALL
    SELECT 'MODERATION_BY', a.id, a.created_at, NULL, a.to_status, a.action::text, a.reason, coalesce(a.poll_id, c.poll_id), a.comment_id, a.media_id, a.report_id, coalesce(p.community_id, cp.community_id), NULL::uuid, NULL
      FROM moderation_actions a
      LEFT JOIN polls p ON p.id = a.poll_id
      LEFT JOIN comments c ON c.id = a.comment_id
      LEFT JOIN polls cp ON cp.id = c.poll_id
     WHERE a.actor_id = ${u}
    UNION ALL
    SELECT 'SANCTION', s.id, s.created_at, NULL,
           CASE WHEN s.lifted_at IS NOT NULL THEN 'LIFTED' WHEN s.ends_at IS NOT NULL AND s.ends_at <= ${now.toISOString()}::timestamptz THEN 'EXPIRED' ELSE 'ACTIVE' END,
           s.type::text, s.reason, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, s.created_by_id, cu.username
      FROM sanctions s JOIN users cu ON cu.id = s.created_by_id WHERE s.user_id = ${u}`;
}

export function createPrismaUserTimelineStore(prisma: PrismaClient): UserTimelineStore {
  return {
    async exists(userId) {
      return (await prisma.user.count({ where: { id: userId } })) > 0;
    },

    async list(userId, filter, limit, now) {
      const where: Prisma.Sql[] = [];
      if (filter.kinds) where.push(Prisma.sql`t.kind = ANY(${filter.kinds}::text[])`);
      if (filter.communityId) where.push(Prisma.sql`t.community_id = ${filter.communityId}::uuid`);
      if (filter.contentId) where.push(Prisma.sql`(t.poll_id = ${filter.contentId}::uuid OR t.comment_id = ${filter.contentId}::uuid OR t.media_id = ${filter.contentId}::uuid)`);
      if (filter.from) where.push(Prisma.sql`t.at >= ${filter.from.toISOString()}::timestamptz`);
      if (filter.to) where.push(Prisma.sql`t.at < ${filter.to.toISOString()}::timestamptz`);
      if (filter.after) where.push(Prisma.sql`(t.at, t.kind, t.id) < (${filter.after.at.toISOString()}::timestamptz, ${filter.after.kind}::text, ${filter.after.id}::uuid)`);
      const rows = await prisma.$queryRaw<
        Array<{ kind: string; id: string; at: Date; title: string | null; status: string | null; detail: string | null; reason: string | null; poll_id: string | null; comment_id: string | null; media_id: string | null; report_id: string | null; community_id: string | null; actor_id: string | null; actor_username: string | null }>
      >(Prisma.sql`
        SELECT t.kind, t.id::text AS id, t.at, t.title, t.status, t.detail, t.reason, t.poll_id::text AS poll_id, t.comment_id::text AS comment_id,
               t.media_id::text AS media_id, t.report_id::text AS report_id, t.community_id::text AS community_id, t.actor_id::text AS actor_id, t.actor_username
          FROM (${unionSql(userId, now)}) t
         ${where.length > 0 ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty}
         ORDER BY t.at DESC, t.kind DESC, t.id DESC
         LIMIT ${limit}`);
      return rows.map((r) => ({
        kind: r.kind as TimelineKind,
        id: r.id,
        at: r.at,
        title: r.title,
        status: r.status,
        detail: r.detail,
        reason: r.reason,
        pollId: r.poll_id,
        commentId: r.comment_id,
        mediaId: r.media_id,
        reportId: r.report_id,
        communityId: r.community_id,
        actorId: r.actor_id,
        actorUsername: r.actor_username,
      }));
    },

    async summary(userId, now) {
      const rows = await prisma.$queryRaw<Array<{ kind: string; n: number; first_at: Date; last_at: Date }>>(Prisma.sql`
        SELECT t.kind, count(*)::int AS n, min(t.at) AS first_at, max(t.at) AS last_at FROM (${unionSql(userId, now)}) t GROUP BY t.kind`);
      const counts = Object.fromEntries(TIMELINE_KINDS.map((k) => [k, 0])) as Record<TimelineKind, number>;
      let firstAt: Date | null = null;
      let lastAt: Date | null = null;
      for (const r of rows) {
        counts[r.kind as TimelineKind] = r.n;
        if (!firstAt || r.first_at < firstAt) firstAt = r.first_at;
        if (!lastAt || r.last_at > lastAt) lastAt = r.last_at;
      }
      return { counts, firstAt, lastAt };
    },
  };
}

export type UserTimelineDeps = { store: UserTimelineStore; now: () => Date };

export function registerUserTimelineRoutes(route: Route, deps: UserTimelineDeps): void {
  const { store, now } = deps;
  const notFound = () => new ApiError("NOT_FOUND", "Kullanıcı bulunamadı.");

  route("admin.users.timeline", async ({ params, query }) => {
    if (!(await store.exists(params.id))) throw notFound();
    // Cursor süzgeçlere bağlıdır; süzgeç değişince eski cursor 400 INVALID_CURSOR.
    const key = `admin.users.timeline:${params.id}:${query.kinds ?? "*"}:${query.communityId ?? "*"}:${query.contentId ?? "*"}:${query.from ?? "*"}:${query.to ?? "*"}`;
    const cursor = decodeCursor(query.cursor, key);
    const rows = await store.list(
      params.id,
      {
        kinds: query.kinds ? (query.kinds.split(",") as TimelineKind[]) : null,
        communityId: query.communityId,
        contentId: query.contentId,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        after: cursor ? { at: new Date(cursor.keys[0] as string), kind: String(cursor.keys[1]), id: cursor.id } : null,
      },
      query.limit + 1,
      now(),
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor = rows.length > query.limit && last ? encodeCursor(key, [last.at.toISOString(), last.kind], last.id) : null;
    return {
      status: 200,
      body: {
        data: page.map((r) => ({
          kind: r.kind,
          id: r.id,
          at: r.at.toISOString(),
          title: r.title,
          status: r.status,
          detail: r.detail,
          reason: r.reason,
          refs: { pollId: r.pollId, commentId: r.commentId, mediaId: r.mediaId, reportId: r.reportId, communityId: r.communityId },
          actor: r.actorId && r.actorUsername ? { id: r.actorId, username: r.actorUsername } : null,
        })),
        page: { nextCursor, hasMore: nextCursor !== null },
      },
    };
  });

  route("admin.users.timeline.summary", async ({ params }) => {
    if (!(await store.exists(params.id))) throw notFound();
    const s = await store.summary(params.id, now());
    return { status: 200, body: { data: { counts: s.counts, firstAt: s.firstAt?.toISOString() ?? null, lastAt: s.lastAt?.toISOString() ?? null } } };
  });
}

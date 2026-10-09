// ReportStore'un PostgreSQL uygulaması — reports (DATA_MODEL.md §9).
import { Prisma, type PrismaClient } from "@kararver/db";
import { writeAudit } from "../audit/write.ts";
import { writeEvent } from "../events/write.ts";
import { communityOfTarget } from "../moderation/community-of.ts";
import { eventOf } from "../moderation/trail.ts";
import type { FiledReport, QueueItem, ReportReason, ReportStatus, ReportStore, ReportTargetType } from "./store.ts";

type TargetColumn = "pollId" | "commentId" | "mediaId" | "reportedUserId";
const COLUMN: Record<ReportTargetType, TargetColumn> = {
  POLL: "pollId",
  COMMENT: "commentId",
  MEDIA: "mediaId",
  USER: "reportedUserId",
};

const isUniqueViolation = (err: unknown) => typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";

type ReportRow = Prisma.ReportGetPayload<object>;
type Target = { type: ReportTargetType; id: string };

type QueueRow = {
  id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  report_count: bigint;
  community_id: string | null;
  created_at: Date;
  resolved_at: Date | null;
};

const fromRow = (r: QueueRow): QueueItem => ({
  id: r.id,
  target: { type: r.target_type, id: r.target_id },
  excerpt: null,
  contentStatus: null,
  targetUser: null,
  reason: r.reason,
  note: r.details,
  status: r.status,
  reportCount: Number(r.report_count),
  communityId: r.community_id,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
});

function targetOf(r: ReportRow): Target {
  if (r.pollId) return { type: "POLL", id: r.pollId };
  if (r.commentId) return { type: "COMMENT", id: r.commentId };
  if (r.mediaId) return { type: "MEDIA", id: r.mediaId };
  return { type: "USER", id: r.reportedUserId! };
}

function targetWhere(r: ReportRow): Prisma.ReportWhereInput {
  const { type, id } = targetOf(r);
  return { [COLUMN[type]]: id } as Prisma.ReportWhereInput;
}

/** moderation_actions'ta kullanıcı hedefi `targetUserId`'dir (reports'taki `reportedUserId` değil). */
function actionTarget(t: Target): { pollId: string } | { commentId: string } | { mediaId: string } | { targetUserId: string } {
  switch (t.type) {
    case "POLL":
      return { pollId: t.id };
    case "COMMENT":
      return { commentId: t.id };
    case "MEDIA":
      return { mediaId: t.id };
    case "USER":
      return { targetUserId: t.id };
  }
}

const itemOf = (r: ReportRow, communityId: string | null, reportCount: number): QueueItem => ({
  id: r.id,
  target: targetOf(r),
  excerpt: null,
  contentStatus: null,
  targetUser: null,
  reason: r.reason,
  note: r.details,
  status: r.status,
  reportCount,
  communityId,
  createdAt: r.createdAt,
  resolvedAt: r.resolvedAt,
});

const EXCERPT_CHARS = 140;
const excerptOf = (text: string) => (text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1)}…` : text);

/**
 * Kuyruk satırlarına hedef özeti, durumu ve sahibini ekler (KV-37): moderatör hangi içeriğin raporlandığını ve
 * kime uyarı gideceğini kuyrukta görür. Hedef türü başına tek sorgu (N+1 yok).
 */
async function describe(db: PrismaClient | Prisma.TransactionClient, items: QueueItem[]): Promise<QueueItem[]> {
  const ids = (type: ReportTargetType) => items.filter((i) => i.target.type === type).map((i) => i.target.id);
  const owner = (u: { id: string; username: string; deletedAt: Date | null }) => (u.deletedAt === null ? { id: u.id, username: u.username } : null);
  const userSelect = { id: true, username: true, deletedAt: true } as const;
  const [polls, comments, media, users] = await Promise.all([
    ids("POLL").length ? db.poll.findMany({ where: { id: { in: ids("POLL") } }, select: { id: true, title: true, status: true, author: { select: userSelect } } }) : [],
    ids("COMMENT").length ? db.comment.findMany({ where: { id: { in: ids("COMMENT") } }, select: { id: true, body: true, status: true, author: { select: userSelect } } }) : [],
    ids("MEDIA").length ? db.mediaAsset.findMany({ where: { id: { in: ids("MEDIA") } }, select: { id: true, uploader: { select: userSelect } } }) : [],
    ids("USER").length ? db.user.findMany({ where: { id: { in: ids("USER") } }, select: userSelect }) : [],
  ]);
  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
  const p = byId(polls);
  const c = byId(comments);
  const m = byId(media);
  const u = byId(users);
  return items.map((item) => {
    const { type, id } = item.target;
    if (type === "POLL") {
      const row = p.get(id);
      return row ? { ...item, excerpt: row.title, contentStatus: row.status, targetUser: owner(row.author) } : item;
    }
    if (type === "COMMENT") {
      const row = c.get(id);
      return row ? { ...item, excerpt: excerptOf(row.body), contentStatus: row.status, targetUser: owner(row.author) } : item;
    }
    if (type === "MEDIA") {
      const row = m.get(id);
      return row ? { ...item, targetUser: owner(row.uploader) } : item;
    }
    const row = u.get(id);
    return row ? { ...item, excerpt: row.username, targetUser: owner(row) } : item;
  });
}

export function createPrismaReportStore(prisma: PrismaClient): ReportStore {
  /** report.created: yeni rapor veya kapanmış raporun yeniden açılması (açık rapor tekrarında yazılmaz). */
  async function writeCreated(tx: Prisma.TransactionClient, report: Parameters<ReportStore["file"]>[0], reportId: string) {
    await writeEvent(
      tx,
      eventOf("report.created", report.reporterId, { type: "REPORT", id: reportId }, report.now, {
        targetType: report.target.type,
        targetId: report.target.id,
        reason: report.reason,
        communityId: await communityOfTarget(tx, report.target),
      }),
    );
  }

  async function file(report: Parameters<ReportStore["file"]>[0]): Promise<FiledReport> {
    const column = COLUMN[report.target.type];
    const where = { reporterId: report.reporterId, [column]: report.target.id } as Prisma.ReportWhereInput;

    return prisma.$transaction(async (tx) => {
      const existing = await tx.report.findFirst({ where, select: { id: true, status: true } });
      if (!existing) {
        const created = await tx.report.create({
          data: { reporterId: report.reporterId, [column]: report.target.id, reason: report.reason, details: report.details } as Prisma.ReportUncheckedCreateInput,
          select: { id: true },
        });
        await writeCreated(tx, report, created.id);
        return { reportId: created.id, outcome: "created" as const };
      }
      if (existing.status === "OPEN") return { reportId: existing.id, outcome: "pending" as const };
      // Kapanmış rapor: aynı satır yeniden kuyruğa girer; önceki karar moderation_actions'ta kalır.
      await tx.report.update({
        where: { id: existing.id },
        data: { status: "OPEN", reason: report.reason, details: report.details, resolvedById: null, resolvedAt: null, resolutionNote: null },
      });
      await writeCreated(tx, report, existing.id);
      return { reportId: existing.id, outcome: "reopened" as const };
    });
  }

  return {
    async isReportable({ type, id }) {
      switch (type) {
        case "POLL":
          return (await prisma.poll.count({ where: { id, status: { not: "REMOVED" }, deletedAt: null } })) === 1;
        case "COMMENT":
          return (await prisma.comment.count({ where: { id, status: { not: "REMOVED" }, deletedAt: null } })) === 1;
        case "MEDIA":
          return (await prisma.mediaAsset.count({ where: { id, status: "APPROVED" } })) === 1;
        case "USER":
          return (await prisma.user.count({ where: { id, deletedAt: null } })) === 1;
      }
    },

    // Aynı kullanıcıdan eşzamanlı ikinci istek unique index'te çakışır; kaybeden taraf kazananın satırını okur.
    async file(report) {
      try {
        return await file(report);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        return file(report);
      }
    },

    async listQueue({ status, targetType, communityId, scope, after }, limit) {
      const open = status === "OPEN";
      const conditions: Prisma.Sql[] = [];
      if (targetType) conditions.push(Prisma.sql`target_type = ${targetType}`);
      if (communityId) conditions.push(Prisma.sql`community_id = ${communityId}::uuid`);
      // Topluluğu olmayan hedef (kullanıcı, topluluksuz anket) yalnız ADMIN+ kuyruğundadır.
      if (!scope.all) conditions.push(Prisma.sql`community_id = ANY(${scope.communityIds}::uuid[])`);
      if (after) {
        conditions.push(
          open
            ? Prisma.sql`(created_at, id) > (${after.sortAt}::timestamptz, ${after.id}::uuid)`
            : Prisma.sql`(resolved_at, id) < (${after.sortAt}::timestamptz, ${after.id}::uuid)`,
        );
      }
      const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
      const order = open ? Prisma.sql`ORDER BY created_at ASC, id ASC` : Prisma.sql`ORDER BY resolved_at DESC, id DESC`;

      const rows = await prisma.$queryRaw<QueueRow[]>(Prisma.sql`
        WITH base AS (
          SELECT r.id, r.reason::text AS reason, r.details, r.status::text AS status, r.created_at, r.resolved_at,
            CASE WHEN r.poll_id IS NOT NULL THEN 'POLL' WHEN r.comment_id IS NOT NULL THEN 'COMMENT'
                 WHEN r.media_id IS NOT NULL THEN 'MEDIA' ELSE 'USER' END AS target_type,
            COALESCE(r.poll_id, r.comment_id, r.media_id, r.reported_user_id) AS target_id,
            COALESCE(
              p.community_id,
              cp.community_id,
              (SELECT p2.community_id FROM poll_media pm JOIN polls p2 ON p2.id = pm.poll_id
                WHERE pm.media_id = r.media_id AND p2.community_id IS NOT NULL LIMIT 1),
              (SELECT c2.id FROM communities c2 WHERE c2.image_media_id = r.media_id LIMIT 1)
            ) AS community_id
          FROM reports r
          LEFT JOIN polls p ON p.id = r.poll_id
          LEFT JOIN comments c ON c.id = r.comment_id
          LEFT JOIN polls cp ON cp.id = c.poll_id
          WHERE r.status = ${status}::report_status
        ), grouped AS (
          SELECT DISTINCT ON (target_type, target_id)
            id, reason, details, status, created_at, resolved_at, target_type, target_id, community_id,
            count(*) OVER (PARTITION BY target_type, target_id) AS report_count
          FROM base
          ORDER BY target_type, target_id, created_at ASC, id ASC
        )
        SELECT * FROM grouped ${where} ${order} LIMIT ${limit}`);
      return describe(prisma, rows.map(fromRow));
    },

    async findForResolve(id) {
      const report = await prisma.report.findUnique({ where: { id } });
      if (!report) return null;
      const [communityId, reportCount] = await Promise.all([
        communityOfTarget(prisma, targetOf(report)),
        prisma.report.count({ where: { ...targetWhere(report), status: report.status } }),
      ]);
      return (await describe(prisma, [itemOf(report, communityId, reportCount)]))[0]!;
    },

    async resolve({ reportId, actorId, resolution, note, now, requestId }) {
      return prisma.$transaction(async (tx) => {
        const report = await tx.report.findUnique({ where: { id: reportId } });
        if (!report) return { kind: "not_found" as const };
        // Kapanmış raporun kimliğiyle gelen istek, aynı hedefin başka açık raporlarını kapatmamalı.
        if (report.status !== "OPEN") return { kind: "conflict" as const };
        const target = targetOf(report);
        // Eşzamanlı ikinci moderatör: kapatılan satır sayısı 0 olur ve 409 alır.
        const closed = await tx.report.updateMany({
          where: { ...targetWhere(report), status: "OPEN" },
          data: { status: resolution, resolvedById: actorId, resolvedAt: now, resolutionNote: note },
        });
        if (closed.count === 0) return { kind: "conflict" as const };
        if (resolution === "DISMISSED") {
          // ACTIONED'da içeriğe uygulanan işlem (gizle/kaldır/kilitle) kendi endpoint'inde (KV-37) yazılır.
          await tx.moderationAction.create({
            data: { actorId, action: "DISMISS_REPORT", reportId, reason: note, ...actionTarget(target) },
          });
        }
        const resolved = await tx.report.findUniqueOrThrow({ where: { id: reportId } });
        // İz (KV-39, KV-21): kapanan her açık rapor için olay, işlem için tek audit kaydı (rapor + hedef + kapanan sayısı).
        const closedIds = await tx.report.findMany({
          where: { ...targetWhere(report), status: resolution, resolvedById: actorId, resolvedAt: now },
          select: { id: true },
          orderBy: { id: "asc" },
        });
        for (const { id } of closedIds) {
          await writeEvent(tx, eventOf("report.resolved", actorId, { type: "REPORT", id }, now, { resolution, targetType: target.type, targetId: target.id }));
        }
        await writeAudit(tx, {
          source: "API",
          actorId,
          action: "report.resolve",
          operation: resolution.toLowerCase(),
          target: { type: "REPORT", id: reportId },
          reason: note,
          before: { status: "OPEN", openReports: closed.count },
          after: { status: resolution, targetType: target.type, targetId: target.id, resolvedReports: closed.count },
          requestId,
          at: now,
        });
        const item = itemOf(resolved, await communityOfTarget(tx, target), closed.count);
        return { kind: "resolved" as const, item: (await describe(tx, [item]))[0]! };
      });
    },
  };
}

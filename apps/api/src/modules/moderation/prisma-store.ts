// ModerationStore'un PostgreSQL uygulaması — polls, comments, moderation_actions, reports (DATA_MODEL.md §7.1, §9).
// Kilit sırası Faruk'un yorum modülüyle aynıdır: önce anket, sonra yorum (KV-17); böylece eşzamanlı yorum
// yazma/silme ile moderasyon sayaçlarda deadlock veya çift sayım üretmez.
import type { Prisma, PrismaClient } from "@kararver/db";
import { writeAudit } from "../audit/write.ts";
import { writeEvent } from "../events/write.ts";
import { communityOfTarget } from "./community-of.ts";
import { closeOpenReports, eventOf } from "./trail.ts";
import {
  closesReports,
  counterDelta,
  statusTransition,
  type ApplyInput,
  type ApplyResult,
  type ContentStatus,
  type ModerationStore,
  type StatusAction,
} from "./store.ts";

type Tx = Prisma.TransactionClient;

type Snapshot = Record<string, string | boolean | null>;

/**
 * Geçmiş (moderation_actions), kapanan raporlar (report.resolved), audit ve moderation.applied olayı: hepsi çağıranın
 * transaction'ında. Audit gerekçeyi ve önce/sonra özetini taşır; olay bildirim ve analitik tüketicileri içindir.
 */
async function recordTrail(tx: Tx, input: ApplyInput, from: ContentStatus, to: ContentStatus, before: Snapshot, after: Snapshot): Promise<void> {
  const column = input.kind === "polls" ? { pollId: input.id } : { commentId: input.id };
  const type = input.kind === "polls" ? "POLL" : "COMMENT";
  const recorded = await tx.moderationAction.create({
    data: { actorId: input.actorId, action: input.action, ...column, fromStatus: from, toStatus: to, reason: input.reason },
    select: { id: true },
  });
  // Yayını kısıtlayan işlem raporu karşılar; kuyrukta içeriği zaten görünmeyen ölü kayıt kalmaz.
  const closedReports = closesReports(input.action) ? await closeOpenReports(tx, { type, id: input.id }, input.actorId, input.reason, input.now) : 0;
  await writeAudit(tx, {
    source: "API",
    actorId: input.actorId,
    action: input.kind === "polls" ? "moderation.poll.apply" : "moderation.comment.apply",
    operation: input.action.toLowerCase(),
    target: { type, id: input.id },
    reason: input.reason,
    before,
    after: { ...after, closedReports },
    requestId: input.requestId,
    at: input.now,
  });
  await writeEvent(
    tx,
    eventOf("moderation.applied", input.actorId, { type, id: input.id }, input.now, {
      moderationActionId: recorded.id,
      action: input.action,
      fromStatus: from,
      toStatus: to,
      reportId: null,
    }),
  );
}

async function applyToPoll(tx: Tx, input: ApplyInput): Promise<ApplyResult> {
  const [row] = await tx.$queryRaw<{ status: ContentStatus; trend_excluded_at: Date | null }[]>`
    SELECT status::text AS status, trend_excluded_at FROM polls WHERE id = ${input.id}::uuid FOR UPDATE`;
  if (!row) return { kind: "not_found" };
  const excluded = row.trend_excluded_at !== null;
  const outcome = (status: ContentStatus, trendExcluded: boolean) => ({ id: input.id, status, trendExcluded });

  if (input.action === "EXCLUDE_FROM_TRENDS" || input.action === "INCLUDE_IN_TRENDS") {
    if (row.status === "REMOVED") return { kind: "conflict", reason: "removed" };
    const want = input.action === "EXCLUDE_FROM_TRENDS";
    if (want === excluded) return { kind: "unchanged", outcome: outcome(row.status, excluded) };
    await tx.poll.update({ where: { id: input.id }, data: { trendExcludedAt: want ? input.now : null } });
    await recordTrail(tx, input, row.status, row.status, { status: row.status, trendExcluded: excluded }, { status: row.status, trendExcluded: want });
    return { kind: "applied", outcome: outcome(row.status, want) };
  }

  const next = statusTransition(row.status, input.action);
  if (next === "invalid") return { kind: "conflict", reason: "invalid_transition" };
  if (next === "same") return { kind: "unchanged", outcome: outcome(row.status, excluded) };
  if (row.status === "REMOVED" && !input.actorIsAdmin) return { kind: "forbidden", reason: "admin_required" };

  await tx.poll.update({
    where: { id: input.id },
    // REMOVED ⇔ deleted_at dolu; geri yüklemede boşalır.
    data: { status: next, deletedAt: next === "REMOVED" ? input.now : row.status === "REMOVED" ? null : undefined },
  });
  await recordTrail(tx, input, row.status, next, { status: row.status, trendExcluded: excluded }, { status: next, trendExcluded: excluded });
  return { kind: "applied", outcome: outcome(next, excluded) };
}

async function applyToComment(tx: Tx, input: ApplyInput): Promise<ApplyResult> {
  const meta = await tx.comment.findUnique({ where: { id: input.id }, select: { pollId: true, parentId: true } });
  if (!meta) return { kind: "not_found" };
  await tx.$queryRaw`SELECT 1 FROM polls WHERE id = ${meta.pollId}::uuid FOR UPDATE`;
  const [row] = await tx.$queryRaw<{ status: ContentStatus }[]>`
    SELECT status::text AS status FROM comments WHERE id = ${input.id}::uuid FOR UPDATE`;
  if (!row) return { kind: "not_found" };
  const outcome = (status: ContentStatus) => ({ id: input.id, status, trendExcluded: null });

  // Yorumda "kilitli" durumu yok: LOCKED yorum listelenmez (KV-17 yalnız ACTIVE gösterir); kilit anket düzeyindedir.
  if (input.action === "LOCK" || input.action === "UNLOCK" || input.action === "EXCLUDE_FROM_TRENDS" || input.action === "INCLUDE_IN_TRENDS") {
    return { kind: "conflict", reason: "unsupported_action" };
  }
  const next = statusTransition(row.status, input.action as StatusAction);
  if (next === "invalid") return { kind: "conflict", reason: "invalid_transition" };
  if (next === "same") return { kind: "unchanged", outcome: outcome(row.status) };
  if (row.status === "REMOVED" && !input.actorIsAdmin) return { kind: "forbidden", reason: "admin_required" };

  await tx.comment.update({
    where: { id: input.id },
    data: { status: next, deletedAt: next === "REMOVED" ? input.now : row.status === "REMOVED" ? null : undefined },
  });
  // polls.comment_count ve üst yorumun reply_count'u yalnız ACTIVE yorumları sayar (KV-17).
  const delta = counterDelta(row.status, next);
  if (delta !== 0) {
    await tx.poll.update({ where: { id: meta.pollId }, data: { commentCount: { increment: delta } } });
    if (meta.parentId) await tx.comment.update({ where: { id: meta.parentId }, data: { replyCount: { increment: delta } } });
  }
  await recordTrail(tx, input, row.status, next, { status: row.status }, { status: next });
  return { kind: "applied", outcome: outcome(next) };
}

export function createPrismaModerationStore(prisma: PrismaClient): ModerationStore {
  return {
    async findTarget(kind, id) {
      if (kind === "polls") {
        const poll = await prisma.poll.findUnique({ where: { id }, select: { id: true, status: true } });
        return poll ? { id: poll.id, status: poll.status, communityId: await communityOfTarget(prisma, { type: "POLL", id }) } : null;
      }
      const comment = await prisma.comment.findUnique({ where: { id }, select: { id: true, status: true } });
      return comment ? { id: comment.id, status: comment.status, communityId: await communityOfTarget(prisma, { type: "COMMENT", id }) } : null;
    },

    apply(input) {
      return prisma.$transaction((tx) => (input.kind === "polls" ? applyToPoll(tx, input) : applyToComment(tx, input)));
    },
  };
}

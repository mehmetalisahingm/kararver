// ModerationStore'un PostgreSQL uygulaması — polls, comments, moderation_actions, reports (DATA_MODEL.md §7.1, §9).
// Kilit sırası Faruk'un yorum modülüyle aynıdır: önce anket, sonra yorum (KV-17); böylece eşzamanlı yorum
// yazma/silme ile moderasyon sayaçlarda deadlock veya çift sayım üretmez.
import type { Prisma, PrismaClient } from "@kararver/db";
import { communityOfTarget } from "./community-of.ts";
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

async function recordAndCloseReports(tx: Tx, input: ApplyInput, from: ContentStatus, to: ContentStatus): Promise<void> {
  const target = input.kind === "polls" ? { pollId: input.id } : { commentId: input.id };
  await tx.moderationAction.create({
    data: { actorId: input.actorId, action: input.action, ...target, fromStatus: from, toStatus: to, reason: input.reason },
  });
  // Yayını kısıtlayan işlem raporu karşılar; kuyrukta içeriği zaten görünmeyen ölü kayıt kalmaz.
  if (closesReports(input.action)) {
    await tx.report.updateMany({
      where: { ...target, status: "OPEN" },
      data: { status: "ACTIONED", resolvedById: input.actorId, resolvedAt: input.now, resolutionNote: input.reason },
    });
  }
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
    await recordAndCloseReports(tx, input, row.status, row.status);
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
  await recordAndCloseReports(tx, input, row.status, next);
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
  await recordAndCloseReports(tx, input, row.status, next);
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

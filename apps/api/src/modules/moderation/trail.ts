// Moderasyon işlemlerinin izi: audit (KV-39) ve olay outbox'ı (KV-21) mutasyonla aynı transaction'da yazılır.
// Raporu kapatan her yol (rapor sonuçlandırma, görsel reddi, içerik gizleme/kaldırma/kilitleme) aynı yardımcıyı
// kullanır; böylece kapanan her rapor tek biçimde `report.resolved` olayı üretir.
import { createEvent, newEventId, type EventPayload, type EventSubjectType, type EventType } from "@kararver/contracts";
import type { Prisma } from "@kararver/db";
import { writeEvent } from "../events/write.ts";
import type { TargetRef } from "./community-of.ts";

type Tx = Prisma.TransactionClient;

export function eventOf<T extends EventType>(
  type: T,
  actorId: string | null,
  subject: { type: EventSubjectType; id: string },
  now: Date,
  payload: EventPayload<T>,
) {
  return createEvent({ id: newEventId(now), type, occurredAt: now.toISOString(), actorId, subject, payload });
}

/**
 * Hedefin açık raporlarını ACTIONED yapar ve her biri için `report.resolved` olayı yazar.
 * Kapanan rapor sayısını döner (audit özetine yazılır).
 */
export async function closeOpenReports(tx: Tx, target: TargetRef, actorId: string, reason: string, now: Date): Promise<number> {
  const where = (
    { POLL: { pollId: target.id }, COMMENT: { commentId: target.id }, MEDIA: { mediaId: target.id }, USER: { reportedUserId: target.id } } as const
  )[target.type];
  const open = await tx.report.findMany({ where: { ...where, status: "OPEN" }, select: { id: true }, orderBy: { id: "asc" } });
  if (open.length === 0) return 0;
  await tx.report.updateMany({
    where: { id: { in: open.map((r) => r.id) }, status: "OPEN" },
    data: { status: "ACTIONED", resolvedById: actorId, resolvedAt: now, resolutionNote: reason },
  });
  for (const { id } of open) {
    await writeEvent(
      tx,
      eventOf("report.resolved", actorId, { type: "REPORT", id }, now, { resolution: "ACTIONED", targetType: target.type, targetId: target.id }),
    );
  }
  return open.length;
}

type ReportTargetColumns = { pollId: string | null; commentId: string | null; mediaId: string | null; reportedUserId: string | null };

/** Rapor satırının hedefi (tam olarak bir sütun dolu; DB CHECK). */
export function targetOfReport(r: ReportTargetColumns): TargetRef {
  if (r.pollId) return { type: "POLL", id: r.pollId };
  if (r.commentId) return { type: "COMMENT", id: r.commentId };
  if (r.mediaId) return { type: "MEDIA", id: r.mediaId };
  return { type: "USER", id: r.reportedUserId! };
}

/** Hedefin sahibi: anket/yorum yazarı, görseli yükleyen, raporlanan hesap. Silinmiş hesap veya olmayan hedefte null. */
export async function ownerOfTarget(tx: Pick<Tx, "poll" | "comment" | "mediaAsset" | "user">, target: TargetRef): Promise<string | null> {
  const ownerId = async (): Promise<string | null> => {
    switch (target.type) {
      case "POLL":
        return (await tx.poll.findUnique({ where: { id: target.id }, select: { authorId: true } }))?.authorId ?? null;
      case "COMMENT":
        return (await tx.comment.findUnique({ where: { id: target.id }, select: { authorId: true } }))?.authorId ?? null;
      case "MEDIA":
        return (await tx.mediaAsset.findUnique({ where: { id: target.id }, select: { uploaderId: true } }))?.uploaderId ?? null;
      case "USER":
        return target.id;
    }
  };
  const id = await ownerId();
  if (!id) return null;
  const user = await tx.user.findUnique({ where: { id }, select: { deletedAt: true } });
  return user && user.deletedAt === null ? id : null;
}

/**
 * Rapor kuyruğundan uygulanan yaptırımın izi (KV-37): moderation_actions (rapor + hedef kullanıcı bağlantılı) ve hedefin
 * açık raporlarının ACTIONED'a kapanması. Audit kaydı çağıranın kendi işlem kaydındadır (reportId orada taşınır).
 * Kapanan rapor sayısını döner.
 */
export async function linkSanctionToReport(
  tx: Tx,
  input: { reportId: string; userId: string; actorId: string; action: "WARN_USER" | "SANCTION_USER"; reason: string; now: Date },
): Promise<number> {
  const report = await tx.report.findUniqueOrThrow({
    where: { id: input.reportId },
    select: { pollId: true, commentId: true, mediaId: true, reportedUserId: true },
  });
  await tx.moderationAction.create({
    data: { actorId: input.actorId, action: input.action, targetUserId: input.userId, reportId: input.reportId, reason: input.reason },
  });
  return closeOpenReports(tx, targetOfReport(report), input.actorId, input.reason, input.now);
}

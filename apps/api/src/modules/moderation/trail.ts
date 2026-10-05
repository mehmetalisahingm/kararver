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

// Rapor kuyruğundan içerik sahibini uyarma (KV-37, #39): admin.reports.warn.
// WARNING bir kayıttır: hesap durumu ve oturumlar değişmez (statusFromSanctions). Aynı transaction'da yaptırım,
// moderation_actions (WARN_USER, rapor bağlantılı), hedefin açık raporlarının ACTIONED'a kapanması, audit ve
// `sanction.applied` olayı yazılır. Sert yaptırım (kısıt, askı, ban) admin.sanctions.create + reportId ile aynı iz.
import type { PrismaClient } from "@kararver/db";
import { writeAudit } from "../audit/write.ts";
import { writeEvent } from "../events/write.ts";
import { eventOf, linkSanctionToReport, ownerOfTarget, targetOfReport } from "./trail.ts";
import { communityOfTarget } from "./community-of.ts";
import type { WarnInput, WarnResult, WarnTarget } from "./store.ts";

export async function findWarnTarget(prisma: PrismaClient, reportId: string): Promise<WarnTarget | null> {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) return null;
  const target = targetOfReport(report);
  const userId = await ownerOfTarget(prisma, target);
  const role = userId ? await prisma.userRole.findUnique({ where: { userId }, select: { role: true } }) : null;
  return {
    reportId,
    status: report.status,
    communityId: await communityOfTarget(prisma, target),
    userId,
    roles: role ? [role.role] : [],
  };
}

export function warnReportTarget(prisma: PrismaClient, input: WarnInput): Promise<WarnResult> {
  return prisma.$transaction(async (tx): Promise<WarnResult> => {
    // Aynı rapora eşzamanlı iki uyarı: ikincisi kilitte bekler, kapanmış raporu görüp 409 alır.
    const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM reports WHERE id = ${input.reportId}::uuid FOR UPDATE`;
    if (!locked) return { kind: "not_found" };
    if (locked.status !== "OPEN") return { kind: "conflict", reason: "already_resolved" };

    const report = await tx.report.findUniqueOrThrow({ where: { id: input.reportId } });
    const target = targetOfReport(report);
    const userId = await ownerOfTarget(tx, target);
    if (!userId) return { kind: "conflict", reason: "no_target_user" };

    const sanction = await tx.sanction.create({
      // starts_at/created_at işlemin anı (sanctions_lift_check, admin-users ile aynı kural).
      data: { userId, type: "WARNING", reason: input.reason, startsAt: input.now, endsAt: null, createdById: input.actorId, createdAt: input.now },
      select: { id: true },
    });
    const closedReports = await linkSanctionToReport(tx, {
      reportId: input.reportId,
      userId,
      actorId: input.actorId,
      action: "WARN_USER",
      reason: input.reason,
      now: input.now,
    });
    await writeAudit(tx, {
      source: "API",
      actorId: input.actorId,
      action: "moderation.user.warn",
      operation: "warn",
      target: { type: "USER", id: userId },
      reason: input.reason,
      before: { reportStatus: "OPEN", openReports: closedReports },
      after: { reportId: input.reportId, targetType: target.type, targetId: target.id, sanctionId: sanction.id, type: "WARNING", closedReports },
      requestId: input.requestId,
      at: input.now,
    });
    await writeEvent(tx, eventOf("sanction.applied", input.actorId, { type: "USER", id: userId }, input.now, { sanctionId: sanction.id, type: "WARNING", endsAt: null }));
    return { kind: "warned", sanctionId: sanction.id, userId, closedReports };
  });
}

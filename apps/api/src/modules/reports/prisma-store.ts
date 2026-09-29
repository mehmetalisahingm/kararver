// ReportStore'un PostgreSQL uygulaması — reports (DATA_MODEL.md §9).
import type { Prisma, PrismaClient } from "@kararver/db";
import type { FiledReport, ReportStore, ReportTargetType } from "./store.ts";

type TargetColumn = "pollId" | "commentId" | "mediaId" | "reportedUserId";
const COLUMN: Record<ReportTargetType, TargetColumn> = {
  POLL: "pollId",
  COMMENT: "commentId",
  MEDIA: "mediaId",
  USER: "reportedUserId",
};

const isUniqueViolation = (err: unknown) => typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";

export function createPrismaReportStore(prisma: PrismaClient): ReportStore {
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
        return { reportId: created.id, outcome: "created" as const };
      }
      if (existing.status === "OPEN") return { reportId: existing.id, outcome: "pending" as const };
      // Kapanmış rapor: aynı satır yeniden kuyruğa girer; önceki karar moderation_actions'ta kalır.
      await tx.report.update({
        where: { id: existing.id },
        data: { status: "OPEN", reason: report.reason, details: report.details, resolvedById: null, resolvedAt: null, resolutionNote: null },
      });
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
  };
}

// TrendStore'un PostgreSQL uygulaması.
import type { PrismaClient } from "@kararver/db";
import type { TrendStore } from "./store.ts";

export function createPrismaTrendStore(prisma: PrismaClient): TrendStore {
  return {
    async latestRun(format) {
      const run = await prisma.trendRun.findFirst({
        where: { format, status: "SUCCEEDED" },
        orderBy: [{ windowEnd: "desc" }, { finishedAt: "desc" }, { id: "desc" }],
        select: { id: true, format: true, calculationVersion: true, windowStart: true, windowEnd: true, finishedAt: true },
      });
      return run && run.finishedAt ? { ...run, finishedAt: run.finishedAt } : null;
    },

    async entries(runId, categoryId) {
      const rows = await prisma.trendScore.findMany({
        where: { runId, ...(categoryId ? { poll: { categoryId } } : {}) },
        orderBy: { rank: "asc" },
        select: { pollId: true, poll: { select: { status: true, trendExcludedAt: true } } },
      });
      // Çalıştırmadan sonra gizlenen/kaldırılan veya trendden çıkarılan anket gösterilmez (yerini korur).
      return rows.map((r) => ({
        pollId: r.pollId,
        visible: (r.poll.status === "ACTIVE" || r.poll.status === "LOCKED") && r.poll.trendExcludedAt === null,
      }));
    },
  };
}

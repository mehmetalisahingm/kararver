// KV-15 (#17) — ilgi alanlarının PostgreSQL/Prisma uygulaması.
// PUT tam liste semantiğinde olduğu için kullanıcı satırı kilitlenir; eşzamanlı güncellemeler birbirini parçalamaz.
import { type PrismaClient } from "@kararver/db";
import type { OnboardingStore, ReplaceInterestsResult } from "./store.ts";

export function createPrismaOnboardingStore(prisma: PrismaClient): OnboardingStore {
  return {
    async list(userId) {
      const rows = await prisma.userInterest.findMany({
        where: { userId },
        select: { categoryId: true },
        orderBy: [{ createdAt: "asc" }, { categoryId: "asc" }],
      });
      return rows.map((row) => row.categoryId);
    },

    async replace(userId, categoryIds): Promise<ReplaceInterestsResult> {
      // Sözleşme duplicate'i reddeder; store da başka çağıranlar için savunma yapar.
      if (new Set(categoryIds).size !== categoryIds.length) return { ok: false, reason: "INVALID_CATEGORY" };

      return prisma.$transaction(async (tx) => {
        // Aynı kullanıcının iki paralel tam-liste PUT'u birbirine karışmasın.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;

        if (categoryIds.length > 0) {
          const activeCount = await tx.category.count({ where: { id: { in: categoryIds }, isActive: true } });
          if (activeCount !== categoryIds.length) return { ok: false, reason: "INVALID_CATEGORY" } as const;
        }

        await tx.userInterest.deleteMany({ where: { userId } });
        if (categoryIds.length > 0) {
          await tx.userInterest.createMany({ data: categoryIds.map((categoryId) => ({ userId, categoryId })) });
        }

        const rows = await tx.userInterest.findMany({
          where: { userId },
          select: { categoryId: true },
          orderBy: [{ createdAt: "asc" }, { categoryId: "asc" }],
        });
        return { ok: true, categoryIds: rows.map((row) => row.categoryId) } as const;
      });
    },
  };
}

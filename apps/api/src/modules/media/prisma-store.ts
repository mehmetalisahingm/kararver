// MediaStore'un PostgreSQL uygulaması — media_assets (DATA_MODEL.md §9, docs/MEDIA_MODERATION.md).
import type { PrismaClient } from "@kararver/db";
import type { IdempotencyScope, IdempotentResult, MediaRecord, MediaStore } from "./store.ts";

const recordSelect = {
  id: true,
  uploaderId: true,
  purpose: true,
  status: true,
  originalObjectKey: true,
  processedObjectKey: true,
  publicObjectKey: true,
  width: true,
  height: true,
  createdAt: true,
} as const;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

export function createPrismaMediaStore(prisma: PrismaClient): MediaStore {
  async function replay(scope: IdempotencyScope): Promise<IdempotentResult | null> {
    const row = await prisma.idempotencyKey.findUnique({
      where: { userId_route_key: { userId: scope.userId, route: scope.route, key: scope.key } },
    });
    if (!row || row.expiresAt <= scope.now) return null;
    if (row.requestHash !== scope.requestHash) return { kind: "key_reused" };
    return { kind: "replayed", resourceId: row.resourceId };
  }

  return {
    // Kayıt ve idempotency satırı aynı transaction'da; eşzamanlı aynı anahtar unique index'te çakışır
    // ve kaybeden taraf kaydedilmiş sonucu okur (polls modülündeki yaklaşımla aynı).
    async createUpload(upload, scope) {
      if (scope) {
        const earlier = await replay(scope);
        if (earlier) return earlier;
        await prisma.idempotencyKey.deleteMany({
          where: { userId: scope.userId, route: scope.route, key: scope.key, expiresAt: { lte: scope.now } },
        });
      }
      try {
        const id = await prisma.$transaction(async (tx) => {
          const media = await tx.mediaAsset.create({ data: upload, select: { id: true } });
          if (scope) {
            await tx.idempotencyKey.create({
              data: {
                userId: scope.userId,
                route: scope.route,
                key: scope.key,
                requestHash: scope.requestHash,
                responseStatus: 201,
                resourceId: media.id,
                createdAt: scope.now,
                expiresAt: new Date(scope.now.getTime() + scope.ttlMs),
              },
            });
          }
          return media.id;
        });
        return { kind: "created", resourceId: id };
      } catch (err) {
        if (scope && isUniqueViolation(err)) {
          const winner = await replay(scope);
          if (winner) return winner;
        }
        throw err;
      }
    },

    async findMedia(id) {
      return (await prisma.mediaAsset.findUnique({ where: { id }, select: recordSelect })) as MediaRecord | null;
    },

    async rejectPending(id, reason) {
      await prisma.mediaAsset.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED", processingError: reason } });
    },
  };
}

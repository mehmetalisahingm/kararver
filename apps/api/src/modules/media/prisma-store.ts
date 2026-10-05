// MediaStore'un PostgreSQL uygulaması — media_assets (DATA_MODEL.md §9, docs/MEDIA_MODERATION.md).
import type { Prisma, PrismaClient } from "@kararver/db";
import { writeAudit } from "../audit/write.ts";
import { communityOfMedia } from "../moderation/community-of.ts";
import { closeOpenReports } from "../moderation/trail.ts";
import { publicObjectKeyFor } from "./storage.ts";
import type { BanRecord, IdempotencyScope, IdempotentResult, MediaRecord, MediaStatus, MediaStore } from "./store.ts";

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

const banSelect = {
  id: true,
  sourceMediaId: true,
  reason: true,
  contentSha256: true,
  perceptualHash: true,
  createdAt: true,
  createdBy: { select: { id: true, username: true, displayName: true, avatarMedia: { select: { status: true, publicObjectKey: true } } } },
} as const;

function toBan(row: {
  id: string;
  sourceMediaId: string;
  reason: string;
  contentSha256: string | null;
  perceptualHash: string | null;
  createdAt: Date;
  createdBy: { id: string; username: string; displayName: string; avatarMedia: { status: string; publicObjectKey: string | null } | null };
}): BanRecord {
  const { avatarMedia, ...creator } = row.createdBy;
  return {
    id: row.id,
    sourceMediaId: row.sourceMediaId,
    reason: row.reason,
    matchesExact: row.contentSha256 !== null,
    matchesSimilar: row.perceptualHash !== null,
    createdBy: { ...creator, avatarPublicKey: avatarMedia?.status === "APPROVED" ? avatarMedia.publicObjectKey : null },
    createdAt: row.createdAt,
  };
}

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

    async listForReview({ status, scope, after }, limit) {
      // Topluluğu olmayan görsel (avatar, topluluksuz anket) yalnız ADMIN+ kuyruğundadır.
      const inScope: Prisma.MediaAssetWhereInput[] = scope.all
        ? []
        : [
            {
              OR: [
                { pollMedia: { some: { poll: { communityId: { in: scope.communityIds } } } } },
                { communityImages: { some: { id: { in: scope.communityIds } } } },
              ],
            },
          ];
      const afterClause: Prisma.MediaAssetWhereInput[] = after
        ? [{ OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] }]
        : [];
      return (await prisma.mediaAsset.findMany({
        where: { status, AND: [...inScope, ...afterClause] },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit,
        select: recordSelect,
      })) as MediaRecord[];
    },

    async findForReview(id) {
      const media = (await prisma.mediaAsset.findUnique({ where: { id }, select: recordSelect })) as MediaRecord | null;
      if (!media) return null;
      const [communityId, banned] = await Promise.all([
        communityOfMedia(prisma, id),
        prisma.bannedMediaHash.count({ where: { sourceMediaId: id } }),
      ]);
      return { ...media, communityId, banned: banned > 0 };
    },

    async applyDecision({ id, actorId, decision, reason, now, requestId }) {
      return prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ status: MediaStatus; processed_object_key: string | null }[]>`
          SELECT status::text AS status, processed_object_key FROM media_assets WHERE id = ${id}::uuid FOR UPDATE`;
        const current = locked[0];
        if (!current) return { kind: "not_found" as const };

        const target: MediaStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";
        const load = async () => (await tx.mediaAsset.findUniqueOrThrow({ where: { id }, select: recordSelect })) as MediaRecord;
        if (current.status === target) return { kind: "unchanged" as const, media: await load() };

        const from: MediaStatus[] = decision === "APPROVE" ? ["QUARANTINED", "REJECTED"] : ["QUARANTINED", "APPROVED"];
        if (!from.includes(current.status)) return { kind: "conflict" as const, status: current.status, reason: "not_reviewable" as const };
        // Yasaklı görsel (KV-38) yasak kaldırılmadan yayına alınamaz.
        if (decision === "APPROVE" && (await tx.bannedMediaHash.count({ where: { sourceMediaId: id } })) > 0) {
          return { kind: "conflict" as const, status: current.status, reason: "banned" as const };
        }
        if (decision === "APPROVE" && current.processed_object_key === null) {
          return { kind: "conflict" as const, status: current.status, reason: "no_processed_copy" as const };
        }

        const media = (await tx.mediaAsset.update({
          where: { id },
          data: {
            status: target,
            // CHECK: public anahtar yalnız APPROVED'da dolu; kaldırmada aynı UPDATE'te boşalır.
            publicObjectKey: decision === "APPROVE" ? publicObjectKeyFor(id) : null,
            reviewedById: actorId,
            reviewedAt: now,
            reviewNote: reason.slice(0, 500),
          },
          select: recordSelect,
        })) as MediaRecord;
        await tx.moderationAction.create({
          data: { actorId, action: decision, mediaId: id, fromStatus: current.status, toStatus: target, reason },
        });
        // Reddedilen görselin açık raporları karşılanmıştır; kuyrukta ölü kayıt kalmaz (her biri report.resolved olayı yazar).
        const closedReports = decision === "REJECT" ? await closeOpenReports(tx, { type: "MEDIA", id }, actorId, reason, now) : 0;
        await writeAudit(tx, {
          source: "API",
          actorId,
          action: "media.review",
          operation: decision.toLowerCase(),
          target: { type: "MEDIA", id },
          reason,
          before: { status: current.status },
          after: { status: target, closedReports },
          requestId,
          at: now,
        });
        return { kind: "applied" as const, media };
      });
    },

    async listBans(after, limit) {
      const rows = await prisma.bannedMediaHash.findMany({
        where: after ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] } : {},
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        select: banSelect,
      });
      return rows.map(toBan);
    },

    async createBan({ mediaId, actorId, reason, requestId, now }) {
      const media = await prisma.mediaAsset.findUnique({
        where: { id: mediaId },
        select: { status: true, contentSha256: true, perceptualHash: true },
      });
      if (!media) return { kind: "not_found" };
      const existing = () =>
        prisma.bannedMediaHash.findFirst({
          where: { OR: [{ sourceMediaId: mediaId }, ...(media.contentSha256 ? [{ contentSha256: media.contentSha256 }] : [])] },
          select: banSelect,
        });
      const found = await existing();
      if (found) return { kind: "existing", ban: toBan(found) };
      if (media.status !== "REJECTED") return { kind: "conflict", reason: "not_rejected" };
      if (!media.contentSha256 && !media.perceptualHash) return { kind: "conflict", reason: "no_fingerprint" };
      try {
        const created = await prisma.$transaction(async (tx) => {
          const row = await tx.bannedMediaHash.create({
            data: { sourceMediaId: mediaId, contentSha256: media.contentSha256, perceptualHash: media.perceptualHash, reason, createdById: actorId },
            select: banSelect,
          });
          await writeAudit(tx, {
            source: "API",
            actorId,
            action: "media.ban.manage",
            operation: "create",
            target: { type: "MEDIA", id: mediaId },
            reason,
            before: null,
            after: { banId: row.id, matchesExact: row.contentSha256 !== null, matchesSimilar: row.perceptualHash !== null },
            requestId,
            at: now,
          });
          return row;
        });
        return { kind: "created", ban: toBan(created) };
      } catch (err) {
        // Eşzamanlı aynı yasak: kaybeden taraf kazananın kaydını okur.
        if (!isUniqueViolation(err)) throw err;
        const winner = await existing();
        if (!winner) throw err;
        return { kind: "existing", ban: toBan(winner) };
      }
    },

    async deleteBan({ id, actorId, requestId, now }) {
      await prisma.$transaction(async (tx) => {
        const ban = await tx.bannedMediaHash.findUnique({ where: { id }, select: { sourceMediaId: true } });
        if (!ban) return;
        // Eşzamanlı ikinci silme: yalnız satırı gerçekten silen istek audit yazar.
        if ((await tx.bannedMediaHash.deleteMany({ where: { id } })).count === 0) return;
        await writeAudit(tx, {
          source: "API",
          actorId,
          action: "media.ban.manage",
          operation: "delete",
          target: { type: "MEDIA", id: ban.sourceMediaId },
          before: { banId: id },
          after: null,
          requestId,
          at: now,
        });
      });
    },

    async recordPreviews({ mediaIds, actorId, requestId, now }) {
      if (mediaIds.length === 0) return;
      await prisma.$transaction(async (tx) => {
        for (const id of mediaIds) {
          await writeAudit(tx, {
            source: "API",
            actorId,
            action: "media.queue.read",
            operation: "preview",
            target: { type: "MEDIA", id },
            requestId,
            at: now,
          });
        }
      });
    },
  };
}

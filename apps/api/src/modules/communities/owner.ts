// Topluluk sahibi — #184 / KV-54 S1. Sözleşme: contracts/domains/communities.ts (admin.communities.owner.put/release,
// communities.owner.release). Kurallar ve sınırlar: docs/KV-32_COMMUNITY_ADMIN.md §7, docs/KV-54_COMMUNITY_OWNERSHIP_VERIFICATION.md.
//
// Sahip topluluk başına en çok bir kullanıcıdır (communities.owner_id, boş olabilir = yönetici yönetimi, V1 davranışı). Yeni
// bir community_role değeri yoktur; sahiplik bu dilimde ek yetki VERMEZ, yalnız kayıttır (düzenleme/moderatör atama/devir
// KV-54 S2-S3). Özellik communities.ownershipEnabled bayrağı arkasındadır (varsayılan kapalı).
//
// Kilit sırası: önce aday kullanıcı satırı (FOR NO KEY UPDATE: aynı kullanıcıya iki atama ve BAN burada sıraya girer, 3 topluluk
// sınırı yarışta aşılmaz), sonra topluluk satırı (FOR UPDATE: leave, atama ve bırakma sıraya girer). BAN yolu da kullanıcıdan
// topluluğa gider, böylece döngü yoktur. DB tetikleyicileri (migration) sahibin üye kalmasını ve üyeliğinin silinmemesini
// ayrıca korur.
import { Prisma, type PrismaClient } from "@kararver/db";
import { decide, lockSuperAdmins, lockTarget } from "../admin-users/prisma-store.ts";
import { writeAudit } from "../audit/write.ts";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { AdminTrail } from "./store.ts";

type Tx = Prisma.TransactionClient;

/** Aynı anda sahip olunabilecek en çok topluluk (KV-54 §3, öneri; Mehmet teyidi bekliyor). */
export const MAX_OWNED_COMMUNITIES = 3;

export type OwnerRef = { id: string; username: string; displayName: string };
export type AssignRejection = "not_found" | "user_not_found" | "user_not_eligible" | "owner_limit";

export interface CommunityOwnerStore {
  /** Topluluk yoksa null; yoksa o anki sahip (veya null). Yetki kararı için okunur, kilit taşımaz. */
  ownerOf(communityId: string): Promise<{ exists: false } | { exists: true; ownerId: string | null }>;
  assign(communityId: string, userId: string, trail: AdminTrail & { reason: string }): Promise<{ kind: "assigned" | "unchanged"; owner: OwnerRef } | { kind: "rejected"; reason: AssignRejection }>;
  release(communityId: string, trail: AdminTrail & { reason: string }): Promise<{ kind: "released" | "unchanged" } | { kind: "not_found" }>;
  /** Sahibin kendi bırakması: kilit altında hâlâ sahip mi diye yeniden bakar. */
  releaseOwn(communityId: string, userId: string, trail: AdminTrail): Promise<{ kind: "released" | "not_owner" | "not_found" }>;
}

/**
 * BAN uygulanan veya anonimleştirilen (#181) hesabın sahip olduğu toplulukları yönetici yönetimine döndürür (KV-54 §5: sahip BANNED olursa; hesap silinirse). Çağıranın
 * transaction'ında, kullanıcı satırı kilitliyken çalışır; her topluluk için audit (community.owner.assign / auto_release,
 * aktör = yaptırımı uygulayan yönetici, gerekçe = yaptırım gerekçesi). Üyelik ve içerik etkilenmez. Döner: bırakılan topluluk sayısı.
 */
export async function releaseOwnedCommunities(tx: Tx, userId: string, trail: AdminTrail & { reason: string; trigger?: "ban" | "anonymize" }): Promise<number> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    UPDATE communities SET owner_id = NULL, updated_at = ${trail.now.toISOString()}::timestamptz
    WHERE owner_id = ${userId}::uuid RETURNING id::text AS id`;
  for (const row of rows) {
    await writeAudit(tx, {
      source: "API",
      actorId: trail.actorId,
      action: "community.owner.assign",
      operation: "auto_release",
      target: { type: "COMMUNITY", id: row.id },
      reason: trail.reason,
      before: { ownerId: userId },
      after: { ownerId: null, trigger: trail.trigger ?? "ban" },
      requestId: trail.requestId,
      at: trail.now,
    });
  }
  return rows.length;
}

/** Aday uygun mu: ACTIVE, silinmemiş ve e-postası gerçekten doğrulanmış (geçici doğrulama gevşetmesi yok sayılır). */
export async function isEligibleOwner(tx: Tx, userId: string): Promise<boolean> {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { status: true, deletedAt: true, emailVerifiedAt: true } });
  return !!u && u.status === "ACTIVE" && u.deletedAt === null && u.emailVerifiedAt !== null;
}

export async function ownedCount(tx: Tx, userId: string, exceptCommunityId?: string): Promise<number> {
  return tx.community.count({ where: { ownerId: userId, ...(exceptCommunityId ? { id: { not: exceptCommunityId } } : {}) } });
}

export function createPrismaCommunityOwnerStore(prisma: PrismaClient): CommunityOwnerStore {
  const lockCommunity = async (tx: Tx, id: string) => {
    const [row] = await tx.$queryRaw<{ owner_id: string | null }[]>`SELECT owner_id::text AS owner_id FROM communities WHERE id = ${id}::uuid FOR UPDATE`;
    return row ?? null;
  };

  return {
    async ownerOf(communityId) {
      const c = await prisma.community.findUnique({ where: { id: communityId }, select: { ownerId: true } });
      return c ? { exists: true, ownerId: c.ownerId } : { exists: false };
    },

    async assign(communityId, userId, trail) {
      return prisma.$transaction(async (tx) => {
        if (!(await lockTarget(tx, userId))) return { kind: "rejected", reason: "user_not_found" } as const;
        await lockSuperAdmins(tx);
        if (!(await decide(tx, trail.actorId, "community.owner.assign", {}, trail.now)).allowed)
          throw new ApiError("FORBIDDEN", "Sahip atama için güncel süper admin yetkisi gerekli.");
        const community = await lockCommunity(tx, communityId);
        if (!community) return { kind: "rejected", reason: "not_found" } as const;
        if (!(await isEligibleOwner(tx, userId))) return { kind: "rejected", reason: "user_not_eligible" } as const;
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, username: true, displayName: true } });
        if (community.owner_id === userId) return { kind: "unchanged", owner: user } as const;
        if ((await ownedCount(tx, userId, communityId)) >= MAX_OWNED_COMMUNITIES) return { kind: "rejected", reason: "owner_limit" } as const;

        // Sahip üyedir: üyeliği yoksa MEMBER olarak eklenir (sayaç aynı transaction'da; mevcut rol korunur).
        const added = await tx.$executeRaw`
          INSERT INTO community_memberships (community_id, user_id, role, created_at, updated_at)
          VALUES (${communityId}::uuid, ${userId}::uuid, 'MEMBER', ${trail.now.toISOString()}::timestamptz, ${trail.now.toISOString()}::timestamptz)
          ON CONFLICT DO NOTHING`;
        if (added === 1) await tx.community.update({ where: { id: communityId }, data: { memberCount: { increment: 1 } } });

        await tx.community.update({ where: { id: communityId }, data: { ownerId: userId } });
        await writeAudit(tx, {
          source: "API",
          actorId: trail.actorId,
          action: "community.owner.assign",
          operation: "assign",
          target: { type: "COMMUNITY", id: communityId },
          reason: trail.reason,
          before: { ownerId: community.owner_id },
          after: { ownerId: userId, memberAdded: added === 1 },
          requestId: trail.requestId,
          at: trail.now,
        });
        return { kind: "assigned", owner: user } as const;
      });
    },

    async release(communityId, trail) {
      return prisma.$transaction(async (tx) => {
        await lockSuperAdmins(tx);
        if (!(await decide(tx, trail.actorId, "community.owner.assign", {}, trail.now)).allowed)
          throw new ApiError("FORBIDDEN", "Sahipliği kaldırmak için güncel süper admin yetkisi gerekli.");
        const community = await lockCommunity(tx, communityId);
        if (!community) return { kind: "not_found" } as const;
        if (community.owner_id === null) return { kind: "unchanged" } as const;
        await tx.community.update({ where: { id: communityId }, data: { ownerId: null } });
        await writeAudit(tx, {
          source: "API",
          actorId: trail.actorId,
          action: "community.owner.assign",
          operation: "release",
          target: { type: "COMMUNITY", id: communityId },
          reason: trail.reason,
          before: { ownerId: community.owner_id },
          after: { ownerId: null },
          requestId: trail.requestId,
          at: trail.now,
        });
        return { kind: "released" } as const;
      });
    },

    async releaseOwn(communityId, userId, trail) {
      return prisma.$transaction(async (tx) => {
        const user = await lockTarget(tx, userId);
        if (!user || user.deleted) return { kind: "not_owner" } as const;
        const community = await lockCommunity(tx, communityId);
        if (!community) return { kind: "not_found" } as const;
        if (community.owner_id !== userId) return { kind: "not_owner" } as const;
        if (!(await decide(tx, userId, "community.owner.release", { ownerId: community.owner_id }, trail.now)).allowed)
          throw new ApiError("FORBIDDEN", "Sahipliği bırakmak için aktif hesap gerekli.");
        await tx.community.update({ where: { id: communityId }, data: { ownerId: null } });
        await writeAudit(tx, {
          source: "API",
          actorId: userId,
          action: "community.owner.release",
          operation: "release",
          target: { type: "COMMUNITY", id: communityId },
          reason: null,
          before: { ownerId: userId },
          after: { ownerId: null },
          requestId: trail.requestId,
          at: trail.now,
        });
        return { kind: "released" } as const;
      });
    },
  };
}

export type CommunityOwnerDeps = { store: CommunityOwnerStore; now: () => Date; isOwnershipEnabled: () => Promise<boolean> };

export function registerCommunityOwnerRoutes(route: Route, deps: CommunityOwnerDeps): void {
  const { store, now } = deps;
  const notFound = () => new ApiError("NOT_FOUND", "Topluluk bulunamadı.");
  const conflict = (message: string, code: string) => new ApiError("CONFLICT", message, [{ code }]);

  route("admin.communities.owner.put", async ({ params, body, viewer, request }) => {
    // Bayrak kapalıyken yeni atama yok (varsayılan: V1 davranışı); mevcut sahiplik korunur ve okunur.
    if (!(await deps.isOwnershipEnabled())) throw new ApiError("FEATURE_DISABLED", "Topluluk sahipliği şu an kapalı.");
    const result = await store.assign(params.id, body.userId, { actorId: viewer!.id, requestId: request.id, now: now(), reason: body.reason });
    if (result.kind === "rejected") {
      if (result.reason === "not_found") throw notFound();
      if (result.reason === "user_not_found") throw new ApiError("NOT_FOUND", "Kullanıcı bulunamadı.");
      if (result.reason === "owner_limit") throw conflict(`Kullanıcı en çok ${MAX_OWNED_COMMUNITIES} topluluğa sahip olabilir.`, "owner_limit");
      throw conflict("Kullanıcı sahip olamaz: hesap aktif, silinmemiş ve e-postası doğrulanmış olmalı.", "user_not_eligible");
    }
    return { status: 200, body: { data: { owner: result.owner } } };
  });

  route("admin.communities.owner.release", async ({ params, body, viewer, request }) => {
    const result = await store.release(params.id, { actorId: viewer!.id, requestId: request.id, now: now(), reason: body.reason });
    if (result.kind === "not_found") throw notFound();
    return { status: 200, body: { data: { owner: null } } };
  });

  route("communities.owner.release", async (ctx) => {
    const { params, viewer, request } = ctx;
    const current = await store.ownerOf(params.id);
    if (!current.exists) throw notFound();
    // Sahip değilse (veya sahip yoksa) 403: kaynak sahibi kuralı (KV-04); sahipsiz topluluk için eşleşmeyen değer verilir.
    await ctx.authorize({ ownerId: current.ownerId ?? "" });
    const result = await store.releaseOwn(params.id, viewer!.id, { actorId: viewer!.id, requestId: request.id, now: now() });
    if (result.kind === "not_found") throw notFound();
    if (result.kind === "not_owner") throw new ApiError("FORBIDDEN", "Bu topluluğun sahibi değilsin.");
    return { status: 200, body: { data: { owner: null } } };
  });
}

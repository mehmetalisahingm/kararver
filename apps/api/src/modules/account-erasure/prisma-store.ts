// AccountErasureStore'un PostgreSQL/Prisma uygulaması — #181. Kurallar: docs/KV-33_ADMIN_USERS.md §10.
//
// Kilit sırası (deadlock yok): 1) hedef users satırı FOR NO KEY UPDATE (lockTarget), 2) kullanıcının üye/sahip olduğu
// topluluk satırları id sırasıyla FOR UPDATE, 3) kayıt listesindeki anket satırları id sırasıyla FOR UPDATE. Başka
// kullanıcı satırı kilitlenmez. Topluluk kilidi sahip bırakma, üyelikten ayrılma ve atama yarışlarını sıraya sokar
// (communities/owner.ts ile aynı sıra: önce kullanıcı, sonra topluluk).
//
// Neyin silindiği, neyin korunduğu ve nedeni: KV-33 §10 tablosu. Audit'te ad, e-posta veya içerik yoktur; yalnız sayılar
// ve kayıt kimliği.
import { Prisma, type PrismaClient } from "@kararver/db";
import { decide, lockSuperAdmins, lockTarget } from "../admin-users/prisma-store.ts";
import { consumeFreshStepup } from "../security/stepup-guard.ts";
import { eraseAuthoredContent } from "./content.ts";
import { writeAudit } from "../audit/write.ts";
import { releaseOwnedCommunities } from "../communities/owner.ts";
import {
  tombstoneOf,
  type AccountErasureStore,
  type ErasureBlocker,
  type ErasurePreviewRow,
  type LegalHoldRow,
  type RemovalCounts,
  type RetainedCounts,
} from "./store.ts";

type Db = Prisma.TransactionClient | PrismaClient;

const holdSelect = { id: true, reason: true, createdAt: true, placedById: true } as const;

/** WARNING dışındaki süresi dolmamış, kaldırılmamış yaptırım: anonimleştirme ban/askı kaçırma yolu olmasın. */
const activeNonWarning = (now: Date) => ({
  liftedAt: null,
  type: { not: "WARNING" as const },
  OR: [{ endsAt: null }, { endsAt: { gt: now } }],
});

async function blockersOf(db: Db, userId: string, now: Date): Promise<{ blockers: ErasureBlocker[]; legalHold: LegalHoldRow | null }> {
  const [role, hold, sanctions, exporting] = await Promise.all([
    db.userRole.count({ where: { userId } }),
    db.userLegalHold.findFirst({ where: { userId, releasedAt: null }, select: holdSelect }),
    db.sanction.count({ where: { userId, ...activeNonWarning(now) } }),
    db.dataExport.count({ where: { userId, status: { in: ["PENDING", "PROCESSING"] } } }),
  ]);
  const blockers: ErasureBlocker[] = [];
  if (role > 0) blockers.push("has_role");
  if (hold) blockers.push("legal_hold");
  if (sanctions > 0) blockers.push("active_sanction");
  if (exporting > 0) blockers.push("export_in_progress");
  return { blockers, legalHold: hold };
}

async function removalCounts(db: Db, userId: string): Promise<RemovalCounts> {
  const [sessions, dataExports, avatar, communityMemberships, ownedCommunities, pendingCommunityRequests, interests, optOuts, mutes, follows, bookmarks, keys] =
    await Promise.all([
      db.session.count({ where: { userId } }),
      db.dataExport.count({ where: { userId, status: "READY" } }),
      db.mediaAsset.count({ where: { uploaderId: userId, purpose: "AVATAR", NOT: { status: "REJECTED" } } }),
      db.communityMembership.count({ where: { userId } }),
      db.community.count({ where: { ownerId: userId } }),
      db.communityRequest.count({ where: { requesterId: userId, status: "PENDING" } }),
      db.userInterest.count({ where: { userId } }),
      db.notificationTypeOptOut.count({ where: { userId } }),
      db.notificationPollMute.count({ where: { userId } }),
      db.pollFollow.count({ where: { userId } }),
      db.bookmark.count({ where: { userId } }),
      db.idempotencyKey.count({ where: { userId } }),
    ]);
  return {
    polls: await db.poll.count({ where: { authorId: userId, deletedAt: null } }),
    comments: await db.comment.count({ where: { authorId: userId, deletedAt: null } }),
    media: await db.mediaAsset.count({ where: { uploaderId: userId } }),
    sessions,
    dataExports,
    avatar,
    communityMemberships,
    ownedCommunities,
    pendingCommunityRequests,
    preferences: interests + optOuts + mutes + follows + bookmarks + keys,
  };
}

async function retainedCounts(db: Db, userId: string): Promise<RetainedCounts> {
  const [votes, reportsFiled] = await Promise.all([
    db.vote.count({ where: { userId } }),
    db.report.count({ where: { reporterId: userId } }),
  ]);
  return { polls: 0, comments: 0, votes, reportsFiled };
}

const ZERO_REMOVAL: RemovalCounts = { polls: 0, comments: 0, media: 0, sessions: 0, dataExports: 0, avatar: 0, communityMemberships: 0, ownedCommunities: 0, pendingCommunityRequests: 0, preferences: 0 };

export function createPrismaAccountErasureStore(prisma: PrismaClient): AccountErasureStore {
  return {
    async preview(userId, now) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, deletedAt: true, accountErasure: { select: { createdAt: true } } } });
      if (!user) return null;
      const anonymized = user.deletedAt !== null;
      const [gates, willRemove, willRetain] = await Promise.all([
        anonymized ? Promise.resolve({ blockers: [] as ErasureBlocker[], legalHold: null }) : blockersOf(prisma, userId, now),
        anonymized ? Promise.resolve(ZERO_REMOVAL) : removalCounts(prisma, userId),
        retainedCounts(prisma, userId),
      ]);
      return {
        userId,
        username: user.username,
        anonymized,
        anonymizedAt: anonymized ? (user.accountErasure?.createdAt ?? user.deletedAt) : null,
        blockers: gates.blockers,
        legalHold: gates.legalHold,
        willRemove,
        willRetain,
      } satisfies ErasurePreviewRow;
    },

    async anonymize(input) {
      const { userId, actorId, now } = input;
      const self = input.self === true;
      return prisma.$transaction(async (tx) => {
        const target = await lockTarget(tx, userId);
        if (!target) return { kind: "rejected", reason: "not_found" } as const;
        await lockSuperAdmins(tx);
        const role = (await tx.userRole.findUnique({ where: { userId }, select: { role: true } }))?.role ?? null;
        if (self) {
          if (actorId !== userId) return { kind: "rejected", reason: "forbidden" } as const;
        } else {
          const decision = await decide(tx, actorId, "user.anonymize", { targetUserId: userId, targetRoles: role ? [role] : [] }, now);
          if (!decision.allowed) return { kind: "rejected", reason: "forbidden" } as const;
        }

        if (self && input.onLocked && !(await input.onLocked(tx))) return { kind: "rejected", reason: "stale" } as const;

        // Idempotency: kilit altında okunur; ikinci istek ilkinin kaydını bulur ve hiçbir şey yazmaz.
        if (target.deleted) {
          const done = await tx.accountErasure.findUnique({ where: { userId }, select: { createdAt: true } });
          const at = done?.createdAt ?? (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { deletedAt: true } })).deletedAt!;
          if (self) await input.onDone?.(tx);
          return { kind: "unchanged", at } as const;
        }

        const gates = await blockersOf(tx, userId, now);
        if (gates.blockers.length > 0) return { kind: "rejected", reason: gates.blockers[0]! } as const;
        if (!self) {
          const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true } });
          const typed = input.confirmUsername.trim().replace(/^@/, "").toLowerCase();
          if (typed !== user.username.toLowerCase()) return { kind: "rejected", reason: "confirmation_mismatch" } as const;
          if (!input.actorSessionId || !(await consumeFreshStepup(tx, actorId, input.actorSessionId, now)))
            return { kind: "rejected", reason: "mfa_required" } as const;
        }

        const removed = await removalCounts(tx, userId);
        const retained = await retainedCounts(tx, userId);

        // Topluluk satırları id sırasıyla kilitlenir (sahip bırakma, üyelikten ayrılma ve atama yarışları sıraya girer).
        await tx.$queryRaw`
          SELECT id::text AS id FROM communities
          WHERE owner_id = ${userId}::uuid
             OR id IN (SELECT community_id FROM community_memberships WHERE user_id = ${userId}::uuid)
          ORDER BY id FOR UPDATE`;
        // Sahip olunan topluluklar önce yönetici yönetimine döner: sahibin üyeliğini silmek tetikleyiciyle engelli (KV-54 S1).
        await releaseOwnedCommunities(tx, userId, { actorId, requestId: input.requestId, now, reason: input.reason, trigger: "anonymize" });
        const left = await tx.$queryRaw<{ id: string }[]>`
          DELETE FROM community_memberships WHERE user_id = ${userId}::uuid RETURNING community_id::text AS id`;
        if (left.length > 0) {
          await tx.$executeRaw`
            UPDATE communities SET member_count = GREATEST(member_count - 1, 0)
            WHERE id = ANY(${left.map((r) => r.id)}::uuid[])`;
        }

        // Kayıt listesi: sayaçla birlikte (polls.save_count), anket satırları id sırasıyla kilitlenir.
        const saved = await tx.$queryRaw<{ id: string }[]>`
          SELECT p.id::text AS id FROM polls p
          WHERE p.author_id=${userId}::uuid
             OR p.id IN (SELECT poll_id FROM comments WHERE author_id=${userId}::uuid)
             OR p.id IN (SELECT poll_id FROM votes WHERE user_id=${userId}::uuid)
             OR p.id IN (SELECT poll_id FROM poll_reactions WHERE user_id=${userId}::uuid)
             OR p.id IN (SELECT c.poll_id FROM comment_reactions r JOIN comments c ON c.id=r.comment_id WHERE r.user_id=${userId}::uuid)
             OR p.id IN (SELECT poll_id FROM bookmarks WHERE user_id = ${userId}::uuid)
          ORDER BY p.id FOR UPDATE`;
        if (saved.length > 0) {
          await tx.$executeRaw`UPDATE polls SET save_count = GREATEST(save_count - 1, 0)
            WHERE id IN (SELECT poll_id FROM bookmarks WHERE user_id=${userId}::uuid)`;
        }
        await tx.bookmark.deleteMany({ where: { userId } });

        await tx.session.deleteMany({ where: { userId } });
        await tx.userMfaCredential.deleteMany({ where: { userId } });
        await tx.authToken.deleteMany({ where: { userId } });
        await tx.idempotencyKey.deleteMany({ where: { userId } });
        await tx.notification.deleteMany({ where: { recipientId: userId } });
        await tx.notificationTypeOptOut.deleteMany({ where: { userId } });
        await tx.notificationPollMute.deleteMany({ where: { userId } });
        await tx.userInterest.deleteMany({ where: { userId } });
        await tx.pollFollow.deleteMany({ where: { userId } });

        await tx.communityRequest.updateMany({
          where: { requesterId: userId, status: "PENDING" },
          data: { status: "REJECTED", rejectionReason: "Başvuru sahibinin hesabı anonimleştirildi." },
        });

        // Açık e-posta değişimi talebi kapanır ve yeni adres silinir (kişisel veri).
        await tx.emailChangeRequest.updateMany({
          where: { userId, status: "OPEN" },
          data: { status: "CANCELLED", failure: "account_erased", newEmail: null, newEmailNormalized: null, finishedAt: now },
        });

        // Hazır paketler geçersiz kılınır (anahtar ve token hemen silinir); şifreli nesneyi worker depodan siler.
        await tx.dataExport.updateMany({
          where: { userId, status: "READY" },
          data: { status: "EXPIRED", expiresAt: now, encKey: null, tokenHash: null, tokenExpiresAt: null },
        });

        // Avatar görselleri yayından kalkar; dosyaları worker siler (account_erasures.storage_cleaned_at). Bekleyen
        // işlem de REJECTED olur: worker yalnız PENDING'i sonuçlandırır, sonradan yayınlayamaz.
        await tx.mediaAsset.updateMany({
          where: { uploaderId: userId },
          data: { status: "REJECTED", publicObjectKey: null, reviewedById: actorId, reviewedAt: now, reviewNote: "Hesap anonimleştirildi." },
        });

        const tomb = tombstoneOf(userId);
        await tx.user.update({
          where: { id: userId },
          data: {
            email: tomb.email,
            emailNormalized: tomb.email,
            username: tomb.username,
            usernameNormalized: tomb.username,
            displayName: tomb.displayName,
            passwordHash: tomb.passwordHash,
            bio: null,
            avatarMediaId: null,
            emailVerifiedAt: null,
            lastLoginAt: null,
            deletedAt: now,
          },
        });

        const summary = { removed, retained };
        const record = await tx.accountErasure.create({
          data: { userId, requestedById: actorId, reason: input.reason, summary: summary as unknown as Prisma.InputJsonObject, createdAt: now },
          select: { id: true },
        });
        await tx.$queryRaw`SELECT id FROM comments WHERE author_id=${userId}::uuid
          OR id IN (SELECT parent_id FROM comments WHERE author_id=${userId}::uuid)
          OR id IN (SELECT comment_id FROM comment_reactions WHERE user_id=${userId}::uuid)
          ORDER BY id FOR UPDATE`;
        await eraseAuthoredContent(tx, userId, now);
        await tx.contentJob.updateMany({ where: { userId, status: { in: ["QUEUED", "PROCESSING"] } },
          data: { status: "CANCELLED", finishedAt: now } });
        await writeAudit(tx, {
          source: "API",
          actorId,
          action: self ? "account.deletion.confirm" : "user.anonymize",
          operation: self ? "apply" : "anonymize",
          target: { type: "USER", id: userId },
          reason: input.reason,
          before: { anonymized: false },
          after: { anonymized: true, erasureId: record.id, ...summary },
          requestId: input.requestId,
          at: now,
        });
        if (self) await input.onDone?.(tx);
        return { kind: "anonymized", at: now } as const;
      }, { maxWait: 10_000, timeout: 60_000 });
    },

    async placeHold(input) {
      const { userId, actorId, now } = input;
      return prisma.$transaction(async (tx) => {
        const target = await lockTarget(tx, userId);
        if (!target) return { kind: "rejected", reason: "not_found" } as const;
        const decision = await decide(tx, actorId, "user.legalHold.manage", {}, now);
        if (!decision.allowed) return { kind: "rejected", reason: "forbidden" } as const;
        if (target.deleted) return { kind: "rejected", reason: "user_deleted" } as const;
        const open = await tx.userLegalHold.findFirst({ where: { userId, releasedAt: null }, select: holdSelect });
        if (open) return { kind: "unchanged", hold: open } as const;
        const hold = await tx.userLegalHold.create({ data: { userId, reason: input.reason, placedById: actorId }, select: holdSelect });
        await writeAudit(tx, {
          source: "API",
          actorId,
          action: "user.legalHold.manage",
          operation: "place",
          target: { type: "USER", id: userId },
          reason: input.reason,
          before: null,
          after: { holdId: hold.id },
          requestId: input.requestId,
          at: now,
        });
        return { kind: "placed", hold } as const;
      });
    },

    async releaseHold(input) {
      const { userId, actorId, now } = input;
      return prisma.$transaction(async (tx) => {
        const target = await lockTarget(tx, userId);
        if (!target) return { kind: "rejected", reason: "not_found" } as const;
        const decision = await decide(tx, actorId, "user.legalHold.manage", {}, now);
        if (!decision.allowed) return { kind: "rejected", reason: "forbidden" } as const;
        const open = await tx.userLegalHold.findFirst({ where: { userId, releasedAt: null }, select: { id: true } });
        if (!open) return { kind: "unchanged" } as const;
        await tx.userLegalHold.update({ where: { id: open.id }, data: { releasedAt: now, releasedById: actorId, releasedReason: input.reason } });
        await writeAudit(tx, {
          source: "API",
          actorId,
          action: "user.legalHold.manage",
          operation: "release",
          target: { type: "USER", id: userId },
          reason: input.reason,
          before: { holdId: open.id },
          after: null,
          requestId: input.requestId,
          at: now,
        });
        return { kind: "released" } as const;
      });
    },
  };
}

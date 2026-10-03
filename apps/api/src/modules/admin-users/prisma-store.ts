// AdminUserStore'un PostgreSQL/Prisma uygulaması — KV-33 (#35). Kurallar: docs/KV-33_ADMIN_USERS.md, DATA_MODEL §9.1.
//
// Okunan başka sahip tabloları (salt okunur): users, polls, comments, votes, sessions (Faruk), reports, media_assets (Mert).
// Yazılan başka sahip tablosu: sessions.revoked_at (Faruk'un alanı). SUSPEND/BAN aynı transaction'da açık oturumları
// iptal eder (DATA_MODEL §7.2, TECH_DECISIONS §3.4); auth modülünün dosyalarına dokunulmaz, yalnız tabloya yazılır.
//
// Kilit sırası (deadlock yok): 1) hedef users satırı FOR NO KEY UPDATE, 2) gerekirse SUPER_ADMIN user_roles satırları
// (user_id sırasıyla) FOR UPDATE. İkinci bir kullanıcı satırı hiç kilitlenmez. Kilitlerden sonra aktör ve hedef
// taze okunup KV-04 `authorize` yeniden çağrılır: router'daki karar istek öncesi okunmuş veriyle verilmişti.
//
// Neden FOR UPDATE değil: aktör, karşı işlemin hedefi olabilir (iki SUPER_ADMIN birbirini aynı anda düşürür/banlar).
// Bizim yazdığımız sanctions.created_by_id, user_roles.granted_by_id ve audit_logs.actor_id FK kontrolleri aktörün
// users satırında FOR KEY SHARE ister; FOR UPDATE bununla çakışır ve iki işlem birbirini bekler (40P01, yarış testi).
// FOR NO KEY UPDATE KEY SHARE ile çakışmaz; anahtar sütunu değiştirmediğimiz için yeterlidir.
import { authorize, statusFromSanctions, type ActionId, type ResourceContext, type TrustedActor } from "@kararver/contracts";
import { Prisma, type PrismaClient, type Role, type SanctionType, type UserStatus } from "@kararver/db";
import { assertNoCommittedKey, runIdempotent } from "../../http/idempotency.ts";
import { writeAudit } from "../audit/write.ts";
import { normalizeEmail } from "../auth/routes.ts";
import { likeLiteral } from "../search/prisma-store.ts";
import {
  superAdminCountForRoleRule,
  type ActivityRow,
  type AdminUserDetailRow,
  type AdminUserRow,
  type AdminUserStore,
  type ReportRow,
  type SanctionRow,
  type TimeCursor,
  type UserRef,
} from "./store.ts";

type Tx = Prisma.TransactionClient;

const refSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarMedia: { select: { status: true, publicObjectKey: true } },
} as const;

type SelectedRef = { id: string; username: string; displayName: string; avatarMedia: { status: string; publicObjectKey: string | null } | null };

function ref(u: SelectedRef): UserRef {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarPublicKey: u.avatarMedia?.status === "APPROVED" ? u.avatarMedia.publicObjectKey : null,
  };
}

const sanctionSelect = {
  id: true,
  type: true,
  reason: true,
  startsAt: true,
  endsAt: true,
  liftedAt: true,
  liftReason: true,
  createdAt: true,
  createdBy: { select: refSelect },
  liftedBy: { select: refSelect },
} as const;

type SelectedSanction = Prisma.SanctionGetPayload<{ select: typeof sanctionSelect }>;

function sanctionRow(s: SelectedSanction): SanctionRow {
  return { ...s, createdBy: ref(s.createdBy), liftedBy: s.liftedBy ? ref(s.liftedBy) : null };
}

/** Süresi dolmamış, kaldırılmamış yaptırım (DATA_MODEL §9.1). */
const activeAt = (now: Date) => ({ liftedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: now } }] });

/** Keyset (created_at, id) azalan; zaman ISO metni olarak bağlanır (DATA_MODEL §2.2). */
function timeCursorSql(alias: string, after: TimeCursor): Prisma.Sql {
  if (!after) return Prisma.empty;
  const at = after.createdAt.toISOString();
  const t = Prisma.raw(alias);
  return Prisma.sql`AND (${t}.created_at < ${at}::timestamptz OR (${t}.created_at = ${at}::timestamptz AND ${t}.id < ${after.id}::uuid))`;
}

/** Hesaba veya içeriğine yapılan raporların id'leri (rapor tam olarak bir hedefe bağlıdır; UNION ALL çift saymaz). */
const reportsAgainst = (userIds: Prisma.Sql) => Prisma.sql`
  SELECT r.id, r.reported_user_id AS owner FROM reports r WHERE r.reported_user_id = ANY(${userIds})
  UNION ALL SELECT r.id, p.author_id FROM reports r JOIN polls p ON p.id = r.poll_id WHERE p.author_id = ANY(${userIds})
  UNION ALL SELECT r.id, c.author_id FROM reports r JOIN comments c ON c.id = r.comment_id WHERE c.author_id = ANY(${userIds})
  UNION ALL SELECT r.id, m.uploader_id FROM reports r JOIN media_assets m ON m.id = r.media_id WHERE m.uploader_id = ANY(${userIds})`;

// ─── Transaction yardımcıları ──────────────────────────────────

type LockedTarget = { id: string; status: UserStatus; deleted: boolean };

async function lockTarget(tx: Tx, userId: string): Promise<LockedTarget | null> {
  const [row] = await tx.$queryRaw<LockedTarget[]>`
    SELECT id::text AS id, status::text AS status, deleted_at IS NOT NULL AS deleted
    FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
  return row ?? null;
}

/** Son aktif SUPER_ADMIN kuralı için: eşzamanlı iki işlem (birbirini düşüren/banlayan iki SUPER_ADMIN) burada sıraya girer. */
async function lockSuperAdmins(tx: Tx): Promise<void> {
  await tx.$queryRaw`SELECT user_id FROM user_roles WHERE role = 'SUPER_ADMIN' ORDER BY user_id FOR UPDATE`;
}

async function countActiveSuperAdmins(tx: Tx | PrismaClient): Promise<number> {
  return tx.userRole.count({ where: { role: "SUPER_ADMIN", user: { status: "ACTIVE", deletedAt: null } } });
}

async function roleOf(tx: Tx, userId: string): Promise<Role | null> {
  return (await tx.userRole.findUnique({ where: { userId }, select: { role: true } }))?.role ?? null;
}

/** Aktörü transaction içinde taze okur. Yönetici kuralları yalnız rol ve durumla karar verir (KV-04 §1.2/7). */
async function actorIn(tx: Tx, actorId: string): Promise<TrustedActor | null> {
  const u = await tx.user.findUnique({ where: { id: actorId }, select: { status: true, emailVerifiedAt: true, role: { select: { role: true } } } });
  if (!u) return null;
  return {
    userId: actorId,
    roles: u.role ? [u.role.role] : [],
    status: u.status,
    emailVerified: u.emailVerifiedAt !== null,
    sanctions: [],
    moderatedCommunityIds: [],
  };
}

async function decide(tx: Tx, actorId: string, action: ActionId, resource: ResourceContext, now: Date) {
  return authorize(await actorIn(tx, actorId), action, resource, now);
}

/** users.status'u kalan aktif yaptırımlardan yeniden hesaplar ve yazar (DATA_MODEL §9.1). Yeni durumu döner. */
async function syncStatus(tx: Tx, userId: string, current: UserStatus, now: Date): Promise<UserStatus> {
  const open = await tx.sanction.findMany({ where: { userId, liftedAt: null }, select: { type: true, endsAt: true } });
  const next = statusFromSanctions(
    open.map((s) => ({ type: s.type, endsAt: s.endsAt?.toISOString() ?? null })),
    now,
  );
  if (next !== current) await tx.user.update({ where: { id: userId }, data: { status: next } });
  return next;
}

const REVOKES_SESSIONS: ReadonlySet<SanctionType> = new Set(["SUSPEND", "BAN"]);

export function createPrismaAdminUserStore(prisma: PrismaClient): AdminUserStore {
  async function reportCounts(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await prisma.$queryRaw<{ id: string; n: number }[]>`
      SELECT owner::text AS id, count(*)::int AS n FROM (${reportsAgainst(Prisma.sql`${ids}::uuid[]`)}) x GROUP BY owner`;
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  const userSelect = {
    ...refSelect,
    email: true,
    status: true,
    createdAt: true,
    role: { select: { role: true } },
  } as const;

  return {
    async list(filter, limit) {
      const conds: Prisma.Sql[] = [];
      if (filter.q) {
        if (filter.q.includes("@")) {
          conds.push(Prisma.sql`u.email_normalized = ${normalizeEmail(filter.q)}`);
        } else {
          // KV-26 trigram index'leri: users_username_search_idx, users_display_name_search_idx.
          const like = Prisma.sql`'%' || kv_normalize(${likeLiteral(filter.q)}) || '%'`;
          conds.push(Prisma.sql`(kv_normalize(u.username) LIKE ${like} ESCAPE '\\' OR kv_normalize(u.display_name) LIKE ${like} ESCAPE '\\')`);
        }
      }
      if (filter.status) conds.push(Prisma.sql`u.status = ${filter.status}::user_status`);
      if (filter.afterId) conds.push(Prisma.sql`u.id < ${filter.afterId}::uuid`);
      const where = conds.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}` : Prisma.empty;
      const page = await prisma.$queryRaw<{ id: string }[]>`
        SELECT u.id::text AS id FROM users u ${where} ORDER BY u.id DESC LIMIT ${limit}`;
      const ids = page.map((r) => r.id);
      const [users, counts] = await Promise.all([
        prisma.user.findMany({ where: { id: { in: ids } }, select: userSelect }),
        reportCounts(ids),
      ]);
      const byId = new Map(users.map((u) => [u.id, u]));
      return ids.map((id): AdminUserRow => {
        const u = byId.get(id)!;
        return { ...ref(u), email: u.email, status: u.status, role: u.role?.role ?? null, createdAt: u.createdAt, reportCount: counts.get(id) ?? 0 };
      });
    },

    async get(id, now) {
      const u = await prisma.user.findUnique({
        where: { id },
        select: {
          ...userSelect,
          emailVerifiedAt: true,
          lastLoginAt: true,
          sanctions: { where: activeAt(now), select: sanctionSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        },
      });
      if (!u) return null;
      const [pollCount, commentCount, voteCount, counts] = await Promise.all([
        prisma.poll.count({ where: { authorId: id } }),
        prisma.comment.count({ where: { authorId: id } }),
        // Geçersiz sayılmış oylar sayılmaz (DATA_MODEL §5.4); seçimler listelenmez, yalnız sayı.
        prisma.vote.count({ where: { userId: id, invalidatedAt: null } }),
        reportCounts([id]),
      ]);
      return {
        ...ref(u),
        email: u.email,
        status: u.status,
        role: u.role?.role ?? null,
        createdAt: u.createdAt,
        reportCount: counts.get(id) ?? 0,
        emailVerified: u.emailVerifiedAt !== null,
        lastLoginAt: u.lastLoginAt,
        stats: { pollCount, commentCount, voteCount },
        activeSanctions: u.sanctions.map(sanctionRow),
      } satisfies AdminUserDetailRow;
    },

    async target(id) {
      const u = await prisma.user.findUnique({ where: { id }, select: { id: true, status: true, deletedAt: true, role: { select: { role: true } } } });
      return u ? { id: u.id, role: u.role?.role ?? null, status: u.status, deleted: u.deletedAt !== null } : null;
    },

    activeSuperAdminCount: () => countActiveSuperAdmins(prisma),

    async findSanction(userId, sanctionId) {
      const s = await prisma.sanction.findFirst({ where: { id: sanctionId, userId }, select: sanctionSelect });
      return s ? sanctionRow(s) : null;
    },

    async listSanctions(userId, after, limit) {
      const rows = await prisma.sanction.findMany({
        where: {
          userId,
          ...(after ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] } : {}),
        },
        select: sanctionSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });
      return rows.map(sanctionRow);
    },

    async listReports(userId, side, after, limit) {
      const source =
        side === "filed"
          ? Prisma.sql`FROM reports r WHERE r.reporter_id = ${userId}::uuid`
          : Prisma.sql`FROM reports r JOIN (${reportsAgainst(Prisma.sql`ARRAY[${userId}::uuid]`)}) mine ON mine.id = r.id WHERE TRUE`;
      const rows = await prisma.$queryRaw<(Omit<ReportRow, "target"> & { targetType: ReportRow["target"]["type"]; targetId: string })[]>`
        SELECT r.id::text AS id,
          CASE WHEN r.poll_id IS NOT NULL THEN 'POLL' WHEN r.comment_id IS NOT NULL THEN 'COMMENT'
               WHEN r.media_id IS NOT NULL THEN 'MEDIA' ELSE 'USER' END AS "targetType",
          coalesce(r.poll_id, r.comment_id, r.media_id, r.reported_user_id)::text AS "targetId",
          r.reason::text AS reason, r.status::text AS status, r.created_at AS "createdAt", r.resolved_at AS "resolvedAt"
        ${source} ${timeCursorSql("r", after)}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ${limit}`;
      return rows.map(({ targetType, targetId, ...r }) => ({ ...r, target: { type: targetType, id: targetId } }));
    },

    async listActivity(userId, after, limit) {
      return prisma.$queryRaw<ActivityRow[]>`
        SELECT a.kind, a.id::text AS id, a.poll_id::text AS "pollId", a.excerpt, a.status, a.created_at AS "createdAt"
        FROM (
          SELECT 'POLL' AS kind, p.id, p.id AS poll_id, p.title AS excerpt, p.status::text AS status, p.created_at
          FROM polls p WHERE p.author_id = ${userId}::uuid
          UNION ALL
          SELECT 'COMMENT', c.id, c.poll_id, left(c.body, 140), c.status::text, c.created_at
          FROM comments c WHERE c.author_id = ${userId}::uuid
        ) a
        WHERE TRUE ${timeCursorSql("a", after)}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${limit}`;
    },

    async applySanction(scope, input) {
      const { userId, type, actorId, now } = input;
      return runIdempotent<"not_found" | "already_active" | "user_deleted" | "last_super_admin" | "forbidden">(prisma, scope, 201, async (tx) => {
        const target = await lockTarget(tx, userId);
        if (!target) return { ok: false, reason: "not_found" };
        if (scope) await assertNoCommittedKey(tx, scope);
        if (target.deleted) return { ok: false, reason: "user_deleted" };

        const targetRole = await roleOf(tx, userId);
        const removesActiveSuperAdmin = targetRole === "SUPER_ADMIN" && REVOKES_SESSIONS.has(type) && target.status === "ACTIVE";
        if (removesActiveSuperAdmin) await lockSuperAdmins(tx);
        const decision = await decide(tx, actorId, "user.sanction", { targetUserId: userId, targetRoles: targetRole ? [targetRole] : [] }, now);
        if (!decision.allowed) return { ok: false, reason: "forbidden" };
        if (removesActiveSuperAdmin && (await countActiveSuperAdmins(tx)) <= 1) return { ok: false, reason: "last_super_admin" };

        const open = await tx.sanction.findMany({ where: { userId, ...activeAt(now) }, select: { type: true } });
        // WARNING bir kayıttır, birden çok kez verilebilir; diğer tiplerde aynı tipte aktif yaptırım tek olur.
        if (type !== "WARNING" && open.some((s) => s.type === type)) return { ok: false, reason: "already_active" };

        const sanction = await tx.sanction.create({
          // starts_at/created_at işlemin anı (sanctions_lift_check: lifted_at >= created_at aynı saatle karşılaştırılır).
          data: { userId, type, reason: input.reason, startsAt: now, endsAt: input.endsAt, createdById: actorId, createdAt: now },
          select: { id: true },
        });
        const status = await syncStatus(tx, userId, target.status, now);
        // Faruk'un sessions tablosu: SUSPEND/BAN açık oturumları aynı transaction'da iptal eder (DATA_MODEL §7.2).
        const sessionsRevoked = REVOKES_SESSIONS.has(type)
          ? (await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } })).count
          : 0;

        await writeAudit(tx, {
          source: "API",
          actorId,
          action: "user.sanction",
          operation: "apply",
          target: { type: "USER", id: userId },
          reason: input.reason,
          before: { status: target.status, activeTypes: [...new Set(open.map((s) => s.type))].sort() },
          after: { status, sanctionId: sanction.id, type, endsAt: input.endsAt?.toISOString() ?? null, sessionsRevoked },
          requestId: input.requestId,
          at: now,
        });
        return { ok: true, value: sanction.id };
      });
    },

    async liftSanction(input) {
      const { userId, sanctionId, actorId, now } = input;
      return prisma.$transaction(async (tx) => {
        const target = await lockTarget(tx, userId);
        if (!target) return { kind: "rejected", reason: "not_found" } as const;
        const sanction = await tx.sanction.findFirst({ where: { id: sanctionId, userId }, select: { id: true, type: true, endsAt: true, liftedAt: true } });
        if (!sanction) return { kind: "rejected", reason: "not_found" } as const;

        const targetRole = await roleOf(tx, userId);
        const decision = await decide(tx, actorId, "user.sanction.lift", { targetUserId: userId, targetRoles: targetRole ? [targetRole] : [] }, now);
        if (!decision.allowed) return { kind: "rejected", reason: "forbidden" } as const;
        // İkisi de değişiklik ve audit üretmez (KV-33 kararı). Silinmiş hesabın yaptırımı kaldırılabilir.
        if (sanction.liftedAt) return { kind: "rejected", reason: "already_lifted" } as const;
        if (sanction.endsAt && sanction.endsAt <= now) return { kind: "rejected", reason: "expired" } as const;

        await tx.sanction.update({ where: { id: sanctionId }, data: { liftedAt: now, liftedById: actorId, liftReason: input.reason } });
        const status = await syncStatus(tx, userId, target.status, now);
        await writeAudit(tx, {
          source: "API",
          actorId,
          action: "user.sanction.lift",
          operation: "lift",
          target: { type: "USER", id: userId },
          reason: input.reason,
          before: { status: target.status, sanctionId, type: sanction.type },
          after: { status, sanctionId, type: sanction.type },
          requestId: input.requestId,
          at: now,
        });
        return { kind: "lifted" } as const;
      }, { maxWait: 10_000, timeout: 30_000 });
    },

    async setRole(input) {
      const { userId, role, actorId, now } = input;
      return prisma.$transaction(async (tx) => {
        const target = await lockTarget(tx, userId);
        if (!target) return { kind: "rejected", reason: "not_found" } as const;
        await lockSuperAdmins(tx);
        const current = await roleOf(tx, userId);
        const decision = await decide(tx, actorId, "user.role.assign", {
          targetUserId: userId,
          targetRoles: current ? [current] : [],
          newRole: role,
          activeSuperAdminCount: superAdminCountForRoleRule(await countActiveSuperAdmins(tx), { role: current, status: target.status, deleted: target.deleted }),
        }, now);
        if (!decision.allowed) {
          if (decision.code === "CONFLICT") return { kind: "rejected", reason: userId === actorId ? "self" : "last_super_admin" } as const;
          return { kind: "rejected", reason: "forbidden" } as const;
        }

        const before: Role = current ?? "USER";
        if (before === role) return { kind: "unchanged", role } as const;
        // USER: rol satırı silinir (user_roles_not_user_check); diğerleri satırı yazar, veren aktördür.
        if (role === "USER") await tx.userRole.delete({ where: { userId } });
        else {
          await tx.userRole.upsert({
            where: { userId },
            create: { userId, role, grantedById: actorId },
            update: { role, grantedById: actorId },
          });
        }
        await writeAudit(tx, {
          source: "API",
          actorId,
          action: "user.role.assign",
          operation: role === "USER" ? "revoke" : before === "USER" ? "grant" : "change",
          target: { type: "USER", id: userId },
          reason: input.reason,
          before: { role: before },
          after: { role },
          requestId: input.requestId,
          at: now,
        });
        return { kind: "changed", role } as const;
      }, { maxWait: 10_000, timeout: 30_000 });
    },
  };
}


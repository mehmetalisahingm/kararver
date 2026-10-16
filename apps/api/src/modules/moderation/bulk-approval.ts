// Yüksek hacimli toplu moderasyon için ikinci onay — veri erişimi. #183, KV-37 §8. Sözleşme: contracts/domains/moderation.ts
// (admin.moderation.bulkApprovals.*). Tablo: moderation_bulk_approvals (migration CHECK'leri başlatan/onaylayan ayrılığını ve
// durum geçişlerini veritabanında da zorlar).
//
// Güvenlik:
//  - Talep içeriği DEĞİŞTİRMEZ; yalnız ikinci onaycı onaylayınca parti uygulanır.
//  - Onay transaction'ı: talep satır kilidi → durum/süre → başlatan ≠ onaylayan → onaylayan etkin ADMIN+ → taze tek kullanımlık MFA
//    step-up (en son, doğrulamalar geçtikten sonra tüketilir) → parti kaydı + talep güncellemesi + audit aynı transaction'da.
//  - Aynı anda bekleyen talep sayısı başlatan başına sınırlıdır (kullanıcı satırı kilidi altında sayılır).
import { BULK_APPROVAL_PENDING_MAX } from "@kararver/contracts";
import type { Prisma, PrismaClient, UserStatus } from "@kararver/db";
import { writeAudit } from "../audit/write.ts";
import { consumeFreshStepup } from "../security/stepup-guard.ts";
import type { BulkAction } from "./bulk.ts";
import type { ContentKind, ListAfter, PublicUserRef } from "./store.ts";

export type ApprovalState = "PENDING" | "APPROVED" | "REJECTED" | "CANCELED";

export type ApprovalRecord = {
  id: string;
  kind: ContentKind;
  action: BulkAction;
  reason: string;
  digest: string;
  ids: string[];
  willChange: number;
  initiatorId: string;
  status: ApprovalState;
  requestId: string | null;
  createdAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  decisionReason: string | null;
  batchId: string | null;
  initiator: PublicUserRef;
  decidedBy: PublicUserRef | null;
};

/** Başlatanın şimdiki hali: onay anında yetki yeniden kurulur (rol/durum değişmiş olabilir). */
export type InitiatorRow = { id: string; status: UserStatus; emailVerified: boolean; deleted: boolean };

export type CreateInput = { initiatorId: string; kind: ContentKind; action: BulkAction; reason: string; digest: string; ids: string[]; willChange: number; requestId: string | null; now: Date; expiresAt: Date };
export type ApproveInput = { approvalId: string; approverId: string; sessionId: string; reason: string; requestId: string | null; now: Date };
export type DeclineInput = { approvalId: string; actorId: string; mode: "reject" | "cancel"; reason: string; requestId: string | null; now: Date };

export type ListFilter = {
  initiatorId?: string;
  /** EXPIRED: süresi dolmuş bekleyen talep. PENDING: süresi dolmamış bekleyen talep. */
  status?: ApprovalState | "EXPIRED";
  after: ListAfter;
  now: Date;
};

export interface BulkApprovalStore {
  create(input: CreateInput): Promise<{ kind: "ok"; approval: ApprovalRecord } | { kind: "too_many" }>;
  get(id: string): Promise<ApprovalRecord | null>;
  list(filter: ListFilter, limit: number): Promise<ApprovalRecord[]>;
  initiator(id: string): Promise<InitiatorRow | null>;
  approve(input: ApproveInput): Promise<{ kind: "ok"; approval: ApprovalRecord; batchId: string } | { kind: "rejected"; reason: "closed" | "self_approval" | "forbidden" | "stepup_required" }>;
  decline(input: DeclineInput): Promise<{ kind: "ok"; approval: ApprovalRecord } | { kind: "rejected"; reason: "closed" | "self_approval" | "forbidden" }>;
}

type Row = Prisma.ModerationBulkApprovalGetPayload<{ include: typeof include }>;
const userSelect = { id: true, username: true, displayName: true, avatarMedia: { select: { status: true, publicObjectKey: true } } } as const;
const include = { initiator: { select: userSelect }, decidedBy: { select: userSelect } } as const;

const ref = (u: NonNullable<Row["initiator"]>): PublicUserRef => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  avatarPublicKey: u.avatarMedia?.status === "APPROVED" ? u.avatarMedia.publicObjectKey : null,
});

function toRecord(r: Row): ApprovalRecord {
  return {
    id: r.id,
    kind: r.kind === "POLLS" ? "polls" : "comments",
    action: r.action as BulkAction,
    reason: r.reason,
    digest: r.digest,
    ids: r.ids,
    willChange: r.willChange,
    initiatorId: r.initiatorId,
    status: r.status as ApprovalState,
    requestId: r.requestId,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    decidedAt: r.decidedAt,
    decisionReason: r.decisionReason,
    batchId: r.batchId,
    initiator: ref(r.initiator),
    decidedBy: r.decidedBy ? ref(r.decidedBy) : null,
  };
}

type Locked = { id: string; status: string; expires_at: Date; initiator_id: string; kind: string; action: string; will_change: number; ids: string[]; reason: string; digest: string };

export function createPrismaBulkApprovalStore(prisma: PrismaClient): BulkApprovalStore {
  const load = async (db: Prisma.TransactionClient | PrismaClient, id: string) => {
    const row = await db.moderationBulkApproval.findUnique({ where: { id }, include });
    return row ? toRecord(row) : null;
  };

  return {
    async create(input) {
      return prisma.$transaction(async (tx) => {
        // Başlatan başına sayım ve ekleme aynı kilit altında: eşzamanlı iki talep sınırı birlikte aşamaz.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.initiatorId}::uuid FOR NO KEY UPDATE`;
        const pending = await tx.moderationBulkApproval.count({ where: { initiatorId: input.initiatorId, status: "PENDING", expiresAt: { gt: input.now } } });
        if (pending >= BULK_APPROVAL_PENDING_MAX) return { kind: "too_many" as const };
        const row = await tx.moderationBulkApproval.create({
          data: {
            kind: input.kind === "polls" ? "POLLS" : "COMMENTS",
            action: input.action,
            reason: input.reason,
            digest: input.digest,
            ids: input.ids,
            willChange: input.willChange,
            initiatorId: input.initiatorId,
            requestId: input.requestId,
            createdAt: input.now,
            expiresAt: input.expiresAt,
          },
          include,
        });
        await writeAudit(tx, {
          source: "API",
          actorId: input.initiatorId,
          action: "moderation.bulk.approve",
          operation: "request",
          target: { type: "BULK_APPROVAL", id: row.id },
          reason: input.reason,
          before: null,
          after: { kind: input.kind, action: input.action, itemCount: input.willChange, selected: input.ids.length, status: "PENDING" },
          requestId: input.requestId,
          at: input.now,
        });
        return { kind: "ok" as const, approval: toRecord(row) };
      });
    },

    get: (id) => load(prisma, id),

    async list(filter, limit) {
      const after = filter.after;
      const s = filter.status;
      const statusWhere: Prisma.ModerationBulkApprovalWhereInput =
        s === "EXPIRED" ? { status: "PENDING", expiresAt: { lte: filter.now } } : s === "PENDING" ? { status: "PENDING", expiresAt: { gt: filter.now } } : s ? { status: s } : {};
      const rows = await prisma.moderationBulkApproval.findMany({
        where: {
          ...statusWhere,
          ...(filter.initiatorId ? { initiatorId: filter.initiatorId } : {}),
          ...(after ? { AND: [{ OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }] }] } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        include,
      });
      return rows.map(toRecord);
    },

    async initiator(id) {
      const u = await prisma.user.findUnique({ where: { id }, select: { id: true, status: true, emailVerifiedAt: true, deletedAt: true } });
      return u ? { id: u.id, status: u.status, emailVerified: u.emailVerifiedAt !== null, deleted: u.deletedAt !== null } : null;
    },

    async approve(input) {
      return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Locked[]>`
          SELECT id, status, expires_at, initiator_id, kind::text AS kind, action::text AS action, will_change, ids, reason, digest
          FROM moderation_bulk_approvals WHERE id = ${input.approvalId}::uuid FOR UPDATE`;
        const a = rows[0];
        if (!a || a.status !== "PENDING" || a.expires_at <= input.now) return { kind: "rejected" as const, reason: "closed" as const };
        if (a.initiator_id === input.approverId) return { kind: "rejected" as const, reason: "self_approval" as const };
        const approvers = await tx.$queryRaw<{ id: string }[]>`
          SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
          WHERE u.id = ${input.approverId}::uuid AND ur.role IN ('ADMIN', 'SUPER_ADMIN') AND u.status = 'ACTIVE' AND u.deleted_at IS NULL`;
        if (approvers.length !== 1) return { kind: "rejected" as const, reason: "forbidden" as const };
        // En son: step-up tek kullanımlıktır, ancak bütün koşullar sağlandığında tüketilir.
        if (!(await consumeFreshStepup(tx, input.approverId, input.sessionId, input.now))) return { kind: "rejected" as const, reason: "stepup_required" as const };
        const batch = await tx.moderationBatch.create({
          data: {
            actorId: a.initiator_id,
            kind: a.kind as "POLLS" | "COMMENTS",
            action: a.action as BulkAction,
            reason: a.reason,
            digest: a.digest,
            requestId: input.requestId,
            total: a.ids.length,
            createdAt: input.now,
          },
          select: { id: true },
        });
        await tx.moderationBulkApproval.update({
          where: { id: a.id },
          data: { status: "APPROVED", decidedById: input.approverId, decidedAt: input.now, decisionReason: input.reason, batchId: batch.id },
        });
        await writeAudit(tx, {
          source: "API",
          actorId: input.approverId,
          action: "moderation.bulk.approve",
          operation: "approve",
          target: { type: "BULK_APPROVAL", id: a.id },
          reason: input.reason,
          before: { status: "PENDING", initiatorId: a.initiator_id },
          after: { status: "APPROVED", batchId: batch.id, itemCount: a.will_change, selected: a.ids.length },
          requestId: input.requestId,
          at: input.now,
        });
        return { kind: "ok" as const, approval: (await load(tx, a.id))!, batchId: batch.id };
      });
    },

    async decline(input) {
      return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Locked[]>`
          SELECT id, status, expires_at, initiator_id, kind::text AS kind, action::text AS action, will_change, ids, reason, digest
          FROM moderation_bulk_approvals WHERE id = ${input.approvalId}::uuid FOR UPDATE`;
        const a = rows[0];
        if (!a || a.status !== "PENDING" || a.expires_at <= input.now) return { kind: "rejected" as const, reason: "closed" as const };
        if (input.mode === "reject" && a.initiator_id === input.actorId) return { kind: "rejected" as const, reason: "self_approval" as const };
        if (input.mode === "cancel" && a.initiator_id !== input.actorId) return { kind: "rejected" as const, reason: "forbidden" as const };
        const status = input.mode === "reject" ? "REJECTED" : "CANCELED";
        await tx.moderationBulkApproval.update({
          where: { id: a.id },
          data: { status, decidedById: input.actorId, decidedAt: input.now, decisionReason: input.reason },
        });
        await writeAudit(tx, {
          source: "API",
          actorId: input.actorId,
          action: input.mode === "reject" ? "moderation.bulk.approve" : "moderation.bulk.cancel",
          operation: input.mode,
          target: { type: "BULK_APPROVAL", id: a.id },
          reason: input.reason,
          before: { status: "PENDING", initiatorId: a.initiator_id },
          after: { status, itemCount: a.will_change, selected: a.ids.length },
          requestId: input.requestId,
          at: input.now,
        });
        return { kind: "ok" as const, approval: (await load(tx, a.id))! };
      });
    },
  };
}

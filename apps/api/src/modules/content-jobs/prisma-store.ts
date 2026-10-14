// ContentJobStore'un PostgreSQL/Prisma uygulaması — #181. Kurallar: docs/KV-33_ADMIN_USERS.md §9.
//
// Her yönetici işlemi tek transaction'dadır: hedef kullanıcı satırı kilitlenir (admin-users ve veri dışa aktarmayla aynı
// kilit; eşzamanlı iki onay burada sıraya girer), yetki taze aktörle yeniden verilir, ardından iş satırı + iş düzeyi audit
// birlikte yazılır. İçerik başına işlem (durum geçişi, sayaç, moderation_actions, audit, olay) çalıştırıcıdadır (runner.ts).
import { Prisma, type PrismaClient } from "@kararver/db";
import { decide, lockTarget } from "../admin-users/prisma-store.ts";
import { writeAudit } from "../audit/write.ts";
import { countEligible, countRestorable, includes } from "./eligible.ts";
import type { ContentJobStore, JobRow } from "./store.ts";

type Tx = Prisma.TransactionClient;

const jobSelect = {
  id: true,
  kind: true,
  status: true,
  includePolls: true,
  includeComments: true,
  reason: true,
  expectedPolls: true,
  expectedComments: true,
  applied: true,
  unchanged: true,
  failed: true,
  skipped: true,
  failure: true,
  undoOfId: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  undoneBy: { select: { id: true } },
} as const;

type SelectedJob = Prisma.ContentJobGetPayload<{ select: typeof jobSelect }>;

const OPEN: ("QUEUED" | "PROCESSING")[] = ["QUEUED", "PROCESSING"];
const FINISHED = new Set(["DONE", "FAILED", "CANCELLED"]);

const isUnique = (err: unknown) => !!err && typeof err === "object" && (err as { code?: string }).code === "P2002";

/** canUndo: bitmiş, geri alma işi olmayan, geri alınabilir (ACTIVE'ten gelmiş) uygulanmış öğesi olan ve hesapta açık iş bulunmayan iş. */
async function toRows(db: PrismaClient | Tx, userId: string, rows: SelectedJob[]): Promise<JobRow[]> {
  const openJob = (await db.contentJob.count({ where: { userId, status: { in: OPEN } } })) > 0;
  const out: JobRow[] = [];
  for (const r of rows) {
    let canUndo = false;
    if (!openJob && r.kind !== "UNDO" && FINISHED.has(r.status) && r.applied > 0 && !r.undoneBy) {
      const restorable = await countRestorable(db, r.id);
      canUndo = restorable.polls + restorable.comments > 0;
    }
    const { undoneBy: _unused, ...rest } = r;
    out.push({ ...rest, canUndo });
  }
  return out;
}

export function createPrismaContentJobStore(prisma: PrismaClient): ContentJobStore {
  async function authorizeLocked(tx: Tx, userId: string, actorId: string, now: Date) {
    const target = await lockTarget(tx, userId);
    if (!target) return { ok: false, reason: "not_found" } as const;
    const role = (await tx.userRole.findUnique({ where: { userId }, select: { role: true } }))?.role ?? null;
    const decision = await decide(tx, actorId, "user.content.bulk", { targetUserId: userId, targetRoles: role ? [role] : [] }, now);
    if (!decision.allowed) return { ok: false, reason: "forbidden" } as const;
    return { ok: true, deleted: target.deleted } as const;
  }

  return {
    async preview(userId, action, scope, cutoffAt) {
      if ((await prisma.user.count({ where: { id: userId } })) === 0) return null;
      return countEligible(prisma, userId, action, scope, cutoffAt);
    },

    async list(userId, limit) {
      const rows = await prisma.contentJob.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, select: jobSelect });
      return toRows(prisma, userId, rows);
    },

    async create(input) {
      const { userId, actorId, now } = input;
      try {
        return await prisma.$transaction(async (tx) => {
          const auth = await authorizeLocked(tx, userId, actorId, now);
          if (!auth.ok) return { kind: "rejected", reason: auth.reason } as const;
          if (auth.deleted) return { kind: "rejected", reason: "user_deleted" } as const;
          const age = now.getTime() - input.cutoffAt.getTime();
          if (age < 0 || age > input.previewTtlMs) return { kind: "rejected", reason: "preview_expired" } as const;
          if ((await tx.contentJob.count({ where: { userId, status: { in: OPEN } } })) > 0) return { kind: "rejected", reason: "job_open" } as const;

          // Ayrı onay: sayılar onay anında yeniden hesaplanır; önizlemeden farklıysa (içerik değişti) iş açılmaz.
          const counts = await countEligible(tx, userId, input.action, input.scope, input.cutoffAt);
          if (counts.polls !== input.expected.polls || counts.comments !== input.expected.comments) return { kind: "rejected", reason: "preview_stale" } as const;
          const total = counts.polls + counts.comments;
          if (total === 0) return { kind: "rejected", reason: "nothing_to_do" } as const;
          if (total > input.maxItems) return { kind: "rejected", reason: "too_many" } as const;

          const want = includes(input.scope);
          const created = await tx.contentJob.create({
            data: {
              userId,
              requestedById: actorId,
              kind: input.action,
              reason: input.reason,
              includePolls: want.polls,
              includeComments: want.comments,
              cutoffAt: input.cutoffAt,
              expectedPolls: counts.polls,
              expectedComments: counts.comments,
            },
            select: jobSelect,
          });
          await writeAudit(tx, {
            source: "API",
            actorId,
            action: "user.content.bulk",
            operation: "request",
            target: { type: "USER", id: userId },
            reason: input.reason,
            before: null,
            after: { jobId: created.id, kind: input.action, scope: input.scope, polls: counts.polls, comments: counts.comments },
            requestId: input.requestId,
            at: now,
          });
          return { kind: "created", job: (await toRows(tx, userId, [created]))[0]! } as const;
        });
      } catch (err) {
        // Kısmi unique index (hesap başına tek açık iş): yarışta kaybeden aynı yanıtı alır.
        if (isUnique(err)) return { kind: "rejected", reason: "job_open" } as const;
        throw err;
      }
    },

    async undo(input) {
      const { userId, jobId, actorId, now } = input;
      try {
        return await prisma.$transaction(async (tx) => {
          const auth = await authorizeLocked(tx, userId, actorId, now);
          if (!auth.ok) return { kind: "rejected", reason: auth.reason } as const;
          const original = await tx.contentJob.findFirst({ where: { id: jobId, userId }, select: jobSelect });
          if (!original) return { kind: "rejected", reason: "not_found" } as const;
          if (auth.deleted) return { kind: "rejected", reason: "user_deleted" } as const;
          if ((await tx.contentJob.count({ where: { userId, status: { in: OPEN } } })) > 0) return { kind: "rejected", reason: "job_open" } as const;
          if (original.kind === "UNDO" || !FINISHED.has(original.status) || original.applied === 0 || original.undoneBy) {
            return { kind: "rejected", reason: "not_undoable" } as const;
          }
          const restorable = await countRestorable(tx, original.id);
          if (restorable.polls + restorable.comments === 0) return { kind: "rejected", reason: "not_undoable" } as const;

          const created = await tx.contentJob.create({
            data: {
              userId,
              requestedById: actorId,
              kind: "UNDO",
              undoOfId: original.id,
              reason: input.reason,
              includePolls: restorable.polls > 0,
              includeComments: restorable.comments > 0,
              cutoffAt: now,
              expectedPolls: restorable.polls,
              expectedComments: restorable.comments,
            },
            select: jobSelect,
          });
          await writeAudit(tx, {
            source: "API",
            actorId,
            action: "user.content.bulk",
            operation: "undo",
            target: { type: "USER", id: userId },
            reason: input.reason,
            before: { jobId: original.id, kind: original.kind },
            after: { jobId: created.id, polls: restorable.polls, comments: restorable.comments },
            requestId: input.requestId,
            at: now,
          });
          return { kind: "created", job: (await toRows(tx, userId, [created]))[0]! } as const;
        });
      } catch (err) {
        // undo_of_id unique (çift geri alma) veya açık iş indeksi.
        if (isUnique(err)) return { kind: "rejected", reason: "not_undoable" } as const;
        throw err;
      }
    },

    async cancel(input) {
      const { userId, jobId, actorId, now } = input;
      return prisma.$transaction(async (tx) => {
        const auth = await authorizeLocked(tx, userId, actorId, now);
        if (!auth.ok) return { kind: "rejected", reason: auth.reason } as const;
        const job = await tx.contentJob.findFirst({ where: { id: jobId, userId }, select: { id: true, kind: true, status: true } });
        if (!job) return { kind: "rejected", reason: "not_found" } as const;
        // Koşullu güncelleme: çalıştırıcı işi aynı anda bitirdiyse (DONE) iptal reddedilir.
        const done = await tx.contentJob.updateMany({ where: { id: jobId, status: { in: OPEN } }, data: { status: "CANCELLED", finishedAt: now, claimedAt: null } });
        if (done.count === 0) return { kind: "rejected", reason: "not_cancellable" } as const;
        await writeAudit(tx, {
          source: "API",
          actorId,
          action: "user.content.bulk",
          operation: "cancel",
          target: { type: "USER", id: userId },
          reason: input.reason,
          before: { jobId, status: job.status },
          after: { jobId, status: "CANCELLED" },
          requestId: input.requestId,
          at: now,
        });
        const row = await tx.contentJob.findUniqueOrThrow({ where: { id: jobId }, select: jobSelect });
        return { kind: "cancelled", job: (await toRows(tx, userId, [row]))[0]! } as const;
      });
    },
  };
}

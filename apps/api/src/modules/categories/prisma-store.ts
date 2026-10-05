// CategoryAdminStore'un PostgreSQL uygulaması.
// Slug tekilliği: aynı slug'a yazan işlemler slug üzerinde transaction advisory lock alır, sonra kontrol eder.
// Böylece çakışma unique index hatasıyla (transaction'ı bozan istisna) değil, 409 sonucu olarak döner.
import { Prisma, type PrismaClient } from "@kararver/db";
import { assertNoCommittedKey, runIdempotent } from "../../http/idempotency.ts";
import { writeAudit } from "../audit/write.ts";
import type { AdminCategoryRow, CategoryAdminStore } from "./store.ts";

type Tx = Prisma.TransactionClient;

const select = {
  id: true,
  slug: true,
  name: true,
  description: true,
  iconKey: true,
  sortOrder: true,
  isActive: true,
  // Kaldırılan (REMOVED) anketler sayılmaz; gizli/incelemedeki anketler yönetici için sayılır.
  _count: { select: { polls: { where: { status: { not: "REMOVED" } } } } },
} as const satisfies Prisma.CategorySelect;

const auditSelect = {
  slug: true,
  name: true,
  description: true,
  iconKey: true,
  sortOrder: true,
  isActive: true,
} as const satisfies Prisma.CategorySelect;

type Selected = Prisma.CategoryGetPayload<{ select: typeof select }>;

type AuditSelected = Prisma.CategoryGetPayload<{ select: typeof auditSelect }>;

function toRow({ _count, ...c }: Selected): AdminCategoryRow {
  return { ...c, pollCount: _count.polls };
}

async function lockSlug(tx: Tx, slug: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`categories.slug:${slug}`}, 0))`;
}

async function slugTaken(tx: Tx, slug: string, exceptId?: string): Promise<boolean> {
  const other = await tx.category.findUnique({ where: { slug }, select: { id: true } });
  return other !== null && other.id !== exceptId;
}

function changedFields(current: AuditSelected, patch: Record<string, unknown>) {
  const entries = Object.entries(patch).filter(([key, value]) => value !== undefined && value !== current[key as keyof AuditSelected]);
  return Object.fromEntries(entries);
}

export function createPrismaCategoryAdminStore(prisma: PrismaClient): CategoryAdminStore {
  return {
    async list({ after, limit }) {
      const rows = await prisma.category.findMany({
        where: after
          ? {
              OR: [
                { sortOrder: { gt: Number(after.keys[0]) } },
                { sortOrder: Number(after.keys[0]), id: { gt: after.id } },
              ],
            }
          : {},
        select,
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        take: limit,
      });
      return rows.map(toRow);
    },

    async get(id) {
      const row = await prisma.category.findUnique({ where: { id }, select });
      return row ? toRow(row) : null;
    },

    create(scope, input, trail) {
      return runIdempotent<"SLUG_TAKEN">(prisma, scope, 201, async (tx) => {
        await lockSlug(tx, input.slug);
        // Kilidi beklerken aynı anahtarlı istek tamamlandıysa 409 değil kayıtlı sonuç döner.
        if (scope) await assertNoCommittedKey(tx, scope);
        if (await slugTaken(tx, input.slug)) return { ok: false, reason: "SLUG_TAKEN" };
        const created = await tx.category.create({ data: input, select: { id: true, ...auditSelect } });
        const { id, ...after } = created;
        await writeAudit(tx, {
          source: "API",
          actorId: trail.actorId,
          action: "category.manage",
          operation: "create",
          target: { type: "CATEGORY", id },
          reason: trail.reason,
          before: null,
          after,
          requestId: trail.requestId,
          at: trail.now,
        });
        return { ok: true, value: id };
      });
    },

    update(id, patch, trail) {
      return prisma.$transaction(async (tx) => {
        if (patch.slug !== undefined) await lockSlug(tx, patch.slug);
        const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM categories WHERE id = ${id}::uuid FOR UPDATE`;
        if (!locked) return "NOT_FOUND" as const;
        if (patch.slug !== undefined && (await slugTaken(tx, patch.slug, id))) return "SLUG_TAKEN" as const;

        const current = await tx.category.findUniqueOrThrow({ where: { id }, select: auditSelect });
        const changes = changedFields(current, patch as Record<string, unknown>);
        if (Object.keys(changes).length === 0) return "OK" as const;

        await tx.category.update({ where: { id }, data: changes });
        await writeAudit(tx, {
          source: "API",
          actorId: trail.actorId,
          action: "category.manage",
          operation: "update",
          target: { type: "CATEGORY", id },
          reason: trail.reason,
          before: Object.fromEntries(Object.keys(changes).map((key) => [key, current[key as keyof AuditSelected] ?? null])),
          after: changes,
          requestId: trail.requestId,
          at: trail.now,
        });
        return "OK" as const;
      });
    },
  };
}
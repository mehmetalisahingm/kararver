// #172 — end-to-end community creation requests.
// Admin approval and community creation/membership/audit are one locked DB transaction.
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { PrismaClient } from "@kararver/db";
import { writeAudit } from "../audit/write.ts";

export type CommunityRequestInput = {
  name: string; slug: string; description?: string; categoryId?: string;
};
export type CommunityRequestRecord = {
  id: string; requesterId: string; communityId: string | null;
  name: string; slug: string; description: string | null; categoryId: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CLOSED";
  rejectionReason: string | null; approvedAt: Date | null;
  approvalDeadline: Date | null; closedAt: Date | null; createdAt: Date;
  memberCount: number;
};
export type CommunityRequestStore = {
  create(userId: string, input: CommunityRequestInput): Promise<{ row: CommunityRequestRecord; created: boolean }>;
  mine(userId: string): Promise<CommunityRequestRecord[]>;
  queue(status?: CommunityRequestRecord["status"]): Promise<CommunityRequestRecord[]>;
  decide(id: string, decision: "APPROVE" | "REJECT", reason: string, actorId: string, requestId: string, now: Date): Promise<CommunityRequestRecord>;
};

const conflict = (message = "Bu topluluk adresi kullanılıyor veya başvuru zaten değerlendirildi.") =>
  new ApiError("CONFLICT", message);
const isUnique = (err: unknown) =>
  !!err && typeof err === "object" && (err as { code?: string }).code === "P2002";

const summary = (r: {
  id: string; requesterId: string; communityId: string | null; name: string;
  slug: string; description: string | null; categoryId: string | null;
  status: CommunityRequestRecord["status"]; rejectionReason: string | null;
  approvedAt: Date | null; approvalDeadline: Date | null; closedAt: Date | null;
  createdAt: Date; updatedAt: Date; community: { memberCount: number } | null;
}): CommunityRequestRecord => {
  const { community, updatedAt: _unused, ...fields } = r;
  return { ...fields, memberCount: community?.memberCount ?? 0 };
};
const detailInclude = { community: { select: { memberCount: true } } } as const;

function sameRequest(r: CommunityRequestRecord, userId: string, input: CommunityRequestInput) {
  return r.requesterId === userId && r.name === input.name &&
    r.description === (input.description || null) && r.categoryId === (input.categoryId || null);
}

export function createPrismaCommunityRequestStore(prisma: PrismaClient): CommunityRequestStore {
  async function byId(id: string): Promise<CommunityRequestRecord> {
    const row = await prisma.communityRequest.findUnique({ where: { id }, include: detailInclude });
    if (!row) throw new ApiError("NOT_FOUND", "Başvuru bulunamadı.");
    return summary(row);
  }
  return {
    async create(userId, input) {
      const row = await prisma.communityRequest.findFirst({ where: { slug: input.slug, status: "PENDING" }, include: detailInclude });
      if (row) {
        const existing = summary(row);
        if (sameRequest(existing, userId, input)) return { row: existing, created: false };
        throw conflict();
      }
      if (await prisma.community.count({ where: { slug: input.slug } })) throw conflict();
      if (input.categoryId && !await prisma.category.count({ where: { id: input.categoryId, isActive: true } }))
        throw new ApiError("VALIDATION_ERROR", "Geçersiz veya kapatılmış kategori.", [{ field: "categoryId", code: "not_found" }]);
      try {
        const created = await prisma.communityRequest.create({
          data: {
            requesterId: userId, name: input.name, slug: input.slug,
            description: input.description || null, categoryId: input.categoryId ?? null,
          },
          include: detailInclude,
        });
        return { row: summary(created), created: true };
      } catch (err) {
        if (!isUnique(err)) throw err;
        const winner = await prisma.communityRequest.findFirst({ where: { slug: input.slug, status: "PENDING" }, include: detailInclude });
        if (winner && sameRequest(summary(winner), userId, input)) return { row: summary(winner), created: false };
        throw conflict();
      }
    },
    async mine(userId) {
      const rows = await prisma.communityRequest.findMany({ where: { requesterId: userId }, orderBy: { createdAt: "desc" }, take: 100, include: detailInclude });
      return rows.map(summary);
    },
    async queue(status) {
      const rows = await prisma.communityRequest.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 100, include: detailInclude });
      return rows.map(summary);
    },
    async decide(id, decision, reason, actorId, requestId, now) {
      try {
        await prisma.$transaction(async (tx) => {
          // FOR UPDATE serializes concurrent approvals/rejections of the same request.
          const found = await tx.$queryRaw<{ id: string }[]>`
            SELECT id::text AS id FROM community_requests WHERE id = ${id}::uuid FOR UPDATE`;
          if (!found.length) throw new ApiError("NOT_FOUND", "Başvuru bulunamadı.");
          const r = await tx.communityRequest.findUniqueOrThrow({ where: { id } });
          if (r.status !== "PENDING") {
            if (r.status === (decision === "APPROVE" ? "APPROVED" : "REJECTED")) return;
            throw conflict("Başvuru daha önce farklı bir kararla sonuçlandırılmış.");
          }
          let communityId: string | null = null;
          if (decision === "APPROVE") {
            // If an admin created the same slug while the request was pending, reject safely.
            if (await tx.community.count({ where: { slug: r.slug } })) throw conflict();
            const community = await tx.community.create({
              data: {
                name: r.name, slug: r.slug, description: r.description,
                createdById: r.requesterId, memberCount: 1,
              }, select: { id: true },
            });
            communityId = community.id;
            await tx.communityMembership.create({ data: {
              communityId: community.id, userId: r.requesterId, role: "MEMBER",
            } });
          }
          const after = decision === "APPROVE" ? {
            status: "APPROVED" as const, communityId, approvedAt: now,
            approvalDeadline: new Date(now.getTime() + 7 * 24 * 60 * 60_000),
          } : { status: "REJECTED" as const, rejectionReason: reason };
          await tx.communityRequest.update({ where: { id }, data: after });
          await writeAudit(tx, {
            source: "API", actorId, action: "community.request.review",
            operation: decision === "APPROVE" ? "approve" : "reject",
            target: { type: "COMMUNITY", id: communityId ?? id },
            reason, before: { status: r.status, requestId: id },
            after: { status: after.status, requestId: id, ...(communityId ? { communityId } : {}) },
            requestId, at: now,
          });
        }, { maxWait: 10_000, timeout: 30_000 });
      } catch (err) {
        if (isUnique(err)) throw conflict();
        throw err;
      }
      return byId(id);
    },
  };
}

const serialize = (r: CommunityRequestRecord) => ({
  ...r, approvedAt: r.approvedAt?.toISOString() ?? null,
  approvalDeadline: r.approvalDeadline?.toISOString() ?? null,
  closedAt: r.closedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

export function registerCommunityRequestRoutes(route: Route, store: CommunityRequestStore, now: () => Date) {
  route("communities.requests.create", async ({ body, viewer }) => {
    const result = await store.create(viewer!.id, body);
    return { status: result.created ? 201 : 200, body: { data: serialize(result.row) } };
  });
  route("communities.requests.mine", async ({ viewer }) => ({
    status: 200, body: { data: (await store.mine(viewer!.id)).map(serialize) },
  }));
  route("admin.communities.requests.list", async ({ query }) => ({
    status: 200, body: { data: (await store.queue(query.status)).map(serialize) },
  }));
  route("admin.communities.requests.decide", async ({ params, body, viewer, request }) => ({
    status: 200, body: { data: serialize(await store.decide(params.id, body.decision, body.reason, viewer!.id, request.id, now())) },
  }));
}

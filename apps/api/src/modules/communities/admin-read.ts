// Topluluk yönetim görünümü (salt okuma) — #184. Sözleşme: contracts/domains/communities.ts (admin.communities.listAll,
// .overview, .members). Yetki KV-04 `community.admin.read` (ADMIN+). Hiçbir şey yazmaz; kapatma/açma kararı mevcut
// `admin.communities.update` ile (gerekçeli, audit'li) verilir, bu görünüm kararın etkisini önceden gösterir.
//
// 7 gün / 10 üye eşiği (#172) burada yalnız GÖSTERİLİR; kuralı uygulayan worker'dır (apps/worker/src/jobs/communities/
// expire-requests.ts: onay tarihinden 7 gün sonra, 10'dan az üye varsa topluluk HIDDEN ve başvuru CLOSED).
import type { PrismaClient } from "@kararver/db";
import { decodeCursor, encodeCursor } from "../../http/cursor.ts";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";

export const REQUIRED_MEMBERS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ThresholdState = "NOT_APPLICABLE" | "IN_PROGRESS" | "REACHED" | "OVERDUE" | "AUTO_CLOSED" | "REOPENED";
export type ThresholdRequest = { id: string; status: "PENDING" | "APPROVED" | "REJECTED" | "CLOSED"; approvedAt: Date | null; approvalDeadline: Date | null; closedAt: Date | null };

export type Threshold = {
  state: ThresholdState;
  requestId: string | null;
  requiredMembers: number;
  members: number;
  approvedAt: Date | null;
  approvalDeadline: Date | null;
  closedAt: Date | null;
  daysLeft: number | null;
};

/**
 * Eşik durumu (saf fonksiyon). Başvurusuz (yönetici açtığı) topluluk için eşik yoktur. Onaylı başvuruda: süre sürüyorsa
 * IN_PROGRESS; süre dolmuş ve 10+ üye varsa REACHED (worker kapatmaz); süre dolmuş ve eşik altıysa OVERDUE (günlük worker
 * kapanışı bekleniyor; topluluk elle HIDDEN yapılmışsa worker kapatmaz). CLOSED başvuru: topluluk hâlâ HIDDEN ise AUTO_CLOSED,
 * yönetici yeniden açtıysa REOPENED (başvuru CLOSED olduğundan yeniden otomatik kapanmaz).
 */
export function thresholdOf(request: ThresholdRequest | null, communityStatus: "ACTIVE" | "HIDDEN", members: number, now: Date): Threshold {
  const base = {
    requestId: request?.id ?? null,
    requiredMembers: REQUIRED_MEMBERS,
    members,
    approvedAt: request?.approvedAt ?? null,
    approvalDeadline: request?.approvalDeadline ?? null,
    closedAt: request?.closedAt ?? null,
    daysLeft: null as number | null,
  };
  if (!request || request.status === "PENDING" || request.status === "REJECTED") return { ...base, state: "NOT_APPLICABLE" };
  if (request.status === "CLOSED") return { ...base, state: communityStatus === "HIDDEN" ? "AUTO_CLOSED" : "REOPENED" };
  const deadline = request.approvalDeadline;
  if (deadline && deadline.getTime() > now.getTime()) return { ...base, state: "IN_PROGRESS", daysLeft: Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS) };
  return { ...base, state: members >= REQUIRED_MEMBERS ? "REACHED" : "OVERDUE" };
}

type Row = {
  id: string;
  slug: string;
  name: string;
  status: "ACTIVE" | "HIDDEN";
  membersVisibility: "PUBLIC" | "MEMBERS" | "MODERATORS";
  members: number;
  moderators: number;
  polls: number;
  createdAt: Date;
  owner: { id: string; username: string; displayName: string } | null;
  threshold: Threshold;
};
type Overview = Row & {
  description: string | null;
  createdBy: { id: string; username: string; displayName: string };
  impact: { members: number; moderators: number; polls: number; activePolls: number; openPolls: number; comments: number; openReports: number };
  recentChanges: { at: Date; action: string; operation: string; reason: string | null; actor: { id: string; username: string; displayName: string } | null }[];
};
type Member = { user: { id: string; username: string; displayName: string; avatarPublicKey: string | null }; role: "MEMBER" | "MODERATOR"; joinedAt: Date };

export interface CommunityAdminReadStore {
  list(filter: { status?: "ACTIVE" | "HIDDEN"; q?: string; after: { createdAt: Date; id: string } | null }, limit: number, now: Date): Promise<Row[]>;
  overview(id: string, now: Date): Promise<Overview | null>;
  /** Topluluk yoksa null; yönetici için görünürlük ayarı uygulanmaz. */
  members(id: string, filter: { q?: string; role?: "MEMBER" | "MODERATOR"; after: { joinedAt: Date; userId: string } | null }, limit: number): Promise<Member[] | null>;
}

const approvedKey = (media: { status: string; publicObjectKey: string | null } | null) => (media?.status === "APPROVED" ? media.publicObjectKey : null);

export function createPrismaCommunityAdminReadStore(prisma: PrismaClient): CommunityAdminReadStore {
  const requestSelect = { id: true, communityId: true, status: true, approvedAt: true, approvalDeadline: true, closedAt: true } as const;

  async function countsFor(ids: string[]) {
    const [roles, polls, requests] = await Promise.all([
      prisma.communityMembership.groupBy({ by: ["communityId", "role"], where: { communityId: { in: ids }, user: { deletedAt: null } }, _count: { _all: true } }),
      prisma.poll.groupBy({ by: ["communityId"], where: { communityId: { in: ids }, status: { not: "REMOVED" } }, _count: { _all: true } }),
      prisma.communityRequest.findMany({ where: { communityId: { in: ids } }, select: requestSelect }),
    ]);
    const members = new Map<string, number>();
    const moderators = new Map<string, number>();
    for (const r of roles) {
      members.set(r.communityId, (members.get(r.communityId) ?? 0) + r._count._all);
      if (r.role === "MODERATOR") moderators.set(r.communityId, r._count._all);
    }
    const pollCount = new Map(polls.map((p) => [p.communityId!, p._count._all]));
    const request = new Map(requests.map((r) => [r.communityId!, r]));
    return { members, moderators, pollCount, request };
  }

  return {
    async list(filter, limit, now) {
      const rows = await prisma.community.findMany({
        // Arama ve cursor ayrı AND kollarıdır: ikisi de OR taşıdığından aynı nesnede birleştirilemez.
        where: {
          ...(filter.status ? { status: filter.status } : {}),
          AND: [
            ...(filter.q ? [{ OR: [{ name: { contains: filter.q, mode: "insensitive" as const } }, { slug: { contains: filter.q, mode: "insensitive" as const } }] }] : []),
            ...(filter.after ? [{ OR: [{ createdAt: { lt: filter.after.createdAt } }, { createdAt: filter.after.createdAt, id: { lt: filter.after.id } }] }] : []),
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        select: { id: true, slug: true, name: true, status: true, membersVisibility: true, createdAt: true, owner: { select: { id: true, username: true, displayName: true } } },
      });
      const counts = await countsFor(rows.map((r) => r.id));
      return rows.map((r) => {
        const members = counts.members.get(r.id) ?? 0;
        const status = r.status === "ACTIVE" ? "ACTIVE" : "HIDDEN";
        return {
          id: r.id,
          slug: r.slug,
          name: r.name,
          status,
          membersVisibility: r.membersVisibility,
          members,
          moderators: counts.moderators.get(r.id) ?? 0,
          polls: counts.pollCount.get(r.id) ?? 0,
          createdAt: r.createdAt,
          owner: r.owner,
          threshold: thresholdOf(counts.request.get(r.id) ?? null, status, members, now),
        } satisfies Row;
      });
    },

    async overview(id, now) {
      const c = await prisma.community.findUnique({
        where: { id },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          status: true,
          membersVisibility: true,
          createdAt: true,
          createdBy: { select: { id: true, username: true, displayName: true } },
          owner: { select: { id: true, username: true, displayName: true } },
        },
      });
      if (!c) return null;
      const counts = await countsFor([id]);
      const members = counts.members.get(id) ?? 0;
      const status = c.status === "ACTIVE" ? "ACTIVE" : "HIDDEN";
      const [activePolls, openPolls, comments, openReports, changes] = await Promise.all([
        prisma.poll.count({ where: { communityId: id, status: "ACTIVE" } }),
        prisma.poll.count({ where: { communityId: id, status: "ACTIVE", kind: "POLL", closedAt: null, closesAt: { gt: now } } }),
        prisma.poll.aggregate({ where: { communityId: id, status: "ACTIVE" }, _sum: { commentCount: true } }),
        prisma.report.count({ where: { status: "OPEN", OR: [{ poll: { communityId: id } }, { comment: { poll: { communityId: id } } }] } }),
        prisma.auditLog.findMany({
          where: { targetType: "COMMUNITY", targetId: id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 10,
          select: { createdAt: true, action: true, operation: true, reason: true, actor: { select: { id: true, username: true, displayName: true } } },
        }),
      ]);
      const polls = counts.pollCount.get(id) ?? 0;
      const moderators = counts.moderators.get(id) ?? 0;
      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        status,
        membersVisibility: c.membersVisibility,
        members,
        moderators,
        polls,
        createdAt: c.createdAt,
        owner: c.owner,
        threshold: thresholdOf(counts.request.get(id) ?? null, status, members, now),
        createdBy: c.createdBy,
        impact: { members, moderators, polls, activePolls, openPolls, comments: comments._sum.commentCount ?? 0, openReports },
        recentChanges: changes.map((a) => ({ at: a.createdAt, action: a.action, operation: a.operation, reason: a.reason, actor: a.actor })),
      };
    },

    async members(id, filter, limit) {
      if ((await prisma.community.count({ where: { id } })) === 0) return null;
      const rows = await prisma.communityMembership.findMany({
        where: {
          communityId: id,
          ...(filter.role ? { role: filter.role } : {}),
          user: {
            deletedAt: null,
            ...(filter.q
              ? { OR: [{ username: { contains: filter.q, mode: "insensitive" } }, { displayName: { contains: filter.q, mode: "insensitive" } }] }
              : {}),
          },
          ...(filter.after
            ? { OR: [{ createdAt: { lt: filter.after.joinedAt } }, { createdAt: filter.after.joinedAt, userId: { gt: filter.after.userId } }] }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { userId: "asc" }],
        take: limit,
        select: {
          role: true,
          createdAt: true,
          user: { select: { id: true, username: true, displayName: true, avatarMedia: { select: { status: true, publicObjectKey: true } } } },
        },
      });
      return rows.map((r) => ({
        role: r.role,
        joinedAt: r.createdAt,
        user: { id: r.user.id, username: r.user.username, displayName: r.user.displayName, avatarPublicKey: approvedKey(r.user.avatarMedia) },
      }));
    },
  };
}

export type CommunityAdminReadDeps = { store: CommunityAdminReadStore; now: () => Date; mediaPublicBaseUrl: string };

const iso = (d: Date | null) => d?.toISOString() ?? null;
const thresholdView = (t: Threshold) => ({ ...t, approvedAt: iso(t.approvedAt), approvalDeadline: iso(t.approvalDeadline), closedAt: iso(t.closedAt) });
const rowView = (r: Row) => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  status: r.status,
  membersVisibility: r.membersVisibility,
  members: r.members,
  moderators: r.moderators,
  polls: r.polls,
  createdAt: r.createdAt.toISOString(),
  owner: r.owner,
  threshold: thresholdView(r.threshold),
});

export function registerCommunityAdminReadRoutes(route: Route, deps: CommunityAdminReadDeps): void {
  const { store, now } = deps;
  const notFound = () => new ApiError("NOT_FOUND", "Topluluk bulunamadı.");

  route("admin.communities.listAll", async ({ query }) => {
    // Cursor süzgece bağlıdır; süzgeç değişince eski cursor 400 INVALID_CURSOR.
    const list = `admin.communities.listAll:${query.status ?? "*"}:${query.q ?? ""}`;
    const at = decodeCursor(query.cursor, list);
    const rows = await store.list(
      { status: query.status, q: query.q, after: at ? { createdAt: new Date(at.keys[0] as string), id: at.id } : null },
      query.limit + 1,
      now(),
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor = rows.length > query.limit && last ? encodeCursor(list, [last.createdAt.toISOString()], last.id) : null;
    return { status: 200, body: { data: page.map(rowView), page: { nextCursor, hasMore: nextCursor !== null } } };
  });

  route("admin.communities.overview", async ({ params }) => {
    const o = await store.overview(params.id, now());
    if (!o) throw notFound();
    return {
      status: 200,
      body: {
        data: {
          ...rowView(o),
          description: o.description,
          createdBy: o.createdBy,
          impact: o.impact,
          recentChanges: o.recentChanges.map((c) => ({ ...c, at: c.at.toISOString() })),
        },
      },
    };
  });

  route("admin.communities.members", async ({ params, query }) => {
    const list = `admin.communities.members:${params.id}:${query.role ?? "*"}:${query.q ?? ""}`;
    const at = decodeCursor(query.cursor, list);
    const rows = await store.members(
      params.id,
      { q: query.q, role: query.role, after: at ? { joinedAt: new Date(at.keys[0] as string), userId: at.id } : null },
      query.limit + 1,
    );
    if (!rows) throw notFound();
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor = rows.length > query.limit && last ? encodeCursor(list, [last.joinedAt.toISOString()], last.user.id) : null;
    const base = deps.mediaPublicBaseUrl;
    return {
      status: 200,
      body: {
        data: page.map((m) => ({
          user: { id: m.user.id, username: m.user.username, displayName: m.user.displayName, avatarUrl: m.user.avatarPublicKey ? `${base}/${m.user.avatarPublicKey}` : null },
          role: m.role,
          joinedAt: m.joinedAt.toISOString(),
        })),
        page: { nextCursor, hasMore: nextCursor !== null },
      },
    };
  });
}

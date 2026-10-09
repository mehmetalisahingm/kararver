// Yönetici anket ve yorum arama listesi (KV-37, #39): admin.content.polls / admin.content.comments.
// Süzme ve sıralama ham SQL'dedir (kv_normalize ile Türkçe harf/büyük-küçük duyarsız arama, keyset sayfalama);
// satır içeriği Prisma ile okunur. Public listelerden farkı: gizli, kilitli ve kaldırılmış içerik dahildir.
import { Prisma, type PrismaClient } from "@kararver/db";
import { likeLiteral } from "../search/prisma-store.ts";
import type { AdminCommentRow, AdminPollRow, CommentListFilter, ContentStatus, PollListFilter, PublicUserRef } from "./store.ts";

type Db = PrismaClient | Prisma.TransactionClient;

const userSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarMedia: { select: { status: true, publicObjectKey: true } },
} as const;

type SelectedUser = { id: string; username: string; displayName: string; avatarMedia: { status: string; publicObjectKey: string | null } | null };

export const publicUserRef = (u: SelectedUser): PublicUserRef => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  avatarPublicKey: u.avatarMedia?.status === "APPROVED" ? u.avatarMedia.publicObjectKey : null,
});
export { userSelect };

/** Moderatör yalnız atandığı toplulukların içeriğini görür; topluluksuz içerik yalnız ADMIN+ listesindedir. */
const scopeSql = (column: Prisma.Sql, scope: PollListFilter["scope"]) =>
  scope.all ? [] : [Prisma.sql`${column} = ANY(${scope.communityIds}::uuid[])`];

const likeOf = (q: string) => Prisma.sql`'%' || kv_normalize(${likeLiteral(q)}) || '%'`;
const whereOf = (conditions: Prisma.Sql[]) => (conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty);

async function openReportCounts(db: Db, column: "pollId" | "commentId", ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const grouped = await db.report.groupBy({ by: [column], where: { [column]: { in: ids }, status: "OPEN" }, _count: { _all: true } });
  return new Map(grouped.map((g) => [g[column] as string, g._count._all]));
}

/** Verilen sırayı koruyarak anket satırlarını yükler (liste ve taşıma sonucu ortak kullanır). */
export async function loadPollRows(db: Db, ids: string[]): Promise<AdminPollRow[]> {
  if (ids.length === 0) return [];
  const [polls, reports] = await Promise.all([
    db.poll.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        publicId: true,
        slug: true,
        kind: true,
        title: true,
        status: true,
        trendExcludedAt: true,
        commentsClosedAt: true,
        firstValidVoteAt: true,
        voteCount: true,
        commentCount: true,
        createdAt: true,
        author: { select: userSelect },
        category: { select: { id: true, slug: true, name: true } },
        community: { select: { id: true, slug: true, name: true } },
      },
    }),
    openReportCounts(db, "pollId", ids),
  ]);
  const byId = new Map(polls.map((p) => [p.id, p]));
  return ids.flatMap((id) => {
    const p = byId.get(id);
    if (!p) return [];
    return [
      {
        id: p.id,
        publicId: p.publicId,
        slug: p.slug,
        kind: p.kind,
        title: p.title,
        status: p.status as ContentStatus,
        trendExcluded: p.trendExcludedAt !== null,
        commentsClosed: p.commentsClosedAt !== null,
        contentLocked: p.firstValidVoteAt !== null,
        author: publicUserRef(p.author),
        category: p.category,
        community: p.community,
        voteCount: p.voteCount,
        commentCount: p.commentCount,
        openReportCount: reports.get(p.id) ?? 0,
        createdAt: p.createdAt,
      },
    ];
  });
}

export async function listPolls(prisma: PrismaClient, filter: PollListFilter, limit: number): Promise<AdminPollRow[]> {
  const c: Prisma.Sql[] = [...scopeSql(Prisma.sql`p.community_id`, filter.scope)];
  if (filter.q) {
    const like = likeOf(filter.q);
    c.push(Prisma.sql`(kv_normalize(p.title) LIKE ${like} ESCAPE '\\' OR kv_normalize(coalesce(p.description, '')) LIKE ${like} ESCAPE '\\')`);
  }
  if (filter.status) c.push(Prisma.sql`p.status::text = ${filter.status}`);
  if (filter.communityId) c.push(Prisma.sql`p.community_id = ${filter.communityId}::uuid`);
  if (filter.categoryId) c.push(Prisma.sql`p.category_id = ${filter.categoryId}::uuid`);
  if (filter.authorId) c.push(Prisma.sql`p.author_id = ${filter.authorId}::uuid`);
  if (filter.reported !== undefined) {
    const open = Prisma.sql`EXISTS (SELECT 1 FROM reports r WHERE r.poll_id = p.id AND r.status = 'OPEN')`;
    c.push(filter.reported ? open : Prisma.sql`NOT ${open}`);
  }
  if (filter.trendExcluded !== undefined) c.push(filter.trendExcluded ? Prisma.sql`p.trend_excluded_at IS NOT NULL` : Prisma.sql`p.trend_excluded_at IS NULL`);
  if (filter.after) c.push(Prisma.sql`(p.created_at, p.id) < (${filter.after.at}::timestamptz, ${filter.after.id}::uuid)`);

  const ids = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT p.id::text AS id FROM polls p ${whereOf(c)} ORDER BY p.created_at DESC, p.id DESC LIMIT ${limit}`);
  return loadPollRows(prisma, ids.map((r) => r.id));
}

export async function listComments(prisma: PrismaClient, filter: CommentListFilter, limit: number): Promise<AdminCommentRow[]> {
  const c: Prisma.Sql[] = [...scopeSql(Prisma.sql`p.community_id`, filter.scope)];
  if (filter.q) c.push(Prisma.sql`kv_normalize(cm.body) LIKE ${likeOf(filter.q)} ESCAPE '\\'`);
  if (filter.status) c.push(Prisma.sql`cm.status::text = ${filter.status}`);
  if (filter.pollId) c.push(Prisma.sql`cm.poll_id = ${filter.pollId}::uuid`);
  if (filter.communityId) c.push(Prisma.sql`p.community_id = ${filter.communityId}::uuid`);
  if (filter.authorId) c.push(Prisma.sql`cm.author_id = ${filter.authorId}::uuid`);
  if (filter.reported !== undefined) {
    const open = Prisma.sql`EXISTS (SELECT 1 FROM reports r WHERE r.comment_id = cm.id AND r.status = 'OPEN')`;
    c.push(filter.reported ? open : Prisma.sql`NOT ${open}`);
  }
  if (filter.after) c.push(Prisma.sql`(cm.created_at, cm.id) < (${filter.after.at}::timestamptz, ${filter.after.id}::uuid)`);

  const found = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT cm.id::text AS id FROM comments cm JOIN polls p ON p.id = cm.poll_id ${whereOf(c)}
    ORDER BY cm.created_at DESC, cm.id DESC LIMIT ${limit}`);
  const ids = found.map((r) => r.id);
  if (ids.length === 0) return [];

  const [comments, reports] = await Promise.all([
    prisma.comment.findMany({
      where: { id: { in: ids } },
      select: { id: true, pollId: true, parentId: true, body: true, status: true, createdAt: true, author: { select: userSelect }, poll: { select: { title: true } } },
    }),
    openReportCounts(prisma, "commentId", ids),
  ]);
  const byId = new Map(comments.map((cm) => [cm.id, cm]));
  return ids.flatMap((id) => {
    const cm = byId.get(id);
    if (!cm) return [];
    return [
      {
        id: cm.id,
        pollId: cm.pollId,
        pollTitle: cm.poll.title,
        parentId: cm.parentId,
        body: cm.body,
        status: cm.status as ContentStatus,
        author: publicUserRef(cm.author),
        openReportCount: reports.get(cm.id) ?? 0,
        createdAt: cm.createdAt,
      },
    ];
  });
}

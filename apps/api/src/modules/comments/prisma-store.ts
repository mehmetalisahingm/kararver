// CommentStore'un PostgreSQL/Prisma uygulaması. Tablolar: comments, comment_reactions, polls.
// Kilit sırası her yerde aynıdır: önce anket satırı, sonra yorum(lar). Böylece yorum ekleme,
// silme ve tepki işlemleri birbirini kilitlemeden (deadlock) sıraya girer.
import type { PrismaClient } from "@kararver/db";
import { runIdempotent } from "../../http/idempotency.ts";
import type { CommentRecord, CommentStore, Outcome, PageRequest, ReactionSummary, ReactionValue } from "./store.ts";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const VISIBLE_POLL = ["ACTIVE", "LOCKED"] as const;

const commentSelect = (viewerId: string | null) =>
  ({
    id: true,
    pollId: true,
    parentId: true,
    kind: true,
    body: true,
    status: true,
    likeCount: true,
    dislikeCount: true,
    replyCount: true,
    editedAt: true,
    createdAt: true,
    author: {
      select: { id: true, username: true, displayName: true, avatarMedia: { select: { status: true, publicObjectKey: true } } },
    },
    reactions: { where: { userId: viewerId ?? undefined }, select: { value: true }, take: viewerId ? 1 : 0 },
  }) as const;

type Selected = {
  id: string;
  pollId: string;
  parentId: string | null;
  kind: CommentRecord["kind"];
  body: string;
  status: CommentRecord["status"];
  likeCount: number;
  dislikeCount: number;
  replyCount: number;
  editedAt: Date | null;
  createdAt: Date;
  author: { id: string; username: string; displayName: string; avatarMedia: { status: string; publicObjectKey: string | null } | null };
  reactions: { value: ReactionValue }[];
};

function toRecord({ author, reactions, ...c }: Selected): CommentRecord {
  const avatar = author.avatarMedia;
  return {
    ...c,
    author: {
      id: author.id,
      username: author.username,
      displayName: author.displayName,
      avatarPublicKey: avatar?.status === "APPROVED" ? avatar.publicObjectKey : null,
    },
    viewerReaction: reactions[0]?.value ?? null,
  };
}

/** Keyset koşulu: `after`'dan sonraki satırlar (sıralama alanları + id eşitlik kırıcı). */
function keyset(fields: { name: "likeCount" | "createdAt"; dir: "asc" | "desc" }[], after: PageRequest["after"]) {
  if (!after) return {};
  const values = after.keys.map((k, i) => (fields[i]!.name === "createdAt" ? new Date(k as string) : Number(k)));
  const cmp = (dir: "asc" | "desc") => (dir === "desc" ? "lt" : "gt");
  const idDir = fields[fields.length - 1]!.dir;
  const or: Record<string, unknown>[] = [];
  for (let i = 0; i <= fields.length; i++) {
    const clause: Record<string, unknown> = {};
    for (let j = 0; j < i; j++) clause[fields[j]!.name] = values[j];
    if (i < fields.length) clause[fields[i]!.name] = { [cmp(fields[i]!.dir)]: values[i] };
    else clause.id = { [cmp(idDir)]: after.id };
    or.push(clause);
  }
  return { OR: or };
}

async function summary(tx: Tx, commentId: string, userId: string): Promise<ReactionSummary> {
  const c = await tx.comment.findUniqueOrThrow({ where: { id: commentId }, select: { likeCount: true, dislikeCount: true } });
  const mine = await tx.commentReaction.findUnique({ where: { commentId_userId: { commentId, userId } }, select: { value: true } });
  return { likes: c.likeCount, dislikes: c.dislikeCount, viewer: mine?.value ?? null };
}

/** Tepki için yorum satırını kilitler; yorum ve anketi görünür değilse null. */
async function lockReactable(tx: Tx, commentId: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT (c.status = 'ACTIVE' AND p.status IN ('ACTIVE', 'LOCKED')) AS ok
    FROM comments c JOIN polls p ON p.id = c.poll_id
    WHERE c.id = ${commentId}::uuid FOR UPDATE OF c`;
  return row?.ok === true;
}

const counter = (value: ReactionValue) => (value === "LIKE" ? "likeCount" : "dislikeCount");

export function createPrismaCommentStore(prisma: PrismaClient): CommentStore {
  const notFound = <T>(reason: Extract<Outcome<T>, { ok: false }>["reason"]): Outcome<T> => ({ ok: false, reason });

  return {
    async isPollVisible(pollId) {
      return (await prisma.poll.count({ where: { id: pollId, status: { in: [...VISIBLE_POLL] } } })) > 0;
    },

    async listTopLevel(pollId, kind, sort, page, viewerId) {
      const fields =
        sort === "top"
          ? ([{ name: "likeCount", dir: "desc" }, { name: "createdAt", dir: "desc" }] as const)
          : ([{ name: "createdAt", dir: "desc" }] as const);
      const rows = await prisma.comment.findMany({
        where: {
          pollId,
          parentId: null,
          kind,
          // Kaldırılmış ama cevabı olan yorum, cevapları bağlamsız kalmasın diye tombstone olarak listelenir.
          OR: [{ status: "ACTIVE" }, { status: "REMOVED", replyCount: { gt: 0 } }],
          ...keyset([...fields], page.after),
        },
        select: commentSelect(viewerId),
        orderBy: [...fields.map((f) => ({ [f.name]: f.dir })), { id: fields[fields.length - 1]!.dir }],
        take: page.limit,
      });
      return rows.map((r) => toRecord(r as Selected));
    },

    async listReplies(parentId, page, viewerId) {
      const parent = await prisma.comment.findUnique({
        where: { id: parentId },
        select: { status: true, parentId: true, poll: { select: { status: true } } },
      });
      const parentVisible = parent && (parent.status === "ACTIVE" || parent.status === "REMOVED");
      if (!parent || !parentVisible || parent.parentId !== null || !VISIBLE_POLL.includes(parent.poll.status as never)) return null;
      const rows = await prisma.comment.findMany({
        where: { parentId, status: "ACTIVE", ...keyset([{ name: "createdAt", dir: "asc" }], page.after) },
        select: commentSelect(viewerId),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: page.limit,
      });
      return rows.map((r) => toRecord(r as Selected));
    },

    createComment: async ({ pollId, authorId, body, kind, parentId }, scope): Promise<Outcome<string>> => {
      const result = await runIdempotent(prisma, scope, 201, async (tx): Promise<Outcome<string>> => {
        const [poll] = await tx.$queryRaw<{ status: string; allow_comments: boolean }[]>`
          SELECT status::text, allow_comments FROM polls WHERE id = ${pollId}::uuid FOR UPDATE`;
        if (!poll || !VISIBLE_POLL.includes(poll.status as never)) return notFound("POLL_NOT_FOUND");
        if (poll.status === "LOCKED") return notFound("CONTENT_LOCKED");
        if (!poll.allow_comments) return notFound("COMMENTS_DISABLED");

        if (parentId) {
          const [parent] = await tx.$queryRaw<{ status: string; parent_id: string | null }[]>`
            SELECT status::text, parent_id::text FROM comments
            WHERE id = ${parentId}::uuid AND poll_id = ${pollId}::uuid FOR UPDATE`;
          if (!parent || parent.status !== "ACTIVE") return notFound("PARENT_NOT_FOUND");
          if (parent.parent_id !== null) return notFound("DEPTH_EXCEEDED");
          await tx.comment.update({ where: { id: parentId }, data: { replyCount: { increment: 1 } } });
        }
        const comment = await tx.comment.create({ data: { pollId, authorId, body, kind, parentId }, select: { id: true } });
        await tx.poll.update({ where: { id: pollId }, data: { commentCount: { increment: 1 } } });
        return { ok: true, value: comment.id };
      });
      if (result.kind === "rejected") return { ok: false, reason: result.reason };
      if (result.kind === "key_reused") return { ok: false, reason: "KEY_REUSED" };
      return { ok: true, value: result.resourceId };
    },

    async findComment(id, viewerId) {
      const row = await prisma.comment.findUnique({ where: { id }, select: commentSelect(viewerId) });
      return row ? toRecord(row as Selected) : null;
    },

    updateComment: (id, authorId, body, now) =>
      prisma.$transaction(async (tx): Promise<Outcome<void>> => {
        const [row] = await tx.$queryRaw<{ author_id: string; status: string; poll_status: string }[]>`
          SELECT c.author_id::text, c.status::text, p.status::text AS poll_status
          FROM comments c JOIN polls p ON p.id = c.poll_id
          WHERE c.id = ${id}::uuid FOR UPDATE OF c`;
        if (!row || row.status !== "ACTIVE" || !VISIBLE_POLL.includes(row.poll_status as never)) return notFound("COMMENT_NOT_FOUND");
        if (row.author_id !== authorId) return notFound("NOT_OWNER");
        if (row.poll_status === "LOCKED") return notFound("CONTENT_LOCKED");
        await tx.comment.update({ where: { id }, data: { body, editedAt: now } });
        return { ok: true, value: undefined };
      }),

    removeComment: (id, authorId, now) =>
      prisma.$transaction(async (tx): Promise<Outcome<void>> => {
        const meta = await tx.comment.findUnique({ where: { id }, select: { pollId: true } });
        if (!meta) return notFound("COMMENT_NOT_FOUND");
        await tx.$queryRaw`SELECT 1 FROM polls WHERE id = ${meta.pollId}::uuid FOR UPDATE`;
        const [row] = await tx.$queryRaw<{ author_id: string; status: string; parent_id: string | null }[]>`
          SELECT author_id::text, status::text, parent_id::text FROM comments WHERE id = ${id}::uuid FOR UPDATE`;
        if (!row || row.status === "HIDDEN" || row.status === "UNDER_REVIEW") return notFound("COMMENT_NOT_FOUND");
        if (row.author_id !== authorId) return row.status === "REMOVED" ? notFound("COMMENT_NOT_FOUND") : notFound("NOT_OWNER");
        if (row.status === "REMOVED") return { ok: true, value: undefined };

        await tx.comment.update({ where: { id }, data: { status: "REMOVED", deletedAt: now } });
        await tx.poll.update({ where: { id: meta.pollId }, data: { commentCount: { decrement: 1 } } });
        if (row.parent_id) await tx.comment.update({ where: { id: row.parent_id }, data: { replyCount: { decrement: 1 } } });
        return { ok: true, value: undefined };
      }),

    setReaction: (commentId, userId, value) =>
      prisma.$transaction(async (tx): Promise<Outcome<ReactionSummary>> => {
        // Yorum satırı kilitli: aynı yoruma aynı kullanıcıdan gelen eşzamanlı istekler sıraya girer,
        // tekrar eden beğeni sayacı çoğaltmaz.
        if (!(await lockReactable(tx, commentId))) return notFound("COMMENT_NOT_FOUND");
        const key = { commentId_userId: { commentId, userId } };
        const existing = await tx.commentReaction.findUnique({ where: key, select: { value: true } });
        if (existing?.value !== value) {
          if (existing) {
            await tx.commentReaction.update({ where: key, data: { value } });
            await tx.comment.update({ where: { id: commentId }, data: { [counter(existing.value)]: { decrement: 1 }, [counter(value)]: { increment: 1 } } });
          } else {
            await tx.commentReaction.create({ data: { commentId, userId, value } });
            await tx.comment.update({ where: { id: commentId }, data: { [counter(value)]: { increment: 1 } } });
          }
        }
        return { ok: true, value: await summary(tx, commentId, userId) };
      }),

    clearReaction: (commentId, userId) =>
      prisma.$transaction(async (tx): Promise<Outcome<ReactionSummary>> => {
        if (!(await lockReactable(tx, commentId))) return notFound("COMMENT_NOT_FOUND");
        const key = { commentId_userId: { commentId, userId } };
        const existing = await tx.commentReaction.findUnique({ where: key, select: { value: true } });
        if (existing) {
          await tx.commentReaction.delete({ where: key });
          await tx.comment.update({ where: { id: commentId }, data: { [counter(existing.value)]: { decrement: 1 } } });
        }
        return { ok: true, value: await summary(tx, commentId, userId) };
      }),
  };
}

// Yorum, cevap, alternatif öneri ve yorum tepkisi endpoint'leri — KV-17 (#19).
// Sözleşme: packages/contracts/src/domains/comments.ts
// Kapsam dışı: domain olayları (comment.created vb., outbox: KV-04 #6 / KV-21 #23), yorum sürüm geçmişi (#66).
import { dbErrorMap } from "@kararver/contracts";
import { ApiError } from "../../http/errors.ts";
import { decodeCursor, encodeCursor } from "../../http/cursor.ts";
import { readIdempotencyScope } from "../../http/idempotency.ts";
import type { Route, RouteContext } from "../../http/route.ts";
import type { CommentKind, CommentRecord, CommentRejection, CommentSort, CommentStore } from "./store.ts";

export type CommentDeps = {
  store: CommentStore;
  now: () => Date;
  mediaPublicBaseUrl: string;
  /** Acil durum anahtarı `features.comments` (KV-40, #42). Ayar servisi gelene kadar açık. */
  commentsEnabled: () => Promise<boolean>;
};

const rejections: Record<CommentRejection, () => ApiError> = {
  POLL_NOT_FOUND: () => new ApiError("NOT_FOUND", "İçerik bulunamadı."),
  COMMENT_NOT_FOUND: () => new ApiError("NOT_FOUND", "Yorum bulunamadı."),
  CONTENT_LOCKED: () => new ApiError("CONTENT_LOCKED", "Bu gönderi moderasyon nedeniyle kilitli."),
  COMMENTS_DISABLED: () => new ApiError("COMMENTS_DISABLED", "Bu gönderide yorumlar kapalı."),
  PARENT_NOT_FOUND: () => new ApiError("VALIDATION_ERROR", "Cevap verilen yorum bulunamadı.", [{ field: "parentId", code: "not_found" }]),
  DEPTH_EXCEEDED: () => new ApiError("COMMENT_DEPTH_EXCEEDED", "Cevaplara cevap verilemez.", [{ field: "parentId", code: "depth" }]),
  NOT_OWNER: () => new ApiError("FORBIDDEN", "Bu işlem sadece yorumun sahibine açık."),
};

/** Ön kontrol atlanırsa DB trigger'ı (KV_COMMENT_DEPTH) yine reddeder; ham 500 yerine sözleşme kodu. */
async function withDbErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    const text = err instanceof Error ? `${err.message} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})}` : "";
    if (text.includes("KV_COMMENT_DEPTH") && dbErrorMap.KV_COMMENT_DEPTH === "COMMENT_DEPTH_EXCEEDED") throw rejections.DEPTH_EXCEEDED();
    throw err;
  }
}

function unwrap<T>(outcome: { ok: true; value: T } | { ok: false; reason: CommentRejection }): T {
  if (!outcome.ok) throw rejections[outcome.reason]();
  return outcome.value;
}

export function toCommentView(c: CommentRecord, viewer: RouteContext["viewer"], mediaBase: string) {
  // Kaldırılmış yorum sadece cevapları bağlamsız kalmasın diye tombstone olarak görünür: metin ve yazar yok.
  const deleted = c.status === "REMOVED";
  return {
    id: c.id,
    pollId: c.pollId,
    parentId: c.parentId,
    kind: c.kind,
    body: deleted ? null : c.body,
    deleted,
    author: deleted
      ? null
      : {
          id: c.author.id,
          username: c.author.username,
          displayName: c.author.displayName,
          avatarUrl: c.author.avatarPublicKey ? `${mediaBase}/${c.author.avatarPublicKey}` : null,
        },
    reactions: { likes: c.likeCount, dislikes: c.dislikeCount, viewer: c.viewerReaction },
    replyCount: c.replyCount,
    editedAt: c.editedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    viewer: viewer ? { canEdit: !deleted && viewer.id === c.author.id, reaction: c.viewerReaction } : null,
  };
}

export function registerCommentRoutes(route: Route, deps: CommentDeps): void {
  const { store, now } = deps;
  const view = (c: CommentRecord, viewer: RouteContext["viewer"]) => toCommentView(c, viewer, deps.mediaPublicBaseUrl);

  /** limit+1 satır okunur; fazlası varsa son görünen satırdan cursor üretilir. */
  function page(rows: CommentRecord[], limit: number, filter: string, keys: (c: CommentRecord) => (string | number)[], viewer: RouteContext["viewer"]) {
    const visible = rows.slice(0, limit);
    const last = visible[visible.length - 1];
    const nextCursor = rows.length > limit && last ? encodeCursor(filter, keys(last), last.id) : null;
    return { data: visible.map((c) => view(c, viewer)), page: { nextCursor, hasMore: nextCursor !== null } };
  }

  route("comments.list", async ({ params, query, viewer }) => {
    const kind = query.kind as CommentKind;
    const sort = query.sort as CommentSort;
    const filter = `comments:${params.id}:${kind}:${sort}`;
    const after = decodeCursor(query.cursor, filter);
    if (!(await store.isPollVisible(params.id))) throw rejections.POLL_NOT_FOUND();
    const rows = await store.listTopLevel(params.id, kind, sort, { after, limit: query.limit + 1 }, viewer?.id ?? null);
    const keys = (c: CommentRecord) => (sort === "top" ? [c.likeCount, c.createdAt.toISOString()] : [c.createdAt.toISOString()]);
    return { status: 200, body: page(rows, query.limit, filter, keys, viewer) };
  });

  route("comments.replies", async ({ params, query, viewer }) => {
    const filter = `replies:${params.id}`;
    const after = decodeCursor(query.cursor, filter);
    const rows = await store.listReplies(params.id, { after, limit: query.limit + 1 }, viewer?.id ?? null);
    if (!rows) throw rejections.COMMENT_NOT_FOUND();
    return { status: 200, body: page(rows, query.limit, filter, (c) => [c.createdAt.toISOString()], viewer) };
  });

  route("comments.create", async ({ params, body, viewer, request }) => {
    const scope = readIdempotencyScope(request, { userId: viewer!.id, route: `comments.create:${params.id}`, body, now: now(), required: false });
    if (!(await deps.commentsEnabled())) throw new ApiError("FEATURE_DISABLED", "Yorumlar şu an kapalı.");
    const id = unwrap(
      await withDbErrors(() =>
        store.createComment({ pollId: params.id, authorId: viewer!.id, body: body.body, kind: body.kind, parentId: body.parentId ?? null }, scope),
      ),
    );
    const comment = (await store.findComment(id, viewer!.id))!;
    return { status: 201, body: { data: view(comment, viewer) } };
  });

  route("comments.update", async ({ params, body, viewer }) => {
    unwrap(await store.updateComment(params.id, viewer!.id, body.body, now()));
    return { status: 200, body: { data: view((await store.findComment(params.id, viewer!.id))!, viewer) } };
  });

  route("comments.delete", async ({ params, viewer }) => {
    unwrap(await store.removeComment(params.id, viewer!.id, now()));
    return { status: 204, body: null };
  });

  route("reactions.comment.put", async ({ params, body, viewer }) => ({
    status: 200,
    body: { data: unwrap(await store.setReaction(params.id, viewer!.id, body.value)) },
  }));

  route("reactions.comment.delete", async ({ params, viewer }) => ({
    status: 200,
    body: { data: unwrap(await store.clearReaction(params.id, viewer!.id)) },
  }));
}

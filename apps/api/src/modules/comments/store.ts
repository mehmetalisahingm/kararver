// Yorum modülünün veri erişim arayüzü — KV-17 (#19). Üretim uygulaması: prisma-store.ts.
// Yorum + sayaçlar (polls.comment_count, comments.reply_count) ve tepki + sayaçlar tek transaction'dadır.
import type { IdempotencyScope } from "../../http/idempotency.ts";

export type CommentKind = "COMMENT" | "ALTERNATIVE";
export type ReactionValue = "LIKE" | "DISLIKE";

export type CommentRecord = {
  id: string;
  pollId: string;
  parentId: string | null;
  kind: CommentKind;
  body: string;
  status: "ACTIVE" | "HIDDEN" | "UNDER_REVIEW" | "LOCKED" | "REMOVED";
  likeCount: number;
  dislikeCount: number;
  replyCount: number;
  editedAt: Date | null;
  createdAt: Date;
  author: { id: string; username: string; displayName: string; avatarPublicKey: string | null };
  /** İzleyicinin bu yorumdaki tepkisi (misafirde null). */
  viewerReaction: ReactionValue | null;
};

/** Keyset sayfalama: sıralama değerleri + id eşitlik kırıcı (http/cursor.ts). */
export type PageRequest = { after: { keys: (string | number)[]; id: string } | null; limit: number };

export type CommentSort = "new" | "top";

export type CommentRejection =
  | "POLL_NOT_FOUND"
  | "COMMENT_NOT_FOUND"
  | "CONTENT_LOCKED"
  | "COMMENTS_DISABLED"
  | "PARENT_NOT_FOUND"
  | "DEPTH_EXCEEDED"
  | "NOT_OWNER";

export type Outcome<T> = { ok: true; value: T } | { ok: false; reason: CommentRejection };

export type ReactionSummary = { likes: number; dislikes: number; viewer: ReactionValue | null };

export interface CommentStore {
  /** Anket herkese görünür mü (ACTIVE/LOCKED)? */
  isPollVisible(pollId: string): Promise<boolean>;
  /** Üst seviye yorumlar. Kaldırılmış ama cevabı olan yorum tombstone olarak listede kalır. */
  listTopLevel(pollId: string, kind: CommentKind, sort: CommentSort, page: PageRequest, viewerId: string | null): Promise<CommentRecord[]>;
  /** Ebeveyn görünmüyorsa null. Cevaplar eskiden yeniye. */
  listReplies(parentId: string, page: PageRequest, viewerId: string | null): Promise<CommentRecord[] | null>;

  /** Idempotency-Key verilmişse (scope) aynı anahtar ve gövdeyle gelen tekrar aynı yorumu döner. */
  createComment(
    input: { pollId: string; authorId: string; body: string; kind: CommentKind; parentId: string | null },
    scope: IdempotencyScope | null,
  ): Promise<Outcome<string>>;
  findComment(id: string, viewerId: string | null): Promise<CommentRecord | null>;
  updateComment(id: string, authorId: string, body: string, now: Date): Promise<Outcome<void>>;
  /** Zaten kaldırılmışsa değişiklik yapmaz (doğal idempotent). */
  removeComment(id: string, authorId: string, now: Date): Promise<Outcome<void>>;

  setReaction(commentId: string, userId: string, value: ReactionValue): Promise<Outcome<ReactionSummary>>;
  clearReaction(commentId: string, userId: string): Promise<Outcome<ReactionSummary>>;
}

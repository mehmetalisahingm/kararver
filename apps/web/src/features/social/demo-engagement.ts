import { UiError } from "../../lib/model.ts";
import type { Poll, User } from "../../lib/model.ts";
import type {
  Comment,
  CommentDraft,
  Engagement,
  Reaction,
  ReactionSummary,
} from "./model.ts";
type StoredComment = Omit<Comment, "canEdit" | "reaction"> & {
  authorId: string;
};
/** In-memory simulator. Ownership and reactions are not production security guarantees. */
export class DemoEngagement {
  private comments = new Map<string, StoredComment[]>();
  private reactions = new Map<string, Map<string, Exclude<Reaction, null>>>();
  private requests = new Map<string, { fingerprint: string; id: string }>();
  private rows(poll: Poll) {
    if (!this.comments.has(poll.id))
      this.comments.set(
        poll.id,
        poll.comments.map((c) => ({
          ...c,
          authorId: "seed-" + c.author,
          kind: "comment",
          parentId: null,
          createdAt: "2026-09-27T09:00:00Z",
          edited: false,
          deleted: false,
        })),
      );
    return this.comments.get(poll.id)!;
  }
  private key(poll: Poll, id: string | null) {
    return JSON.stringify([poll.id, id]);
  }
  private summary(
    poll: Poll,
    id: string | null,
    user: User | null,
  ): ReactionSummary {
    const votes = this.reactions.get(this.key(poll, id));
    return {
      likes: [...(votes?.values() || [])].filter((v) => v === "like").length,
      dislikes: [...(votes?.values() || [])].filter((v) => v === "dislike")
        .length,
      own: user ? votes?.get(user.id) || null : null,
    };
  }
  snapshot(poll: Poll, user: User | null): Engagement {
    return {
      reaction: this.summary(poll, null, user),
      comments: this.rows(poll).map(({ authorId, ...c }) => ({
        ...c,
        canEdit: Boolean(
          user &&
          user.id === authorId &&
          !c.deleted &&
          poll.status !== "LOCKED",
        ),
        reaction: this.summary(poll, c.id, user),
      })),
    };
  }
  count(pollId: string, fallback: number) {
    return this.comments.has(pollId)
      ? this.comments.get(pollId)!.filter((c) => !c.deleted).length
      : fallback;
  }
  private writable(poll: Poll) {
    if (poll.status === "LOCKED")
      throw new UiError(
        "CONTENT_LOCKED",
        "Kilitli içerikte etkileşim yapılamaz.",
      );
  }
  private find(poll: Poll, id: string) {
    const c = this.rows(poll).find((c) => c.id === id);
    if (!c || c.deleted)
      throw new UiError("NOT_FOUND", "Yorum silinmiş veya bulunamadı.");
    return c;
  }
  private text(value: string) {
    const text = value.trim();
    if (!text || text.length > 2000)
      throw new UiError(
        "VALIDATION_ERROR",
        "Yorum 1–2.000 karakter arasında olmalı.",
      );
    return text;
  }
  react(poll: Poll, user: User, id: string | null, value: Reaction) {
    this.writable(poll);
    if (id) this.find(poll, id);
    if (value !== null && value !== "like" && value !== "dislike")
      throw new UiError("VALIDATION_ERROR", "Geçersiz tepki.");
    const key = this.key(poll, id);
    const reactions = this.reactions.get(key) || new Map();
    if (value === null) reactions.delete(user.id);
    else reactions.set(user.id, value);
    this.reactions.set(key, reactions);
    return this.snapshot(poll, user);
  }
  add(poll: Poll, user: User, draft: CommentDraft, requestId: string) {
    this.writable(poll);
    if (!poll.commentsEnabled)
      throw new UiError("COMMENTS_DISABLED", "Bu içerikte yorumlar kapalı.");
    const text = this.text(draft.text);
    if (draft.kind !== "comment" && draft.kind !== "alternative")
      throw new UiError("VALIDATION_ERROR", "Geçersiz yorum türü.");
    if (!requestId)
      throw new UiError("VALIDATION_ERROR", "İstek kimliği gerekli.");
    if (draft.parentId) {
      const parent = this.find(poll, draft.parentId);
      if (parent.parentId)
        throw new UiError(
          "COMMENT_DEPTH_EXCEEDED",
          "Yalnızca ana yoruma tek seviye cevap verilebilir.",
        );
      if (draft.kind === "alternative")
        throw new UiError(
          "VALIDATION_ERROR",
          "Alternatif öneri yalnızca ana yorum olabilir.",
        );
    }
    const key = JSON.stringify([user.id, poll.id, requestId]);
    const fingerprint = JSON.stringify({ ...draft, text });
    const previous = this.requests.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new UiError("CONFLICT", "İstek kimliği farklı bir yoruma ait.");
      return this.snapshot(poll, user);
    }
    const id = crypto.randomUUID();
    this.rows(poll).push({
      id,
      authorId: user.id,
      author: user.name,
      text,
      kind: draft.kind,
      parentId: draft.parentId,
      createdAt: new Date().toISOString(),
      edited: false,
      deleted: false,
    });
    this.requests.set(key, { fingerprint, id });
    return this.snapshot(poll, user);
  }
  edit(poll: Poll, user: User, id: string, value: string) {
    this.writable(poll);
    const c = this.find(poll, id);
    if (c.authorId !== user.id)
      throw new UiError(
        "FORBIDDEN",
        "Yalnızca kendi yorumunu düzenleyebilirsin.",
      );
    c.text = this.text(value);
    c.edited = true;
    return this.snapshot(poll, user);
  }
  delete(poll: Poll, user: User, id: string) {
    this.writable(poll);
    const c = this.find(poll, id);
    if (c.authorId !== user.id)
      throw new UiError("FORBIDDEN", "Yalnızca kendi yorumunu silebilirsin.");
    c.deleted = true;
    c.text = "";
    c.author = "";
    c.authorId = "";
    this.reactions.delete(this.key(poll, id));
    return this.snapshot(poll, user);
  }
}

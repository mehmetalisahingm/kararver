// İçerik moderasyonu veri erişim arayüzü — KV-37 (#39). Üretim uygulaması: prisma-store.ts.
// Durum geçişleri docs/DATA_MODEL.md §7.1; sayaç kuralı docs/KV-17_COMMENTS.md (polls.comment_count yalnız ACTIVE yorum + cevap).
import type { ModerationScope } from "../rbac/access.ts";

export type ContentKind = "polls" | "comments";
export type ContentStatus = "ACTIVE" | "UNDER_REVIEW" | "HIDDEN" | "LOCKED" | "REMOVED";
export type StatusAction = "HIDE" | "RESTORE" | "LOCK" | "UNLOCK" | "REMOVE";
export type TrendAction = "EXCLUDE_FROM_TRENDS" | "INCLUDE_IN_TRENDS";
/** Yalnız yorumları kapat/aç (polls.comments_closed_at): LOCK'tan ayrıdır, oy açık kalır. */
export type CommentsAction = "CLOSE_COMMENTS" | "OPEN_COMMENTS";
export type ModerationActionName = StatusAction | TrendAction | CommentsAction;

/** Yetki kararı için okunan kayıt: topluluk DB'den gelir, istekten değil (KV-04 §4.2). */
export type ModerationTarget = { id: string; status: ContentStatus; communityId: string | null };

export type ModerationOutcome = { id: string; status: ContentStatus; trendExcluded: boolean | null; commentsClosed: boolean | null };

export type ApplyInput = {
  kind: ContentKind;
  id: string;
  actorId: string;
  action: ModerationActionName;
  reason: string;
  now: Date;
  /** X-Request-Id: audit kaydına yazılır. */
  requestId: string | null;
  /** ADMIN+ mu: kaldırılmış içeriği yalnız yönetici geri yükler (DATA_MODEL §7.1). */
  actorIsAdmin: boolean;
  /** Yetkilendirmede kullanılan topluluk; satır kilidi altında yeniden okunur, taşınmışsa 409 (kategori/topluluk taşıma yarışı). */
  communityId: string | null;
};

export type ApplyResult =
  | { kind: "applied" | "unchanged"; outcome: ModerationOutcome }
  | { kind: "conflict"; reason: "invalid_transition" | "unsupported_action" | "removed" | "community_changed" }
  | { kind: "forbidden"; reason: "admin_required" }
  | { kind: "not_found" };

export type PublicUserRef = { id: string; username: string; displayName: string; avatarPublicKey: string | null };

/** Yönetici listesi satırları (KV-37). Listeler gizli ve kaldırılmış içeriği de döner. */
export type AdminPollRow = {
  id: string;
  publicId: string;
  slug: string;
  kind: "POLL" | "DISCUSSION";
  title: string;
  status: ContentStatus;
  trendExcluded: boolean;
  commentsClosed: boolean;
  contentLocked: boolean;
  author: PublicUserRef;
  category: { id: string; slug: string; name: string };
  community: { id: string; slug: string; name: string } | null;
  voteCount: number;
  commentCount: number;
  openReportCount: number;
  createdAt: Date;
};

export type AdminCommentRow = {
  id: string;
  pollId: string;
  pollTitle: string;
  parentId: string | null;
  body: string;
  status: ContentStatus;
  author: PublicUserRef;
  openReportCount: number;
  createdAt: Date;
};

/** En yeni önce; keyset (created_at, id). */
export type ListAfter = { at: Date; id: string } | null;

export type PollListFilter = {
  q?: string;
  status?: ContentStatus;
  communityId?: string;
  categoryId?: string;
  authorId?: string;
  reported?: boolean;
  trendExcluded?: boolean;
  scope: ModerationScope;
  after: ListAfter;
};

export type CommentListFilter = {
  q?: string;
  status?: ContentStatus;
  pollId?: string;
  communityId?: string;
  authorId?: string;
  reported?: boolean;
  scope: ModerationScope;
  after: ListAfter;
};

export type HistoryRow =
  | {
      kind: "REPORT";
      id: string;
      at: Date;
      reason: string;
      note: string | null;
      status: "OPEN" | "ACTIONED" | "DISMISSED";
      resolvedAt: Date | null;
      resolvedBy: PublicUserRef | null;
      resolutionNote: string | null;
    }
  | {
      kind: "ACTION";
      id: string;
      at: Date;
      action: string;
      actor: PublicUserRef;
      fromStatus: string | null;
      toStatus: string | null;
      reason: string;
      reportId: string | null;
    };

export type MoveInput = {
  id: string;
  actorId: string;
  /** Yetkilendirilen kaynak topluluk; satır kilidi altında doğrulanır. */
  communityId: string | null;
  categoryId?: string;
  /** undefined: değişmez; null: topluluktan çıkar. */
  toCommunityId?: string | null;
  reason: string;
  now: Date;
  requestId: string | null;
};

export type MoveResult =
  | { kind: "moved" | "unchanged"; item: AdminPollRow }
  | { kind: "conflict"; reason: "removed" | "community_changed" }
  | { kind: "invalid"; field: "categoryId" | "communityId"; code: "unknown_category" | "unknown_community" }
  | { kind: "not_found" };

/** Rapor kuyruğundan uyarı için okunan kayıt: hedefin sahibi ve rolleri yetki kararında kullanılır. */
export type WarnTarget = {
  reportId: string;
  status: "OPEN" | "ACTIONED" | "DISMISSED";
  communityId: string | null;
  userId: string | null;
  roles: ("USER" | "MODERATOR" | "ADMIN" | "SUPER_ADMIN")[];
};

export type WarnInput = { reportId: string; actorId: string; reason: string; now: Date; requestId: string | null };
export type WarnResult =
  | { kind: "warned"; sanctionId: string; userId: string; closedReports: number }
  | { kind: "conflict"; reason: "no_target_user" | "already_resolved" }
  | { kind: "not_found" };

export interface ModerationStore {
  findTarget(kind: ContentKind, id: string): Promise<ModerationTarget | null>;
  /** Kilitli okuma + durum geçişi + sayaçlar + moderation_actions aynı transaction'da. */
  apply(input: ApplyInput): Promise<ApplyResult>;
  listPolls(filter: PollListFilter, limit: number): Promise<AdminPollRow[]>;
  listComments(filter: CommentListFilter, limit: number): Promise<AdminCommentRow[]>;
  /** Raporlar + moderasyon işlemleri tek çizgide, `at` azalan. */
  history(kind: ContentKind, id: string, after: ListAfter, limit: number): Promise<HistoryRow[]>;
  /** Kategori ve/veya topluluk değiştirme: kilitli okuma + doğrulama + moderation_actions + audit tek transaction'da. */
  movePoll(input: MoveInput): Promise<MoveResult>;
  findWarnTarget(reportId: string): Promise<WarnTarget | null>;
  warnReportTarget(input: WarnInput): Promise<WarnResult>;
}

const TARGET: Record<StatusAction, ContentStatus> = { HIDE: "HIDDEN", RESTORE: "ACTIVE", LOCK: "LOCKED", UNLOCK: "ACTIVE", REMOVE: "REMOVED" };
const SOURCES: Record<StatusAction, readonly ContentStatus[]> = {
  HIDE: ["ACTIVE"],
  LOCK: ["ACTIVE"],
  UNLOCK: ["LOCKED"],
  RESTORE: ["HIDDEN", "UNDER_REVIEW", "LOCKED", "REMOVED"],
  REMOVE: ["ACTIVE", "UNDER_REVIEW", "HIDDEN", "LOCKED"],
};

/** Hedef durum zaten bu ise "same" (idempotent), geçiş tanımlıysa yeni durum, değilse "invalid". */
export function statusTransition(current: ContentStatus, action: StatusAction): ContentStatus | "same" | "invalid" {
  const target = TARGET[action];
  if (current === target) return "same";
  return SOURCES[action].includes(current) ? target : "invalid";
}

/** Sayaçlara yalnız ACTIVE yorum girer; geçiş bu kümeye girip çıkıyorsa sayaç ±1 oynar. */
export const counterDelta = (from: ContentStatus, to: ContentStatus): -1 | 0 | 1 =>
  (from === "ACTIVE" ? 1 : 0) === (to === "ACTIVE" ? 1 : 0) ? 0 : to === "ACTIVE" ? 1 : -1;

/** Yayını kısıtlayan işlemler hedefin açık raporlarını karşılanmış sayar. */
export const closesReports = (action: ModerationActionName) => action === "HIDE" || action === "REMOVE" || action === "LOCK";

// İçerik moderasyonu veri erişim arayüzü — KV-37 (#39). Üretim uygulaması: prisma-store.ts.
// Durum geçişleri docs/DATA_MODEL.md §7.1; sayaç kuralı docs/KV-17_COMMENTS.md (polls.comment_count yalnız ACTIVE yorum + cevap).

export type ContentKind = "polls" | "comments";
export type ContentStatus = "ACTIVE" | "UNDER_REVIEW" | "HIDDEN" | "LOCKED" | "REMOVED";
export type StatusAction = "HIDE" | "RESTORE" | "LOCK" | "UNLOCK" | "REMOVE";
export type TrendAction = "EXCLUDE_FROM_TRENDS" | "INCLUDE_IN_TRENDS";
export type ModerationActionName = StatusAction | TrendAction;

/** Yetki kararı için okunan kayıt: topluluk DB'den gelir, istekten değil (KV-04 §4.2). */
export type ModerationTarget = { id: string; status: ContentStatus; communityId: string | null };

export type ModerationOutcome = { id: string; status: ContentStatus; trendExcluded: boolean | null };

export type ApplyInput = {
  kind: ContentKind;
  id: string;
  actorId: string;
  action: ModerationActionName;
  reason: string;
  now: Date;
  /** ADMIN+ mu: kaldırılmış içeriği yalnız yönetici geri yükler (DATA_MODEL §7.1). */
  actorIsAdmin: boolean;
};

export type ApplyResult =
  | { kind: "applied" | "unchanged"; outcome: ModerationOutcome }
  | { kind: "conflict"; reason: "invalid_transition" | "unsupported_action" | "removed" }
  | { kind: "forbidden"; reason: "admin_required" }
  | { kind: "not_found" };

export interface ModerationStore {
  findTarget(kind: ContentKind, id: string): Promise<ModerationTarget | null>;
  /** Kilitli okuma + durum geçişi + sayaçlar + moderation_actions aynı transaction'da. */
  apply(input: ApplyInput): Promise<ApplyResult>;
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

// Yönetici içerik ekranının saf kuralları (KV-37): hangi işlem hangi durumda sunulur, etiketler, taşıma farkı.
// Sunucu geçişleri zaten doğrular (409); buradaki liste yalnız geçersiz seçenekleri göstermemek içindir.
import type { AdminComment, AdminPoll, ContentKind, ContentStatus, ModerationAction, PollPlacement } from "./admin-client.ts";

export const statusLabels: Record<ContentStatus, string> = {
  ACTIVE: "Yayında",
  HIDDEN: "Gizli",
  LOCKED: "Kilitli",
  REMOVED: "Kaldırıldı",
  UNDER_REVIEW: "İncelemede",
};

export const actionLabels: Record<ModerationAction, string> = {
  HIDE: "Gizle",
  RESTORE: "Geri yükle",
  LOCK: "Kilitle (oy ve yorum kapanır)",
  UNLOCK: "Kilidi aç",
  REMOVE: "Kaldır",
  EXCLUDE_FROM_TRENDS: "Trendden çıkar",
  INCLUDE_IN_TRENDS: "Trende geri al",
  CLOSE_COMMENTS: "Yorumları kapat (oy açık kalır)",
  OPEN_COMMENTS: "Yorumları aç",
};

/**
 * Satırın şimdiki durumuna göre sunulacak işlemler. Kaldırılmış içeriği yalnız yönetici geri yükler (DATA_MODEL §7.1);
 * trend ve yorum kapatma anketin görünürlüğünü değiştirmez, kaldırılmış ankette sunulmaz.
 */
export function availableActions(kind: ContentKind, item: Pick<AdminPoll, "status" | "trendExcluded" | "commentsClosed"> | Pick<AdminComment, "status">, isAdmin: boolean): ModerationAction[] {
  const out: ModerationAction[] = [];
  const status = item.status as ContentStatus;
  if (status === "ACTIVE") out.push("HIDE");
  if (kind === "polls" && status === "ACTIVE") out.push("LOCK");
  if (kind === "polls" && status === "LOCKED") out.push("UNLOCK");
  if (status === "HIDDEN" || status === "UNDER_REVIEW" || status === "LOCKED") out.push("RESTORE");
  if (status === "REMOVED" && isAdmin) out.push("RESTORE");
  if (status !== "REMOVED") out.push("REMOVE");
  if (kind === "polls" && status !== "REMOVED") {
    const poll = item as Pick<AdminPoll, "trendExcluded" | "commentsClosed">;
    out.push(poll.trendExcluded ? "INCLUDE_IN_TRENDS" : "EXCLUDE_FROM_TRENDS");
    out.push(poll.commentsClosed ? "OPEN_COMMENTS" : "CLOSE_COMMENTS");
  }
  return out;
}

/** Taşıma isteği yalnız değişen alanları taşır; hiçbiri değişmediyse null (gönderilecek bir şey yok). */
export function placementDiff(
  current: { categoryId: string; communityId: string | null },
  next: { categoryId: string; communityId: string | null },
): PollPlacement | null {
  const diff: PollPlacement = {};
  if (next.categoryId !== current.categoryId) diff.categoryId = next.categoryId;
  if (next.communityId !== current.communityId) diff.communityId = next.communityId;
  return Object.keys(diff).length > 0 ? diff : null;
}

export const historyActionLabels: Record<string, string> = {
  ...actionLabels,
  APPROVE: "Görseli onayladı",
  REJECT: "Görseli reddetti",
  MOVE: "Kategori / topluluk taşıdı",
  WARN_USER: "İçerik sahibini uyardı",
  SANCTION_USER: "İçerik sahibine yaptırım uyguladı",
  DISMISS_REPORT: "Raporu reddetti",
};

export const reportStatusLabels = { OPEN: "Açık", ACTIONED: "İşlem yapıldı", DISMISSED: "Reddedildi" } as const;

/** Askı süresi (gün) → bitiş anı. */
export const suspendUntil = (days: number, now: Date = new Date()) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

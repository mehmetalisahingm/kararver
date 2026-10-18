// Spam uyarı puanı, gölge mod (#183 / KV-37 S1; karar listesi: docs/KV-37_SPAM_SCORE_DECISIONS.md karar 1-3).
// Kural tabanlı ve açıklanabilir: sinyaller sayaçtır, puan sinyallerin ağırlıklı toplamıdır (0-100). IP, cihaz ve metin kullanılmaz.
// Puanın kullanıcıya hiçbir etkisi yoktur; yalnız yöneticilere görünür (karar 3, 4, 14). Ağırlıklar ve eşikler karar 1'e göre
// ayara taşınacaktır; o zamana kadar kodda sabittir ve bu dosyadadır.
import type { SpamSignals } from "@kararver/contracts";

export type { SpamSignals };

export const SPAM_WINDOW_DAYS = 30;
export const SPAM_YOUNG_ACCOUNT_DAYS = 7;
export const SPAM_YOUNG_BURST_MIN_CONTENT = 10;
export const SPAM_COMMENT_BURST_FREE = 10;
/** Bu puanın altındaki hesaplar saklanmaz (veri minimizasyonu). */
export const SPAM_MIN_STORED_SCORE = 10;

export const SPAM_WEIGHTS = Object.freeze({
  duplicatePost: 15,
  commentOverFree: 2,
  youngBurst: 20,
  actionedReport: 20,
  hiddenContent: 15,
});

const clampCount = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export function scoreSpam(signals: SpamSignals): number {
  const points =
    SPAM_WEIGHTS.duplicatePost * clampCount(signals.duplicatePosts) +
    SPAM_WEIGHTS.commentOverFree * Math.max(0, clampCount(signals.comments24h) - SPAM_COMMENT_BURST_FREE) +
    SPAM_WEIGHTS.youngBurst * (signals.youngBurst ? 1 : 0) +
    SPAM_WEIGHTS.actionedReport * clampCount(signals.actionedReports) +
    SPAM_WEIGHTS.hiddenContent * clampCount(signals.hiddenContent);
  return Math.min(100, points);
}

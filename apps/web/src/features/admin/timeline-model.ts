// Kullanıcı birleşik geçmişi ekranının saf kuralları (#183, KV-33 §13): etiketler, süzgeç → sorgu ve satır metni.
// Salt okuma; IP/cihaz bilgisi API'de yoktur ve burada da gösterilmez.
import type { UserTimelineItemView } from "./admin-client.ts";

export type TimelineKind = UserTimelineItemView["kind"];
export const TIMELINE_KINDS: readonly TimelineKind[] = ["POLL", "COMMENT", "MEDIA", "REPORT_FILED", "REPORT_AGAINST", "MODERATION", "MODERATION_BY", "SANCTION"];

export const kindLabels: Record<TimelineKind, string> = {
  POLL: "Anket",
  COMMENT: "Yorum",
  MEDIA: "Görsel",
  REPORT_FILED: "Yaptığı rapor",
  REPORT_AGAINST: "Hakkında rapor",
  MODERATION: "Moderasyon kararı",
  MODERATION_BY: "Verdiği karar",
  SANCTION: "Yaptırım",
};

export type TimelineFilter = { kinds: ReadonlySet<TimelineKind>; communityId: string; contentId: string; from: string; to: string };
export const emptyFilter = (): TimelineFilter => ({ kinds: new Set(), communityId: "", contentId: "", from: "", to: "" });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Süzgeci API sorgusuna çevirir; boş/geçersiz alanlar gönderilmez. Tüm türler seçiliyse tür süzgeci yok sayılır. */
export function toQuery(filter: TimelineFilter): Record<string, string> {
  const q: Record<string, string> = {};
  const kinds = TIMELINE_KINDS.filter((k) => filter.kinds.has(k));
  if (kinds.length > 0 && kinds.length < TIMELINE_KINDS.length) q.kinds = kinds.join(",");
  if (UUID.test(filter.communityId)) q.communityId = filter.communityId;
  if (UUID.test(filter.contentId.trim())) q.contentId = filter.contentId.trim();
  if (filter.from) q.from = new Date(`${filter.from}T00:00:00`).toISOString();
  // "Bitiş" gün sonunu kapsar: API üst sınırı hariç tuttuğundan ertesi günün başlangıcı gönderilir.
  if (filter.to) {
    const end = new Date(`${filter.to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    q.to = end.toISOString();
  }
  return q;
}

/** Kullanıcıya yazılan geçersiz kimlik uyarısı (sunucuya gitmeden). */
export const contentIdProblem = (value: string): string | null => (value.trim() === "" || UUID.test(value.trim()) ? null : "İçerik kimliği geçerli bir UUID olmalı.");

const reasonLabels: Record<string, string> = { SPAM: "Spam", INAPPROPRIATE: "Uygunsuz", HARASSMENT: "Taciz", HATE: "Nefret", PERSONAL_INFO: "Kişisel bilgi", MISLEADING: "Yanıltıcı", COPYRIGHT: "Telif", OTHER: "Diğer" };

/** Satırın özet metni: başlık, neden/işlem, durum, gerekçe ve işlemi yapan. */
export function describeItem(item: UserTimelineItemView): string {
  const parts: string[] = [];
  if (item.title) parts.push(item.title);
  if (item.detail) parts.push(item.kind.startsWith("REPORT") ? (reasonLabels[item.detail] ?? item.detail) : item.detail);
  if (item.status) parts.push(item.status);
  if (item.reason) parts.push(`Gerekçe: ${item.reason}`);
  if (item.actor) parts.push(`@${item.actor.username}`);
  return parts.join(" · ");
}

export function summaryChips(counts: Record<TimelineKind, number>): Array<{ kind: TimelineKind; label: string; count: number }> {
  return TIMELINE_KINDS.filter((k) => counts[k] > 0).map((kind) => ({ kind, label: kindLabels[kind], count: counts[kind] }));
}

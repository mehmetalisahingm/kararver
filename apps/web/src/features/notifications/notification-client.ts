// Bildirim merkezi istemcisi — KV-35 (#37). Okuma API'si KV-21'den gelir; tercih/sessiz API'leri
// kullanıma açıldığında aynı ekran ek değişiklik olmadan onları da kullanır.
import { NotificationPreferences, NotificationView, pageOf } from "@kararver/contracts";
import type { NotificationType } from "@kararver/contracts";
import type { HttpClient } from "../../lib/http-client.ts";

export type NotificationItem = ReturnType<typeof NotificationView.parse>;
export type NotificationPage = { items: NotificationItem[]; next: string | null };

export const notificationTypeLabels: Record<NotificationType, string> = {
  COMMENT_ON_POLL: "Anketime yorum",
  REPLY_TO_COMMENT: "Yorumuma cevap",
  ALTERNATIVE_ON_POLL: "Alternatif öneri",
  POLL_MILESTONE: "Oy kilometre taşı",
  POLL_TRENDING: "Trend bildirimi",
  POLL_CLOSED: "Anket kapanışı",
  DECISION_UPDATED: "Karar güncellemesi",
  MODERATION_APPLIED: "Moderasyon",
  COMMUNITY_FEATURED: "Toplulukta öne çıkarma",
  SANCTION_APPLIED: "Hesap bildirimi",
};

export const optionalPreferenceTypes = (Object.keys(notificationTypeLabels) as NotificationType[]).filter(
  (type) => type !== "MODERATION_APPLIED" && type !== "SANCTION_APPLIED",
);

export function pollIdOf(notification: NotificationItem): string | null {
  if (notification.subject.type === "POLL") return notification.subject.id;
  const value = notification.data.pollId;
  return typeof value === "string" ? value : null;
}

export function notificationHref(notification: NotificationItem): string {
  const pollId = pollIdOf(notification);
  if (notification.subject.type === "COMMENT" && pollId) return `/karar/${pollId}#yorum-${notification.subject.id}`;
  if (pollId) return `/karar/${pollId}`;
  if (notification.subject.type === "USER") return "/hesap";
  if (notification.subject.type === "COMMUNITY") return "/topluluklar";
  return "/";
}

export function notificationCopy(notification: NotificationItem): { title: string; detail: string } {
  const actor = notification.actor?.displayName ?? "Bir kullanıcı";
  switch (notification.type) {
    case "COMMENT_ON_POLL":
      return { title: `${actor} anketine yorum yaptı.`, detail: "Yorumu görmek için aç." };
    case "REPLY_TO_COMMENT":
      return { title: `${actor} yorumuna cevap verdi.`, detail: "Cevabın olduğu tartışmaya dön." };
    case "ALTERNATIVE_ON_POLL":
      return { title: `${actor} anketine alternatif önerdi.`, detail: "Öneriyi incelemek için aç." };
    case "POLL_MILESTONE":
      return { title: `Anketin ${Number(notification.data.milestone ?? 0).toLocaleString("tr-TR")} oya ulaştı.`, detail: "Yeni sonuçları görüntüle." };
    case "POLL_TRENDING":
      return { title: `Anketin trendlerde #${notification.data.rank ?? "–"} oldu.`, detail: "Trend hareketini ve sonuçları gör." };
    case "POLL_CLOSED":
      return { title: "Takip ettiğin anket kapandı.", detail: "Nihai sonuçları görüntüle." };
    case "DECISION_UPDATED":
      return { title: `${actor} kararını ${notification.data.first ? "paylaştı" : "güncelledi"}.`, detail: "Kararı ve güncel sonucu gör." };
    case "MODERATION_APPLIED":
      return { title: "İçeriğine moderasyon işlemi uygulandı.", detail: "İçeriğin güncel durumunu görüntüle." };
    case "COMMUNITY_FEATURED":
      return { title: "Anketin bir toplulukta öne çıkarıldı.", detail: "İçeriği görüntüle." };
    case "SANCTION_APPLIED":
      return { title: "Hesabınla ilgili yeni bir bildirim var.", detail: "Hesap durumunu görüntüle." };
    default:
      return { title: "Yeni bir bildirimin var.", detail: "Ayrıntıları görüntüle." };
  }
}

export class NotificationClient {
  constructor(private readonly http: HttpClient) {}

  async list(unreadOnly = false, cursor?: string, signal?: AbortSignal): Promise<NotificationPage> {
    const parsed = pageOf(NotificationView).parse(
      await this.http.request("notifications.list", {
        query: { unreadOnly: String(unreadOnly), cursor, limit: "20" },
        signal,
      }),
    );
    return { items: parsed.data, next: parsed.page.nextCursor };
  }

  async unreadCount(): Promise<number> {
    return (await this.http.request("notifications.unreadCount") as { data: { count: number } }).data.count;
  }

  async markRead(target: { ids: string[] } | { all: true }): Promise<number> {
    return (await this.http.request("notifications.markRead", { body: target }) as { data: { updated: number } }).data.updated;
  }

  async preferences(): Promise<ReturnType<typeof NotificationPreferences.parse>> {
    return NotificationPreferences.parse(
      (await this.http.request("notifications.preferences.get") as { data: unknown }).data,
    );
  }

  async updatePreferences(types: Partial<Record<NotificationType, boolean>>) {
    return NotificationPreferences.parse(
      (await this.http.request("notifications.preferences.update", { body: { types } }) as { data: unknown }).data,
    );
  }

  async setPollMuted(pollId: string, muted: boolean): Promise<boolean> {
    const response = await this.http.request(muted ? "notifications.mutes.put" : "notifications.mutes.delete", { params: { pollId } }) as { data: { muted: boolean } };
    return response.data.muted;
  }
}

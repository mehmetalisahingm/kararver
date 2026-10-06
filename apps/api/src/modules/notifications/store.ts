// Bildirim okuma/okundu store'u — KV-21 (#23). Satırları teslim job'u yazar (worker, KV-21 PR-3); API yalnız
// alıcının kendi satırlarını okur ve read_at'i doldurur. Her işlem recipientId ile sınırlıdır: başka kullanıcının
// bildirimi listede, sayımda ve okundu işaretinde hiç görünmez (docs/KV-21_NOTIFICATIONS.md §3).
import type { NotificationType } from "@kararver/contracts";
import type { z } from "zod";

export type NotificationRecord = {
  id: string;
  type: z.infer<typeof NotificationType>;
  subject: { type: "POLL" | "COMMENT" | "COMMUNITY" | "USER"; id: string };
  /** Yorum bildirimini doğru ankete döndürmek ve anket sessizini uygulamak için; DB'de zaten tutulur. */
  pollId: string | null;
  /** Silinmiş aktör veya sistem bildirimi: null. */
  actor: { id: string; username: string; displayName: string; avatarPublicKey: string | null } | null;
  data: Record<string, string | number | boolean | null>;
  readAt: Date | null;
  createdAt: Date;
};

/** Liste sırası created_at ↓, id ↓; cursor son görünen satırın ikilisidir. */
export type NotificationPage = { unreadOnly: boolean; after: { createdAt: Date; id: string } | null; limit: number };

export type MarkReadTarget = { ids: string[] } | { all: true };

export interface NotificationStore {
  list(recipientId: string, page: NotificationPage): Promise<NotificationRecord[]>;
  unreadCount(recipientId: string): Promise<number>;
  /** Yalnız alıcının okunmamış satırları işaretlenir; dönen sayı yeni okunanlardır (tekrar çağrı 0). */
  markRead(recipientId: string, target: MarkReadTarget, now: Date): Promise<number>;
}

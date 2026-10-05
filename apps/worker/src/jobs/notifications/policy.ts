// Bildirim politikası kancası — KV-21 PR-3 (#23); tercih ve sessize alma KV-34 (#36).
// Tüketici her alıcı diliminde politikayı çağırır; politika yazılmayacak alıcıları düşürür. Bugün herkese izin verir.
// KV-34 yalnız bu dosyayı değiştirir: tip tercihi (notification_preferences) ve anket sessizi (poll_id) burada okunur.
// Kapatılamayan tipler (contracts notifications.preferences.update notu) politikaya hiç sorulmaz.
import { MANDATORY_NOTIFICATION_TYPES, type NotificationType } from "@kararver/contracts";
import type { Prisma } from "@kararver/db";

export type NotificationPolicy = (
  tx: Prisma.TransactionClient,
  input: { type: NotificationType; pollId: string | null; recipientIds: readonly string[] },
) => Promise<readonly string[]>;

/** Kullanıcının kapatamayacağı bildirimler: moderasyon ve yaptırım (kullanıcı uyarıldığını/kısıtlandığını bilmeli). */
export const MANDATORY_TYPES: ReadonlySet<NotificationType> = new Set(MANDATORY_NOTIFICATION_TYPES);

export const allowAll: NotificationPolicy = async (_tx, { recipientIds }) => recipientIds;

// Bildirim politikası — KV-21 PR-3 (#23) kancası, KV-34 (#36) tercih ve sessize alma.
// Tüketici her alıcı diliminde politikayı çağırır; politika yazılmayacak alıcıları düşürür. Teslim transaction'ında
// okunur: aynı olayın retry'ı o anki tercihle aynı sonucu verir, yazılmış satırlar UNIQUE dedupe ile tekrar edilmez.
// Kapatılamayan tipler (contracts notifications.preferences.update notu) politikaya hiç sorulmaz (write.ts).
import { MANDATORY_NOTIFICATION_TYPES, type NotificationType } from "@kararver/contracts";
import type { Prisma } from "@kararver/db";

export type NotificationPolicy = (
  tx: Prisma.TransactionClient,
  input: { type: NotificationType; pollId: string | null; recipientIds: readonly string[] },
) => Promise<readonly string[]>;

/** Kullanıcının kapatamayacağı bildirimler: moderasyon ve yaptırım (kullanıcı uyarıldığını/kısıtlandığını bilmeli). */
export const MANDATORY_TYPES: ReadonlySet<NotificationType> = new Set(MANDATORY_NOTIFICATION_TYPES);

export const allowAll: NotificationPolicy = async (_tx, { recipientIds }) => recipientIds;

/**
 * KV-34: tipi kapatmış (notification_type_opt_outs) ve anketi sessize almış (notification_poll_mutes) alıcıları düşürür.
 * Dilim başına tek sorgu; alıcı sırası korunur (kitlesel fan-out deterministik kalır).
 */
export const preferencePolicy: NotificationPolicy = async (tx, { type, pollId, recipientIds }) => {
  if (recipientIds.length === 0) return recipientIds;
  const blocked = await tx.$queryRaw<{ id: string }[]>`
    SELECT user_id::text AS id FROM notification_type_opt_outs
    WHERE type = ${type}::notification_type AND user_id = ANY(${[...recipientIds]}::uuid[])
    UNION
    SELECT user_id::text FROM notification_poll_mutes
    WHERE ${pollId}::uuid IS NOT NULL AND poll_id = ${pollId}::uuid AND user_id = ANY(${[...recipientIds]}::uuid[])`;
  if (blocked.length === 0) return recipientIds;
  const drop = new Set(blocked.map((b) => b.id));
  return recipientIds.filter((id) => !drop.has(id));
};

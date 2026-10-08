// Bildirim satırı yazımı ve kitlesel fan-out — KV-21 PR-3 (#23). Kurallar: docs/KV-21_NOTIFICATIONS.md §6.
//
// Hepsi teslim transaction'ında çalışır (PR-2 tüketici arayüzü): bütün dilimler teslimin DONE işaretiyle birlikte commit
// olur ya da hiçbiri olmaz. Retry aynı alıcıları aynı dedupe_key ile yeniden yazar; UNIQUE (recipient_id, dedupe_key)
// ve skipDuplicates ikinciyi atlar. Kısmen yazılmış dilim durumu yoktur.
//
// Ortak süzgeç (SQL'de): aktör alıcı olmaz, silinmiş ve BANNED hesaba yazılmaz; SUSPENDED / RESTRICTED'e yazılır.
// Yazım dilim başına tek INSERT … SELECT unnest(...) ON CONFLICT DO NOTHING. notifications.id DB'de varsayılansızdır
// (Prisma uuid(7)); kimlikler contracts'ın UUIDv7 üreteciyle (newEventId) JS'te üretilir.
import { newEventId, type NotificationType } from "@kararver/contracts";
import { Prisma } from "@kararver/db";
import { MANDATORY_TYPES, type NotificationPolicy } from "./policy.ts";

/** Kitlesel bildirimde dilim büyüklüğü ve olay başına en fazla alıcı (KV-21 §4, Mehmet kararı). */
export const MASS_SLICE = 1000;
export const MASS_LIMIT = 50_000;

export type NotificationScalar = string | number | boolean | null;

export type NotificationDraft = {
  type: NotificationType;
  eventId: string;
  /** Süzgeç için olayın gerçek aktörü; actorId'den farklı olabilir (aktörü gizlenen tipler). */
  eventActorId: string | null;
  /** Bildirimde gösterilen aktör; moderasyon, yaptırım ve öne çıkarmada NULL. */
  actorId: string | null;
  subject: { type: "POLL" | "COMMENT" | "COMMUNITY" | "USER" | "ANNOUNCEMENT"; id: string };
  pollId: string | null;
  data: Record<string, NotificationScalar>;
  dedupeKey: string;
  /** = event.occurredAt: olaylar sırasız işlense de liste doğru sırada görünür. */
  createdAt: Date;
};

type Tx = Prisma.TransactionClient;

/** Politikayı uygular (kapatılamayan tipler hariç) ve satırları yazar; yazılan satır sayısı. */
export async function writeNotifications(tx: Tx, draft: NotificationDraft, recipientIds: readonly string[], policy: NotificationPolicy): Promise<number> {
  if (recipientIds.length === 0) return 0;
  const allowed = MANDATORY_TYPES.has(draft.type) ? recipientIds : await policy(tx, { type: draft.type, pollId: draft.pollId, recipientIds });
  if (allowed.length === 0) return 0;
  // Dilim başına tek INSERT (createMany 1000 satırda ~4 kat yavaş; 50k ölçümü: docs/KV-21_NOTIFICATIONS.md §6.3).
  // Kolon eşlemesi elle: notifications-sql.test.ts satırı Prisma ile geri okuyup bütün kolonları karşılaştırır.
  const ids = allowed.map(() => newEventId(draft.createdAt));
  return tx.$executeRaw`
    INSERT INTO notifications (id, recipient_id, type, event_id, actor_id, subject_type, subject_id, poll_id, data, dedupe_key, created_at)
    SELECT n.id, n.recipient_id, ${draft.type}::notification_type, ${draft.eventId}::uuid, ${draft.actorId}::uuid,
           ${draft.subject.type}, ${draft.subject.id}::uuid, ${draft.pollId}::uuid, ${JSON.stringify(draft.data)}::jsonb,
           ${draft.dedupeKey}, ${draft.createdAt.toISOString()}::timestamptz
    FROM unnest(${ids}::uuid[], ${[...allowed]}::uuid[]) AS n(id, recipient_id)
    ON CONFLICT (recipient_id, dedupe_key) DO NOTHING`;
}

/** Verilen kullanıcılardan bildirim alabilecek olanlar (ortak süzgeç). */
export async function eligibleUsers(tx: Tx, ids: readonly string[], eventActorId: string | null): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM users
    WHERE id = ANY(${[...new Set(ids)]}::uuid[]) AND deleted_at IS NULL AND status <> 'BANNED'
      AND (${eventActorId}::uuid IS NULL OR id <> ${eventActorId}::uuid)
    ORDER BY id`;
  return rows.map((r) => r.id);
}

export type FanoutResult = { written: number; recipients: number; truncated: boolean };

/**
 * Anketin bütün geçerli oy verenlerine (votes.invalidated_at IS NULL) dilimli yazım. Sıra oy zamanı + kullanıcı
 * (deterministik: retry aynı kümeyi seçer); en fazla `limit` alıcı, aşılırsa en eski oy verenler.
 * Index: votes (poll_id, created_at, invalidated_at).
 */
export async function fanoutToVoters(
  tx: Tx,
  draft: NotificationDraft,
  opts: { pollId: string; policy: NotificationPolicy; slice?: number; limit?: number },
): Promise<FanoutResult> {
  const slice = opts.slice ?? MASS_SLICE;
  const limit = opts.limit ?? MASS_LIMIT;
  const result: FanoutResult = { written: 0, recipients: 0, truncated: false };
  let cursor: { createdAt: string; userId: string } | null = null;
  while (result.recipients < limit) {
    const take = Math.min(slice, limit - result.recipients);
    const after: Prisma.Sql = cursor
      ? Prisma.sql`AND (v.created_at, v.user_id) > (${cursor.createdAt}::timestamptz, ${cursor.userId}::uuid)`
      : Prisma.empty;
    // KV-23: deduplicate voters + explicit followers before slicing, so one person uses one slot.
    const audience = draft.type === "DECISION_UPDATED" || draft.type === "POLL_CLOSED"
      ? Prisma.sql`(SELECT user_id, min(created_at) AS created_at FROM (
          SELECT user_id, created_at FROM votes WHERE poll_id = ${opts.pollId}::uuid AND invalidated_at IS NULL
          UNION ALL
          SELECT user_id, created_at FROM poll_follows WHERE poll_id = ${opts.pollId}::uuid
        ) audience GROUP BY user_id)`
      : Prisma.sql`(SELECT user_id, created_at FROM votes WHERE poll_id = ${opts.pollId}::uuid AND invalidated_at IS NULL)`;
    const rows: { userId: string; createdAt: Date }[] = await tx.$queryRaw`
      SELECT v.user_id::text AS "userId", v.created_at AS "createdAt"
      FROM ${audience} v JOIN users u ON u.id = v.user_id
      WHERE u.deleted_at IS NULL AND u.status <> 'BANNED'
        AND (${draft.eventActorId}::uuid IS NULL OR v.user_id <> ${draft.eventActorId}::uuid)
        ${after}
      ORDER BY v.created_at, v.user_id
      LIMIT ${take + 1}`;
    const page: { id: string }[] = rows.slice(0, take);
    result.recipients += page.length;
    result.written += await writeNotifications(tx, draft, page.map((r) => r.userId), opts.policy);
    if (rows.length <= take) return result;
    if (result.recipients >= limit) {
      result.truncated = true;
      return result;
    }
    const last = page[page.length - 1]!;
    cursor = { createdAt: last.createdAt.toISOString(), userId: last.userId };
  }
  return result;
}

/**
 * Announcement broadcast: fan out to currently active registered accounts,
 * respecting type opt-outs and the shared actor/deleted/BANNED policy.
 * Stable UUID cursor and per-recipient dedupe make retries and concurrent jobs safe.
 * The 50k default cap follows other mass-notification limits.
 */
export async function fanoutToActiveUsers(
  tx: Tx,
  draft: NotificationDraft,
  opts: { policy: NotificationPolicy; slice?: number; limit?: number },
): Promise<FanoutResult> {
  const slice = opts.slice ?? MASS_SLICE;
  const limit = opts.limit ?? MASS_LIMIT;
  const result: FanoutResult = { written: 0, recipients: 0, truncated: false };
  let cursor: string | null = null;
  while (result.recipients < limit) {
    const take = Math.min(slice, limit - result.recipients);
    const after: Prisma.Sql = cursor ? Prisma.sql`AND id > ${cursor}::uuid` : Prisma.empty;
    const rows: { id: string }[] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM users
      WHERE deleted_at IS NULL AND status <> 'BANNED'
        AND (${draft.eventActorId}::uuid IS NULL OR id <> ${draft.eventActorId}::uuid)
        ${after}
      ORDER BY id LIMIT ${take + 1}`;
    const page = rows.slice(0, take);
    result.recipients += page.length;
    result.written += await writeNotifications(tx, draft, page.map(r => r.id), opts.policy);
    if (rows.length <= take) return result;
    if (result.recipients >= limit) {
      result.truncated = true;
      return result;
    }
    cursor = page[page.length - 1]!.id;
  }
  return result;
}

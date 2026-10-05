// Bildirim tüketicisi — KV-21 PR-3 (#23). PR-2 olay dağıtıcısına (jobs/events) takılır: olay → adapter → alıcılar →
// ortak süzgeç ve politika → notifications satırları. Hepsi teslim transaction'ında (DONE ile birlikte commit; retry'da
// UNIQUE recipient_id + dedupe_key ikinci yazımı atlar). Ayrıntı: docs/KV-21_NOTIFICATIONS.md §6.
import type { EventType } from "@kararver/contracts";
import { PermanentEventError, type EventConsumer } from "../events/consumers.ts";
import { notificationAdapters } from "./adapters.ts";
import { allowAll, type NotificationPolicy } from "./policy.ts";
import { eligibleUsers, fanoutToVoters, writeNotifications } from "./write.ts";

export const NOTIFICATIONS_CONSUMER = "notifications";

export type NotificationsConsumerOptions = {
  policy?: NotificationPolicy;
  /** Kitlesel bildirim dilimi ve olay başına sınır (varsayılan 1000 / 50 000; testte küçültülür). */
  slice?: number;
  limit?: number;
};

export function createNotificationsConsumer(opts: NotificationsConsumerOptions = {}): EventConsumer {
  const policy = opts.policy ?? allowAll;
  return {
    name: NOTIFICATIONS_CONSUMER,
    types: Object.keys(notificationAdapters) as EventType[],
    async handle(event, { tx, log }) {
      const adapter = notificationAdapters[event.type];
      if (!adapter) throw new PermanentEventError(`bildirim adapter'ı yok: ${event.type}`);
      const base = adapter.draft(event);
      if (!base) return;
      const recipients = await adapter.recipients(tx, event);
      if (!recipients) return;
      const draft = recipients.pollId !== undefined ? { ...base, pollId: recipients.pollId } : base;
      await writeNotifications(tx, draft, await eligibleUsers(tx, recipients.userIds, draft.eventActorId), policy);
      if (recipients.voters) {
        const result = await fanoutToVoters(tx, draft, { pollId: recipients.voters.pollId, policy, slice: opts.slice, limit: opts.limit });
        if (result.truncated) {
          log("warn", "kitlesel bildirim sınırı aşıldı; en eski oy verenler bildirim aldı", { eventId: event.id, type: event.type, pollId: recipients.voters.pollId, recipients: result.recipients });
        }
      }
    },
  };
}

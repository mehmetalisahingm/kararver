// Bildirim tüketicisi — KV-21 PR-3 (#23). PR-2 olay dağıtıcısına (jobs/events) takılır: olay → adapter → alıcılar →
// ortak süzgeç ve politika → notifications satırları. Hepsi teslim transaction'ında (DONE ile birlikte commit; retry'da
// UNIQUE recipient_id + dedupe_key ikinci yazımı atlar). Ayrıntı: docs/KV-21_NOTIFICATIONS.md §6.
import type { EventType } from "@kararver/contracts";
import { PermanentEventError, type EventConsumer } from "../events/consumers.ts";
import { notificationAdapters } from "./adapters.ts";
import { preferencePolicy, type NotificationPolicy } from "./policy.ts";
import { eligibleUsers, fanoutToVoters, fanoutToActiveUsers, writeNotifications } from "./write.ts";
import { recordModerationRejectionInboxDelivery } from "./appeal-delivery.ts";

export const NOTIFICATIONS_CONSUMER = "notifications";

export type NotificationsConsumerOptions = {
  policy?: NotificationPolicy;
  /** Kitlesel bildirim dilimi ve olay başına sınır (varsayılan 1000 / 50 000; testte küçültülür). */
  slice?: number;
  limit?: number;
};

export function createNotificationsConsumer(opts: NotificationsConsumerOptions = {}): EventConsumer {
  const policy = opts.policy ?? preferencePolicy;
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
      // Actual recipient-specific inbox INSERT is the notification delivery,
      // NOT the moderation decision time. The receipt and notification commit
      // together, so retries cannot restart or backdate the filing period.
      if (event.type === "moderation.applied" && event.subject.type === "POLL") {
        const e = event.payload as { moderationActionId: string; action: string; fromStatus: string; toStatus: string };
        if (e.action === "REMOVE" && e.fromStatus === "UNDER_REVIEW" && e.toStatus === "REMOVED") {
          await recordModerationRejectionInboxDelivery(tx, {
            eventId: event.id, rejectionActionId: e.moderationActionId, pollId: event.subject.id,
          });
        }
      }
      if (recipients.broadcast) {
        const result = await fanoutToActiveUsers(tx, draft, { policy, slice: opts.slice, limit: opts.limit });
        if (result.truncated) {
          log("warn", "duyuru bildirim sınırı aşıldı; yalnız ilk alıcılara iletildi", {
            eventId: event.id, type: event.type, recipients: result.recipients,
          });
        }
      }
      if (recipients.voters) {
        const result = await fanoutToVoters(tx, draft, { pollId: recipients.voters.pollId, policy, slice: opts.slice, limit: opts.limit });
        if (result.truncated) {
          log("warn", "kitlesel bildirim sınırı aşıldı; en eski oy verenler bildirim aldı", { eventId: event.id, type: event.type, pollId: recipients.voters.pollId, recipients: result.recipients });
        }
      }
    },
  };
}

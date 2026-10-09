// KV-21 PR-3 (#23) bildirim adapter'larının sözleşme testi — DB gerektirmez. Kabul koşulu: "her modülün olay adapteri
// için sözleşme testi". Doğrulanan: katalog ↔ adapter haritası iki yönlü; tüketici kaydı; her adapter'ın contracts
// örnek olayından ürettiği taslak NotificationView ve tipe özgü notificationData şemasından geçer; data'da olayın hassas
// alanları ve serbest metin yok; dedupe anahtarı biçimi; created_at = occurredAt; aktörü gizlenen tipler.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createEvent, eventCatalog, NotificationView, notificationData, type EventDefinition, type EventType } from "@kararver/contracts";
import { eventExamples } from "@kararver/contracts/fixtures/events";
import { assertConsumers } from "../src/jobs/events/consumers.ts";
import { productionConsumers } from "../src/jobs/events/registry.ts";
import { notificationAdapters } from "../src/jobs/notifications/adapters.ts";
import { createNotificationsConsumer, NOTIFICATIONS_CONSUMER } from "../src/jobs/notifications/consumer.ts";

const def = (t: EventType) => eventCatalog[t] as EventDefinition;
const notifying = (Object.keys(eventCatalog) as EventType[]).filter((t) => def(t).notification).sort();
const example = <T extends EventType>(t: T, overrides: Record<string, unknown> = {}) =>
  createEvent({ ...eventExamples[t], ...overrides } as Parameters<typeof createEvent<T>>[0]);

/** DB CHECK notifications_subject_type_check ile aynı küme. */
const SUBJECT_TYPES = ["POLL", "COMMENT", "COMMUNITY", "USER", "ANNOUNCEMENT"];
/** Bildirimde gösterilmeyen aktör (KV-21 §4 karar 3). */
const HIDDEN_ACTOR = new Set(["MODERATION_APPLIED", "SANCTION_APPLIED", "COMMUNITY_FEATURED", "ANNOUNCEMENT_PUBLISHED"]);

describe("bildirim adapter'ları: sözleşme", () => {
  test("katalogda bildirim üreten her olay tipinin tam bir adapter'ı var; her adapter katalogdaki tipiyle eşleşir", () => {
    assert.deepEqual(Object.keys(notificationAdapters).sort(), notifying);
    for (const t of notifying) {
      const adapter = notificationAdapters[t]!;
      assert.equal(adapter.eventType, t);
      assert.equal(adapter.type, def(t).notification, t);
      assert.ok(def(t).consumers.includes("notifications"), t);
    }
  });

  test("tüketici: adı notifications, tipleri bildirim olaylarıyla aynı, kayıt doğrulamasından geçer, üretimde kayıtlı", () => {
    const consumer = createNotificationsConsumer();
    assert.equal(consumer.name, NOTIFICATIONS_CONSUMER);
    assert.deepEqual([...consumer.types].sort(), notifying);
    assertConsumers([consumer]);
    assert.deepEqual(productionConsumers.map((c) => c.name), [NOTIFICATIONS_CONSUMER]);
  });

  for (const t of notifying) {
    test(`${t}: örnek olayın taslağı NotificationView ve notificationData.${def(t).notification} şemasından geçer`, () => {
      const event = example(t);
      const draft = notificationAdapters[t]!.draft(event);
      assert.ok(draft, "örnek olay bildirim üretmeli");
      assert.equal(draft.type, def(t).notification);
      assert.ok(SUBJECT_TYPES.includes(draft.subject.type), draft.subject.type);

      // API'nin döndüreceği görünüm (notifications.list) bu taslaktan kurulur.
      NotificationView.parse({ id: event.id, type: draft.type, subject: draft.subject, actor: null, data: draft.data, readAt: null, createdAt: draft.createdAt.toISOString() });
      notificationData[draft.type].parse(draft.data);

      for (const field of def(t).sensitive) assert.ok(!(field in draft.data), `${t}: hassas alan ${field}`);
      assert.ok(!("reason" in draft.data && t === "sanction.applied"), "yaptırım gerekçesi yazılmaz");
      assert.match(draft.dedupeKey, /^notifications:/);
      assert.ok(draft.dedupeKey.length <= 250);
      assert.equal(draft.createdAt.toISOString(), new Date(event.occurredAt).toISOString(), "created_at = occurredAt");
      assert.equal(draft.eventId, event.id);
      assert.equal(draft.eventActorId, event.actorId, "süzgeç gerçek aktöre göre yapılır");
      if (HIDDEN_ACTOR.has(draft.type)) assert.equal(draft.actorId, null, `${t}: aktör gizli`);
      else assert.equal(draft.actorId, event.actorId);
    });
  }

  test("dedupe: doğal anahtar varsa onu, yoksa olay kimliğini kullanır; trend anket + format başına ömür boyu", () => {
    const milestone = example("poll.milestone");
    assert.equal(notificationAdapters["poll.milestone"]!.draft(milestone)!.dedupeKey, `notifications:poll.milestone:${milestone.subject.id}:VOTES:100`);
    const comment = example("comment.created");
    assert.equal(notificationAdapters["comment.created"]!.draft(comment)!.dedupeKey, `notifications:${comment.id}`);
    const trend = (trendRunId: string, format = "DAILY_RISING") =>
      notificationAdapters["poll.trending"]!.draft(example("poll.trending", { payload: { format, rank: 2, trendRunId } }))!.dedupeKey;
    const runA = "0190f3a4-0000-7000-8000-0000000000aa";
    const runB = "0190f3a4-0000-7000-8000-0000000000bb";
    assert.equal(trend(runA), trend(runB), "farklı trend çalıştırması aynı anahtar");
    assert.notEqual(trend(runA), trend(runA, "WEEKLY_MOVERS"), "farklı format ayrı anahtar");
  });

  test("bildirim üretmeyen olaylar: SUSPEND/BAN yaptırımı, listede olmayan kilometre taşı", () => {
    const sanction = (type: string) => notificationAdapters["sanction.applied"]!.draft(example("sanction.applied", { payload: { sanctionId: eventExamples["sanction.applied"].payload.sanctionId, type, endsAt: type === "BAN" || type === "WARNING" ? null : "2026-10-05T12:00:00Z" } }));
    assert.ok(sanction("WARNING"));
    assert.ok(sanction("RESTRICT_POSTING"));
    assert.equal(sanction("SUSPEND"), null);
    assert.equal(sanction("BAN"), null);
    for (const milestone of [10, 50, 100, 500, 1000, 5000, 10000]) {
      assert.ok(notificationAdapters["poll.milestone"]!.draft(example("poll.milestone", { payload: { metric: "VOTES", milestone } })), String(milestone));
    }
    for (const milestone of [1, 25, 200, 20000]) {
      assert.equal(notificationAdapters["poll.milestone"]!.draft(example("poll.milestone", { payload: { metric: "VOTES", milestone } })), null, String(milestone));
    }
  });
});

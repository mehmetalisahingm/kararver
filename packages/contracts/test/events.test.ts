// KV-04 olay sözleşmesi testleri: katalog ↔ eventTypes, KV-07 ve bildirim eşlemesi,
// zarf/payload doğrulaması, dedupe ve doğal anahtar. DB gerektirmez.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { eventExamples } from "../fixtures/events.ts";
import {
  createEvent,
  dedupeKey,
  eventCatalog,
  eventDelivery,
  eventEnvelope,
  eventTypes,
  isEventType,
  MANDATORY_NOTIFICATION_TYPES,
  naturalKey,
  newEventId,
  NotificationType,
  notificationData,
  NotificationView,
  parseEvent,
  POLL_MILESTONES,
  type EventDefinition,
  type EventType,
} from "../src/index.ts";

const EVENT_ID = "0190f3a4-5b6c-7d8e-9f01-23456789abcd";
const EVENT_ID_2 = "0190f3a4-5b6c-7d8e-9f01-23456789abce";
const POLL = "0190f3a4-0000-7000-8000-000000000001";
const USER = "0190f3a4-0000-7000-8000-000000000002";
const OPTION_A = "0190f3a4-0000-7000-8000-000000000003";
const OPTION_B = "0190f3a4-0000-7000-8000-000000000004";
const RUN = "0190f3a4-0000-7000-8000-000000000005";
const T = "2026-09-28T12:00:00Z";

const catalogTypes = Object.keys(eventCatalog) as EventType[];
const def = (t: EventType) => eventCatalog[t] as EventDefinition;

function event(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: EVENT_ID,
    type: "vote.submitted",
    occurredAt: T,
    actorId: USER,
    subject: { type: "POLL", id: POLL },
    payload: { optionId: OPTION_A, discoverySource: "organic" },
    ...overrides,
  };
}

describe("olay kataloğu", () => {
  test("katalog ile #64 eventTypes birebir aynı", () => {
    assert.deepEqual([...catalogTypes].sort(), [...eventTypes].sort());
  });

  test("#64 ve KV-03 tipleri korunur; KV-04 yedi tip ekler", () => {
    const legacy = [
      "user.registered", "poll.created", "poll.closed", "vote.submitted", "comment.created", "alternative.created",
      "decision.updated", "poll.milestone", "poll.trending", "community.featured", "moderation.applied",
      "announcement.published", "vote.changed", "comment.replied", "reaction.changed", "report.created",
      "points.granted", "points.debited", "points.adjusted",
    ];
    for (const t of legacy) assert.ok(eventTypes.has(t), t);
    for (const t of ["vote.invalidated", "report.resolved", "sanction.applied", "sanction.lifted", "role.changed", "settings.changed", "featured.applied"]) {
      assert.ok(eventTypes.has(t), t);
    }
    assert.equal(eventTypes.size, 26);
  });

  test("kabul koşulu: oy/kapanış/karar/yorum/alternatif/trend/moderasyon olayları listeli", () => {
    for (const t of ["vote.submitted", "vote.changed", "vote.invalidated", "poll.closed", "decision.updated", "comment.created", "comment.replied", "alternative.created", "poll.trending", "moderation.applied"]) {
      assert.ok(isEventType(t), t);
    }
  });

  test("her olayın üreticisi, konusu, strict payload'ı ve aktör kuralı var", () => {
    for (const t of catalogTypes) {
      const d = def(t);
      assert.ok(d.producer.owner && d.producer.module, t);
      assert.ok(d.subjects.length > 0, t);
      assert.ok(["user", "system", "any"].includes(d.actor), t);
      assert.equal(d.payload.safeParse({ unexpected: true }).success, false, `${t} payload strict olmalı`);
    }
  });

  test("üretici sahipleri: report.resolved Mert, vote.invalidated Faruk (#45)", () => {
    assert.deepEqual(def("report.resolved").producer, { owner: "Mert", module: "reports" });
    assert.deepEqual(def("vote.invalidated").producer, { owner: "Faruk", module: "votes", issue: "#45" });
    for (const t of ["sanction.applied", "sanction.lifted", "role.changed", "settings.changed"] as const) {
      assert.equal(def(t).producer.owner, "Utku", t);
    }
  });

  test("içerik gizle/geri yükle moderation.applied ile taşınır; ayrı tip yok", () => {
    assert.ok(catalogTypes.every((t) => !/^(content|poll|comment)\.(hidden|restored)$/.test(t)));
    const p = def("moderation.applied").payload;
    for (const action of ["HIDE", "RESTORE"]) {
      assert.ok(
        p.safeParse({ moderationActionId: EVENT_ID, action, fromStatus: "ACTIVE", toStatus: "HIDDEN", reportId: null }).success,
      );
    }
  });

  test("her bildirim tipinin üreten bir olayı var; bildirim olayları notifications tüketicisini listeler", () => {
    const produced = new Set(catalogTypes.map((t) => def(t).notification).filter(Boolean));
    assert.deepEqual([...NotificationType.options].filter((n) => !produced.has(n)), []);
    for (const t of catalogTypes.filter((x) => def(x).notification)) {
      assert.ok(def(t).consumers.includes("notifications"), t);
    }
  });

  test("KV-07 eşlemesi sözlükte var; analytics adı olan olay analytics tüketicisini listeler", () => {
    const doc = readFileSync(path.join(import.meta.dirname, "../../../docs/KV-07_PRODUCT_EVENTS_ACCEPTANCE_CONTENT.md"), "utf8");
    for (const t of catalogTypes) {
      for (const name of def(t).analytics) assert.ok(doc.includes(`### \`${name}\``), `${t} → ${name} KV-07'de yok`);
      assert.equal(def(t).analytics.length > 0, def(t).consumers.includes("analytics"), t);
    }
  });

  test("oy seçimi ve seçmen kimliği hassas işaretli; bildirim üreten olay hassas alan taşımaz", () => {
    for (const t of catalogTypes) {
      const keys = Object.keys(def(t).payload.shape);
      for (const k of keys.filter((x) => /optionId$|^voterId$/i.test(x) && x !== "chosenOptionId")) {
        assert.ok(def(t).sensitive.includes(k), `${t}.${k} sensitive olmalı`);
      }
      for (const k of def(t).sensitive) assert.ok(keys.includes(k), `${t}: bilinmeyen sensitive ${k}`);
      if (def(t).notification) assert.deepEqual(def(t).sensitive, [], t);
    }
  });

  test("featured_content_applied → featured.applied; community.featured dar anlamda (topluluk yüzeyi)", () => {
    const owners = catalogTypes.filter((t) => def(t).analytics.includes("featured_content_applied"));
    assert.deepEqual(owners, ["featured.applied"]);
    assert.deepEqual(Object.keys(def("community.featured").payload.shape).sort(), ["communityId", "endsAt", "placementId", "startsAt"]);
    assert.equal(def("community.featured").notification, "COMMUNITY_FEATURED");
    // surface alanı yok: başka yüzey bu tipe taşınamaz
    const e = eventExamples["community.featured"];
    assert.throws(() => createEvent({ ...e, payload: { ...e.payload, surface: "HOME_SPOTLIGHT" } as never }), TypeError);
  });

  test("teslim kuralı: en az bir kez, outbox, sabit UUIDv7", () => {
    assert.equal(eventDelivery.guarantee, "at-least-once");
    assert.equal(eventDelivery.transport, "outbox");
    assert.equal(eventDelivery.idFormat, "uuidv7");
    assert.equal(eventDelivery.idStableAcrossRetries, true);
  });
});

describe("örnek olaylar", () => {
  test("katalogdaki her tipin örneği var", () => {
    assert.deepEqual(Object.keys(eventExamples).sort(), [...catalogTypes].sort());
  });

  for (const t of catalogTypes) {
    test(`${t}: örnek hem eventEnvelope hem parseEvent/createEvent'ten geçer`, () => {
      const e = eventExamples[t];
      const envelope = eventEnvelope(e);
      assert.equal(envelope.type, t);
      assert.deepEqual(parseEvent(envelope), { version: 1, ...e });
      assert.deepEqual(createEvent(e), { version: 1, ...e });
    });
  }
});

describe("createEvent", () => {
  test("yazma anında katı doğrular: gevşek zarf outbox'a giremez", () => {
    const e = eventExamples["vote.submitted"];
    // eventEnvelope bu olayları kabul eder; createEvent reddeder (zehirli mesaj tüketiciye ulaşmaz).
    const poisoned = [
      { ...e, id: "event-1" },
      { ...e, subject: { type: "poll", id: "poll-1" } },
      { ...e, payload: { ...e.payload, email: "a@b.c" } },
      { ...e, payload: {} },
    ];
    for (const bad of poisoned) {
      assert.ok(eventEnvelope(bad as never));
      assert.throws(() => createEvent(bad as never), TypeError);
    }
  });

  test("version alanını kendisi koyar", () => {
    assert.equal(createEvent(eventExamples["poll.closed"]).version, 1);
  });
});

describe("parseEvent", () => {
  test("geçerli olay tipli döner", () => {
    const e = parseEvent(event());
    assert.equal(e.type, "vote.submitted");
    assert.deepEqual(e.subject, { type: "POLL", id: POLL });
  });

  test("#64 eventEnvelope davranışı değişmedi", () => {
    const legacy = { id: "event-1", type: "poll.closed", occurredAt: "2026-09-27T12:00:00Z", subject: { type: "poll", id: "poll-1" } };
    assert.equal(eventEnvelope(legacy).version, 1);
    assert.equal(eventEnvelope({ ...legacy, type: "settings.changed" }).type, "settings.changed");
    // Katı doğrulama yalnız parseEvent'te: aynı olay tüketici girişinde reddedilir.
    assert.throws(() => parseEvent({ version: 1, ...legacy }), TypeError);
  });

  const invalid: [string, Record<string, unknown>][] = [
    ["UUIDv7 olmayan id", { id: "0190f3a4-5b6c-4d8e-9f01-23456789abcd" }],
    ["sürüm", { version: 2 }],
    ["bilinmeyen tip", { type: "vote.deleted" }],
    ["yanlış konu tipi", { subject: { type: "COMMENT", id: POLL } }],
    ["UUID olmayan konu", { subject: { type: "POLL", id: "poll-1" } }],
    ["Z olmayan zaman", { occurredAt: "2026-09-28T12:00:00+03:00" }],
    ["kullanıcı olayında actorId yok", { actorId: null }],
    ["payload fazladan alan", { payload: { optionId: OPTION_A, discoverySource: null, email: "a@b.c" } }],
    ["payload eksik alan", { payload: { discoverySource: null } }],
  ];
  for (const [name, overrides] of invalid) {
    test(`reddeder: ${name}`, () => assert.throws(() => parseEvent(event(overrides)), TypeError));
  }

  test("sistem olayı actorId taşımaz", () => {
    const trending = event({ type: "poll.trending", actorId: null, payload: { format: "DAILY_RISING", rank: 1, trendRunId: RUN } });
    assert.equal(parseEvent(trending).actorId, null);
    assert.throws(() => parseEvent({ ...trending, actorId: USER }), /sistem olayıdır/);
  });

  test("poll.closed süre dolumunda sistem, sahibinde kullanıcı aktörü alabilir", () => {
    const closed = event({ type: "poll.closed", payload: { reason: "EXPIRED", closedAt: T } });
    assert.ok(parseEvent({ ...closed, actorId: null }));
    assert.ok(parseEvent({ ...closed, payload: { reason: "OWNER", closedAt: T } }));
  });

  test("ayar olayının konusu ayar anahtarıdır", () => {
    const s = event({ type: "settings.changed", subject: { type: "SETTING", id: "polls.voteChangeAllowed" }, payload: { version: 4, public: true } });
    assert.equal(parseEvent(s).subject.id, "polls.voteChangeAllowed");
    assert.throws(() => parseEvent({ ...s, subject: { type: "SETTING", id: "DROP TABLE" } }), TypeError);
  });

  test("oy değişimi aynı seçeneğe olamaz", () => {
    const changed = event({ type: "vote.changed", payload: { fromOptionId: OPTION_A, toOptionId: OPTION_B } });
    assert.ok(parseEvent(changed));
    assert.throws(() => parseEvent({ ...changed, payload: { fromOptionId: OPTION_A, toOptionId: OPTION_A } }), TypeError);
  });
});

describe("tekrar işleme", () => {
  test("dedupe anahtarı handler + event.id; bildirimde alıcı da eklenir", () => {
    const e = parseEvent(event());
    assert.equal(dedupeKey(e, "trends.counters"), `trends.counters:${EVENT_ID}`);
    assert.equal(dedupeKey(e, "notifications.fanout", USER), `notifications.fanout:${EVENT_ID}:${USER}`);
    assert.notEqual(dedupeKey(e, "trends.counters"), dedupeKey(e, "analytics.adapter"));
    assert.throws(() => dedupeKey(e, ""), /handler/);
    assert.throws(() => dedupeKey(e, "notifications.fanout", "not-a-uuid"), /recipientId/);
  });

  test("retry aynı ID'yi taşır, aynı anahtarı üretir", () => {
    const first = parseEvent(event());
    const retry = parseEvent(event());
    assert.equal(dedupeKey(first, "analytics.adapter"), dedupeKey(retry, "analytics.adapter"));
  });

  test("farklı ID ile tekrar üretilen tek seferlik olay doğal anahtarla yakalanır", () => {
    const a = parseEvent(event({ type: "poll.closed", actorId: null, payload: { reason: "EXPIRED", closedAt: T } }));
    const b = parseEvent(event({ id: EVENT_ID_2, type: "poll.closed", actorId: null, payload: { reason: "EXPIRED", closedAt: T } }));
    assert.notEqual(dedupeKey(a, "notifications.fanout"), dedupeKey(b, "notifications.fanout"));
    assert.equal(naturalKey(a), naturalKey(b));
    assert.equal(naturalKey(a), `poll.closed:${POLL}`);
  });

  test("doğal anahtarlar: ilk oy kişi başına, milestone eşik başına, trend çalıştırma başına", () => {
    assert.equal(naturalKey(parseEvent(event())), `vote.submitted:${POLL}:${USER}`);
    const milestone = parseEvent(event({ type: "poll.milestone", actorId: null, payload: { metric: "VOTES", milestone: 100 } }));
    assert.equal(naturalKey(milestone), `poll.milestone:${POLL}:VOTES:100`);
    const trending = parseEvent(event({ type: "poll.trending", actorId: null, payload: { format: "WEEKLY_MOVERS", rank: 3, trendRunId: RUN } }));
    assert.equal(naturalKey(trending), `poll.trending:${POLL}:WEEKLY_MOVERS:${RUN}`);
  });

  test("tekrarlanabilir olayların doğal anahtarı yok", () => {
    const changed = parseEvent(event({ type: "vote.changed", payload: { fromOptionId: OPTION_A, toOptionId: OPTION_B } }));
    assert.equal(naturalKey(changed), null);
  });
});

describe("olay kimliği (newEventId, UUIDv7)", () => {
  test("biçim: sürüm 7, RFC 9562 varyantı; createEvent/parseEvent kabul eder", () => {
    for (let i = 0; i < 200; i++) {
      const id = newEventId();
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    const id = newEventId();
    assert.equal(parseEvent(event({ id })).id, id);
  });

  test("ilk 48 bit milisaniye zamanıdır; farklı milisaniyelerde zaman sırasıyla artar", () => {
    const at = new Date("2026-10-04T12:34:56.789Z");
    const id = newEventId(at);
    assert.equal(parseInt(id.replaceAll("-", "").slice(0, 12), 16), at.getTime());
    const ids = Array.from({ length: 50 }, (_, i) => newEventId(new Date(at.getTime() + i)));
    assert.deepEqual([...ids].sort(), ids);
  });

  test("aynı zamanda üretilen kimlikler farklıdır (74 bit rastgele)", () => {
    const at = new Date();
    assert.equal(new Set(Array.from({ length: 1000 }, () => newEventId(at))).size, 1000);
  });

  test("geçersiz zaman reddedilir", () => {
    assert.throws(() => newEventId(new Date(Number.NaN)), TypeError);
    assert.throws(() => newEventId(new Date(-1)), TypeError);
  });
});

describe("bildirim verisi (KV-21 PR-3)", () => {
  const samples: Record<NotificationType, Record<string, string | number | boolean | null>> = {
    COMMENT_ON_POLL: {},
    REPLY_TO_COMMENT: { parentId: OPTION_A },
    ALTERNATIVE_ON_POLL: {},
    POLL_MILESTONE: { metric: "VOTES", milestone: 100 },
    POLL_TRENDING: { format: "WEEKLY_MOVERS", rank: 3 },
    POLL_CLOSED: { reason: "EXPIRED" },
    DECISION_UPDATED: { first: true },
    MODERATION_APPLIED: { action: "HIDE", toStatus: "HIDDEN" },
    COMMUNITY_FEATURED: { communityId: OPTION_B },
    SANCTION_APPLIED: { sanctionType: "WARNING", endsAt: null },
  };

  test("her bildirim tipinin data şeması var; örnek hem tipe özgü şemadan hem NotificationView.data'dan geçer", () => {
    assert.deepEqual(Object.keys(notificationData).sort(), [...NotificationType.options].sort());
    for (const type of NotificationType.options) {
      notificationData[type].parse(samples[type]);
      NotificationView.shape.data.parse(samples[type]);
      assert.throws(() => notificationData[type].parse({ ...samples[type], reason: "serbest metin" }), type);
    }
  });

  test("yaptırım bildirimi yalnız WARNING ve RESTRICT_*; gerekçe taşımaz", () => {
    for (const t of ["WARNING", "RESTRICT_COMMENTS", "RESTRICT_POSTING"]) notificationData.SANCTION_APPLIED.parse({ sanctionType: t, endsAt: null });
    for (const t of ["SUSPEND", "BAN"]) assert.throws(() => notificationData.SANCTION_APPLIED.parse({ sanctionType: t, endsAt: null }));
    assert.equal(eventCatalog["sanction.applied"].notification, "SANCTION_APPLIED");
    assert.ok(eventCatalog["sanction.applied"].consumers.includes("notifications"));
  });

  test("kapatılamayan tipler ve kilometre taşları", () => {
    assert.deepEqual([...MANDATORY_NOTIFICATION_TYPES].sort(), ["MODERATION_APPLIED", "SANCTION_APPLIED"]);
    assert.ok(MANDATORY_NOTIFICATION_TYPES.every((t) => NotificationType.options.includes(t)));
    assert.deepEqual([...POLL_MILESTONES], [10, 50, 100, 500, 1000, 5000, 10000]);
    assert.deepEqual([...POLL_MILESTONES].sort((a, b) => a - b), [...POLL_MILESTONES]);
  });
});

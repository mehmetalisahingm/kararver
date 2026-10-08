// KV-04 (#6) — domain olay kataloğu. Zarf ve `eventTypes` #64'ten gelir (helpers.ts); bu dosya
// her tipin üreticisini, konusunu, payload şemasını, tüketicilerini ve tekrar işleme kuralını
// bağlar. Açıklama: docs/KV-04_ROLES_EVENTS.md.
//
// Teslim en az bir kezdir (outbox); exactly-once iddiası yoktur. Olay ID'si (UUIDv7) producer
// tarafından mutation ile aynı transaction'da üretilir ve retry boyunca değişmez.
// Audit kaydı olaydan türetilmez; mutation ile aynı transaction'da yazılır (KV-39).
import { z } from "zod";
import { ContentStatus, Count, DiscoverySource, Id, ReactionValue, Role, Timestamp } from "./common.ts";
import { SanctionType, Setting } from "./domains/admin.ts";
import { FeaturedSurface } from "./domains/growth.ts";
import { CommentKind } from "./domains/comments.ts";
import { TrendFormat } from "./domains/discovery.ts";
import { LedgerReason } from "./domains/growth.ts";
import { ModerationAction, ReportReason, ReportTargetType } from "./domains/moderation.ts";
import type { NotificationType } from "./domains/notifications.ts";
import { PollKind, ResultsVisibility } from "./domains/polls.ts";
import type { Owner } from "./endpoint.ts";
import { eventEnvelope, type EventEnvelope } from "./helpers.ts";

export const EventSubjectType = z.enum(["USER", "POLL", "COMMENT", "COMMUNITY", "REPORT", "ANNOUNCEMENT", "SETTING"]);
export type EventSubjectType = z.infer<typeof EventSubjectType>;

/**
 * notifications — bildirim üretir (alıcı DB'den çözülür, payload'a yazılmaz)
 * analytics     — KV-07 ürün olayına adapterla çevrilir
 * trends / snapshots / search — hesap ve indeks güncellemesi
 * metrics       — admin dashboard sayaçları
 * cache         — public cache invalidation (config, duyuru)
 */
export type EventConsumer = "notifications" | "analytics" | "trends" | "snapshots" | "search" | "metrics" | "cache";

/** user: actorId zorunlu · system: job üretir, actorId null · any: ikisi de olabilir. */
export type EventActor = "user" | "system" | "any";

export type EventDefinition<P extends z.ZodObject = z.ZodObject> = {
  summary: string;
  producer: { owner: Owner; module: string; issue?: string };
  subjects: readonly EventSubjectType[];
  actor: EventActor;
  payload: P;
  consumers: readonly EventConsumer[];
  /** KV-07 ürün olay adları (docs/KV-07 §3). Domain adı ile analytics adı adapterla ayrılır. */
  analytics: readonly string[];
  notification?: z.infer<typeof NotificationType>;
  /** Bildirim verisine ve analytics dışı yüzeylere kopyalanmayacak alanlar (oy seçimi, kişi). */
  sensitive: readonly string[];
  /**
   * Bu olay konusu için en fazla bir kez anlamlıysa doğal anahtar. Aynı iş farklı ID ile iki kez
   * üretilirse (ör. job tekrar çalıştı) tüketici bu anahtarla da dedupe yapar.
   */
  naturalKey?: (event: { subject: { id: string }; actorId: string | null; payload: z.infer<P> }) => string;
};

const define = <P extends z.ZodObject>(d: EventDefinition<P>): EventDefinition<P> => Object.freeze(d);

const faruk = (module: string, issue?: string) => ({ owner: "Faruk" as const, module, ...(issue ? { issue } : {}) });
const mehmet = (module: string) => ({ owner: "Mehmet" as const, module });
const mert = (module: string) => ({ owner: "Mert" as const, module });
const utku = (module: string) => ({ owner: "Utku" as const, module });

const Ledger = z.strictObject({
  ledgerEntryId: Id,
  delta: z.number().int().refine((n) => n !== 0),
  balanceAfter: Count,
  reason: LedgerReason,
  referenceId: Id.nullable(),
});

export const eventCatalog = Object.freeze({
  "user.registered": define({
    summary: "Hesap oluşturuldu",
    producer: faruk("auth"),
    subjects: ["USER"],
    actor: "user",
    payload: z.strictObject({ shareId: Id.nullable() }),
    consumers: ["analytics", "metrics"],
    analytics: ["user_registered", "share_conversion_registered"],
    sensitive: [],
    naturalKey: (e) => `user.registered:${e.subject.id}`,
  }),
  "poll.created": define({
    summary: "Anket/tartışma yayımlandı",
    producer: faruk("polls"),
    subjects: ["POLL"],
    actor: "user",
    payload: z.strictObject({
      kind: PollKind,
      categoryId: Id,
      communityId: Id.nullable(),
      optionCount: Count,
      imageCount: Count,
      durationHours: z.number().int().min(1),
      resultsVisibility: ResultsVisibility,
      commentsEnabled: z.boolean(),
    }),
    consumers: ["analytics", "search", "metrics"],
    analytics: ["poll_created"],
    sensitive: [],
    naturalKey: (e) => `poll.created:${e.subject.id}`,
  }),
  "poll.closed": define({
    summary: "Anket kapandı (süre doldu veya sahibi kapattı)",
    producer: faruk("polls"),
    subjects: ["POLL"],
    actor: "any",
    payload: z.strictObject({ reason: z.enum(["EXPIRED", "OWNER"]), closedAt: Timestamp }),
    consumers: ["notifications", "analytics", "trends", "snapshots"],
    analytics: ["poll_closed"],
    notification: "POLL_CLOSED",
    sensitive: [],
    naturalKey: (e) => `poll.closed:${e.subject.id}`,
  }),
  "vote.submitted": define({
    summary: "İlk oy",
    producer: faruk("votes"),
    subjects: ["POLL"],
    actor: "user",
    payload: z.strictObject({ optionId: Id, discoverySource: DiscoverySource.nullable() }),
    consumers: ["analytics", "trends", "metrics"],
    analytics: ["vote_submitted", "share_conversion_contributed"],
    sensitive: ["optionId"],
    // (poll_id, user_id) unique ve geçersiz sayılan oy yeniden verilemez (DATA_MODEL §5.4).
    naturalKey: (e) => `vote.submitted:${e.subject.id}:${e.actorId}`,
  }),
  "vote.changed": define({
    summary: "Aktif oy başka seçeneğe taşındı",
    producer: faruk("votes"),
    subjects: ["POLL"],
    actor: "user",
    payload: z.strictObject({ fromOptionId: Id, toOptionId: Id }).refine((p) => p.fromOptionId !== p.toOptionId),
    consumers: ["analytics", "trends"],
    analytics: ["vote_changed"],
    sensitive: ["fromOptionId", "toOptionId"],
  }),
  "vote.invalidated": define({
    summary: "Oy geçersiz sayıldı (KV-43)",
    producer: faruk("votes", "#45"),
    subjects: ["POLL"],
    actor: "user",
    payload: z.strictObject({ voteId: Id, voterId: Id, optionId: Id }),
    consumers: ["trends", "snapshots", "metrics"],
    analytics: [],
    sensitive: ["voterId", "optionId"],
  }),
  "comment.created": define({
    summary: "Üst seviye yorum",
    producer: faruk("comments"),
    subjects: ["COMMENT"],
    actor: "user",
    payload: z.strictObject({ pollId: Id }),
    consumers: ["notifications", "analytics", "trends"],
    analytics: ["comment_created"],
    notification: "COMMENT_ON_POLL",
    sensitive: [],
  }),
  "comment.replied": define({
    summary: "Yoruma cevap (tek seviye)",
    producer: faruk("comments"),
    subjects: ["COMMENT"],
    actor: "user",
    payload: z.strictObject({ pollId: Id, parentId: Id }),
    consumers: ["notifications", "analytics", "trends"],
    analytics: ["comment_created"],
    notification: "REPLY_TO_COMMENT",
    sensitive: [],
  }),
  "alternative.created": define({
    summary: "Alternatif öneri",
    producer: faruk("comments"),
    subjects: ["COMMENT"],
    actor: "user",
    payload: z.strictObject({ pollId: Id }),
    consumers: ["notifications", "analytics", "trends"],
    analytics: ["alternative_created"],
    notification: "ALTERNATIVE_ON_POLL",
    sensitive: [],
  }),
  "reaction.changed": define({
    summary: "Beğeni/dislike eklendi, değişti veya kaldırıldı",
    producer: faruk("reactions"),
    subjects: ["POLL", "COMMENT"],
    actor: "user",
    payload: z.strictObject({
      commentKind: CommentKind.nullable(),
      previous: ReactionValue.nullable(),
      value: ReactionValue.nullable(),
    }),
    consumers: ["analytics", "trends"],
    analytics: ["comment_liked", "alternative_liked"],
    sensitive: [],
  }),
  "decision.updated": define({
    summary: "Kararımı verdim güncellendi",
    producer: mehmet("decision-updates"),
    subjects: ["POLL"],
    actor: "user",
    payload: z.strictObject({ chosenOptionId: Id.nullable(), first: z.boolean() }),
    consumers: ["notifications", "analytics"],
    analytics: ["decision_update_created"],
    notification: "DECISION_UPDATED",
    sensitive: [],
  }),
  "poll.milestone": define({
    summary: "Anket oy eşiğini geçti",
    producer: faruk("votes"),
    subjects: ["POLL"],
    actor: "system",
    payload: z.strictObject({ metric: z.enum(["VOTES"]), milestone: z.number().int().positive() }),
    consumers: ["notifications"],
    analytics: [],
    notification: "POLL_MILESTONE",
    sensitive: [],
    naturalKey: (e) => `poll.milestone:${e.subject.id}:${e.payload.metric}:${e.payload.milestone}`,
  }),
  "poll.trending": define({
    summary: "Anket bir trend listesine girdi",
    producer: faruk("trends"),
    subjects: ["POLL"],
    actor: "system",
    payload: z.strictObject({ format: TrendFormat, rank: z.number().int().min(1), trendRunId: Id }),
    consumers: ["notifications"],
    analytics: [],
    notification: "POLL_TRENDING",
    sensitive: [],
    naturalKey: (e) => `poll.trending:${e.subject.id}:${e.payload.format}:${e.payload.trendRunId}`,
  }),
  "featured.applied": define({
    summary: "İçerik bir yüzeyde öne çıkarıldı (bütün FeaturedSurface değerleri)",
    producer: mehmet("featured"),
    subjects: ["POLL"],
    actor: "user",
    payload: z.strictObject({
      placementId: Id,
      surface: FeaturedSurface,
      scopeId: Id.nullable(),
      startsAt: Timestamp,
      endsAt: Timestamp,
    }),
    consumers: ["analytics"],
    analytics: ["featured_content_applied"],
    sensitive: [],
    naturalKey: (e) => `featured.applied:${e.payload.placementId}`,
  }),
  "community.featured": define({
    summary: "Anket topluluk yüzeyinde öne çıkarıldı (dar anlam: surface = COMMUNITY)",
    producer: mehmet("featured"),
    subjects: ["POLL"],
    actor: "user",
    payload: z.strictObject({
      placementId: Id,
      communityId: Id,
      startsAt: Timestamp,
      endsAt: Timestamp,
    }),
    consumers: ["notifications"],
    analytics: [],
    notification: "COMMUNITY_FEATURED",
    sensitive: [],
    naturalKey: (e) => `community.featured:${e.payload.placementId}`,
  }),
  "moderation.applied": define({
    summary: "Gerekçeli moderasyon işlemi (gizle, geri yükle, kilitle, kaldır, trend dışı)",
    producer: mert("moderation"),
    subjects: ["POLL", "COMMENT"],
    actor: "user",
    payload: z.strictObject({
      moderationActionId: Id,
      action: ModerationAction,
      fromStatus: ContentStatus,
      toStatus: ContentStatus,
      reportId: Id.nullable(),
    }),
    consumers: ["notifications", "analytics", "trends", "search"],
    analytics: ["moderation_action_applied"],
    notification: "MODERATION_APPLIED",
    sensitive: [],
  }),
  "announcement.published": define({
    summary: "Duyuru yayına girdi",
    producer: mehmet("announcements"),
    subjects: ["ANNOUNCEMENT"],
    actor: "user",
    payload: z.strictObject({ level: z.enum(["INFO", "WARNING"]), startsAt: Timestamp, endsAt: Timestamp.nullable() }),
    consumers: ["cache"],
    analytics: [],
    sensitive: [],
    naturalKey: (e) => `announcement.published:${e.subject.id}`,
  }),
  "report.created": define({
    summary: "Rapor oluşturuldu veya kapanmış rapor yeniden açıldı",
    producer: mert("reports"),
    subjects: ["REPORT"],
    actor: "user",
    payload: z.strictObject({
      targetType: ReportTargetType,
      targetId: Id,
      reason: ReportReason,
      communityId: Id.nullable(),
    }),
    consumers: ["analytics", "metrics"],
    analytics: ["report_created"],
    sensitive: [],
  }),
  "report.resolved": define({
    summary: "Rapor sonuçlandırıldı",
    producer: mert("reports"),
    subjects: ["REPORT"],
    actor: "user",
    payload: z.strictObject({ resolution: z.enum(["ACTIONED", "DISMISSED"]), targetType: ReportTargetType, targetId: Id }),
    consumers: ["metrics"],
    analytics: [],
    sensitive: [],
  }),
  "points.granted": define({
    summary: "Puan verildi (başlangıç, iade)",
    producer: mehmet("points"),
    subjects: ["USER"],
    actor: "any",
    payload: Ledger,
    consumers: ["metrics"],
    analytics: [],
    sensitive: [],
    naturalKey: (e) => `points:${e.payload.ledgerEntryId}`,
  }),
  "points.debited": define({
    summary: "Puan harcandı (yayın)",
    producer: mehmet("points"),
    subjects: ["USER"],
    actor: "user",
    payload: Ledger,
    consumers: ["metrics"],
    analytics: [],
    sensitive: [],
    naturalKey: (e) => `points:${e.payload.ledgerEntryId}`,
  }),
  "points.adjusted": define({
    summary: "Admin puan düzeltmesi",
    producer: mehmet("points"),
    subjects: ["USER"],
    actor: "user",
    payload: Ledger,
    consumers: ["metrics"],
    analytics: [],
    sensitive: [],
    naturalKey: (e) => `points:${e.payload.ledgerEntryId}`,
  }),
  "sanction.applied": define({
    summary: "Kullanıcıya yaptırım uygulandı",
    producer: utku("admin-users"),
    subjects: ["USER"],
    actor: "user",
    payload: z.strictObject({ sanctionId: Id, type: SanctionType, endsAt: Timestamp.nullable() }),
    consumers: ["notifications", "search", "metrics"],
    analytics: [],
    // Yalnız WARNING ve RESTRICT_* bildirim üretir; SUSPEND/BAN kullanıcı girişte hatayı görür (KV-21 §4).
    notification: "SANCTION_APPLIED",
    sensitive: [],
    naturalKey: (e) => `sanction.applied:${e.payload.sanctionId}`,
  }),
  "sanction.lifted": define({
    summary: "Yaptırım kaldırıldı",
    producer: utku("admin-users"),
    subjects: ["USER"],
    actor: "user",
    payload: z.strictObject({ sanctionId: Id, type: SanctionType }),
    consumers: ["search", "metrics"],
    analytics: [],
    sensitive: [],
    naturalKey: (e) => `sanction.lifted:${e.payload.sanctionId}`,
  }),
  "role.changed": define({
    summary: "Global rol değişti",
    producer: utku("rbac"),
    subjects: ["USER"],
    actor: "user",
    payload: z.strictObject({ previousRoles: z.array(Role), roles: z.array(Role) }),
    consumers: [],
    analytics: [],
    sensitive: [],
  }),
  "settings.changed": define({
    summary: "Sistem ayarı veya acil durum anahtarı değişti",
    producer: utku("settings"),
    subjects: ["SETTING"],
    actor: "user",
    payload: z.strictObject({ version: z.number().int().min(1), public: z.boolean() }),
    consumers: ["cache"],
    analytics: [],
    sensitive: [],
    naturalKey: (e) => `settings.changed:${e.subject.id}:${e.payload.version}`,
  }),
} satisfies Record<string, EventDefinition<z.ZodObject>>);

export type EventType = keyof typeof eventCatalog;
export type EventPayload<T extends EventType> = z.infer<(typeof eventCatalog)[T]["payload"]>;
export type DomainEvent<T extends EventType = EventType> = Omit<EventEnvelope, "type" | "payload" | "subject"> & {
  type: T;
  subject: { type: EventSubjectType; id: string };
  payload: EventPayload<T>;
};

/** Teslim ve tekrar işleme kuralları (FOUNDATION_CONTRACTS "Olay ve ayar sözleşmesi"). */
export const eventDelivery = Object.freeze({
  guarantee: "at-least-once",
  transport: "outbox",
  idFormat: "uuidv7",
  idStableAcrossRetries: true,
  ordering: "none",
  dedupe: "handler + event.id; bildirimde + recipientId; naturalKey tanımlıysa o da",
} as const);

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = Id;

/**
 * Producer'ın olay kimliği (UUIDv7, RFC 9562): ilk 48 bit milisaniye cinsinden zaman, kalan 74 bit rastgele.
 * Kimlik mutation transaction'ında bir kez üretilir ve retry boyunca değişmez (eventDelivery.idStableAcrossRetries).
 * Farklı milisaniyelerde üretilen kimlikler zaman sırasıyla artar; aynı milisaniye içinde sıra rastgeledir
 * (sıralama garantisi zaten yok, eventDelivery.ordering).
 */
export function newEventId(now: Date = new Date()): string {
  const ms = now.getTime();
  if (!Number.isInteger(ms) || ms < 0 || ms > 0xffff_ffff_ffff) throw new TypeError("Invalid event time");
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  for (let i = 0; i < 6; i++) bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) % 256;
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // sürüm 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 9562 varyantı
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && Object.hasOwn(eventCatalog, value);
}

/**
 * Producer'ın outbox'a yazacağı olayı kurar ve yazma anında katı doğrular (zehirli mesaj
 * tüketiciye hiç ulaşmaz). Yeni kod `eventEnvelope` yerine bunu kullanır.
 */
export function createEvent<T extends EventType>(input: {
  id: string;
  type: T;
  occurredAt: string;
  actorId: string | null;
  subject: { type: EventSubjectType; id: string };
  payload: EventPayload<T>;
}): DomainEvent<T> {
  return parseEvent({ version: 1, ...input }) as DomainEvent<T>;
}

/**
 * Tüketici girişinde olayı doğrular: zarf (#64 `eventEnvelope`), UUIDv7 kimlik, katalogdaki
 * konu tipi, aktör kuralı ve strict payload. Geçersiz olay TypeError fırlatır.
 */
export function parseEvent(input: unknown): DomainEvent {
  const raw = (input ?? {}) as Partial<EventEnvelope>;
  const envelope = eventEnvelope({
    id: raw.id as string,
    type: raw.type as string,
    occurredAt: raw.occurredAt as string,
    actorId: raw.actorId,
    subject: raw.subject as EventEnvelope["subject"],
    payload: raw.payload,
  });
  if ((input as { version?: unknown }).version !== 1) throw new TypeError("Invalid domain event: version");
  if (!isEventType(envelope.type)) throw new TypeError(`Invalid domain event: katalogda yok ${envelope.type}`);
  const def: EventDefinition = eventCatalog[envelope.type];
  if (!uuidV7.test(envelope.id)) throw new TypeError("Invalid domain event: id UUIDv7 olmalı");

  const subjectType = EventSubjectType.safeParse(envelope.subject.type);
  if (!subjectType.success || !def.subjects.includes(subjectType.data)) {
    throw new TypeError(`Invalid domain event: ${envelope.type} konusu ${envelope.subject.type} olamaz`);
  }
  const subjectId = subjectType.data === "SETTING" ? Setting.shape.key : uuid;
  if (!subjectId.safeParse(envelope.subject.id).success) throw new TypeError("Invalid domain event: subject.id");

  if (envelope.actorId !== null && !uuid.safeParse(envelope.actorId).success) {
    throw new TypeError("Invalid domain event: actorId");
  }
  if (def.actor === "user" && envelope.actorId === null) throw new TypeError(`Invalid domain event: ${envelope.type} actorId ister`);
  if (def.actor === "system" && envelope.actorId !== null) throw new TypeError(`Invalid domain event: ${envelope.type} sistem olayıdır`);

  const payload = def.payload.safeParse(envelope.payload);
  if (!payload.success) {
    throw new TypeError(`Invalid domain event payload: ${envelope.type}: ${payload.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  return { ...envelope, type: envelope.type, subject: { type: subjectType.data, id: envelope.subject.id }, payload: payload.data } as DomainEvent;
}

/**
 * Tüketicinin işlenmiş olay kaydı anahtarı. Aynı olay aynı handler'da ikinci kez işlenmez;
 * bildirim handler'ı her alıcı için ayrı anahtar kullanır.
 */
export function dedupeKey(event: Pick<DomainEvent, "id">, handler: string, recipientId?: string): string {
  if (typeof handler !== "string" || !/^[a-z][a-z0-9.-]*$/.test(handler)) throw new TypeError("Invalid handler");
  if (recipientId !== undefined && !uuid.safeParse(recipientId).success) throw new TypeError("Invalid recipientId");
  return recipientId === undefined ? `${handler}:${event.id}` : `${handler}:${event.id}:${recipientId}`;
}

/** Olay tipinin doğal anahtarı; tanımlı değilse null (tekrar koruması yalnız event.id ile). */
export function naturalKey(event: DomainEvent): string | null {
  const def = eventCatalog[event.type] as EventDefinition;
  return def.naturalKey ? def.naturalKey(event as Parameters<NonNullable<EventDefinition["naturalKey"]>>[0]) : null;
}

// Bildirim adapter'ları — KV-21 PR-3 (#23). Kararlar ve tablo: docs/KV-21_NOTIFICATIONS.md §4, §6.
//
// Katalogda `notification` alanı olan her olay tipi için bir adapter (sözleşme testi iki yönlü zorlar). İki parça:
// - draft(event): saf. Bildirim tipi, konu, anket, gösterilen aktör, data ve dedupe anahtarı; null = bu olay bildirim
//   üretmez (SUSPEND/BAN yaptırımı, listede olmayan kilometre taşı). DB'siz test edilir (contracts şemaları).
// - recipients(tx, event): teslim anında DB'den alıcılar; payload'da alıcı yoktur (KV-04 §2.1). null = yazılmaz (konu
//   içerik teslimde görünür değil, KV-21 §4 karar 7). Konu satırı hiç yoksa PermanentEventError (yeniden denemenin
//   anlamı yok). Ortak süzgeç (aktör, silinmiş, BANNED) ve politika tüketicidedir.
//
// Dedupe: `notifications:<naturalKey ?? event.id>`; trend: anket + format başına ömür boyu tek (karar 1).
// Aktörü gizlenen tipler (karar 3): moderasyon, yaptırım, öne çıkarma → actorId NULL; süzgeç yine gerçek aktöre göre.
import { naturalKey, POLL_MILESTONES, type DomainEvent, type EventType, type NotificationType } from "@kararver/contracts";
import type { Prisma } from "@kararver/db";
import { PermanentEventError } from "../events/consumers.ts";
import type { NotificationDraft, NotificationScalar } from "./write.ts";

type Tx = Prisma.TransactionClient;

export type Recipients = {
  /** Doğrudan alıcılar (ortak süzgeçten geçer). */
  userIds: string[];
  /** Kitlesel: anketin bütün geçerli oy verenleri (dilimli fan-out). */
  voters?: { pollId: string };
  /** Active announcement broadcast to registered accounts; delivered in bounded slices. */
  broadcast?: boolean;
  /** Taslaktaki poll_id'yi DB'den çözülen değerle değiştirir (yorum moderasyonu). */
  pollId?: string;
};

export type NotificationAdapter<T extends EventType = EventType> = {
  eventType: T;
  type: NotificationType;
  draft(event: DomainEvent<T>): NotificationDraft | null;
  recipients(tx: Tx, event: DomainEvent<T>): Promise<Recipients | null>;
};

const define = <T extends EventType>(a: NotificationAdapter<T>) => a as unknown as NotificationAdapter;

/** Bildirim üreten içerik görünür mü (moderasyon bildirimi hariç). */
const visible = (status: string) => status === "ACTIVE" || status === "LOCKED";

function draftOf(
  event: DomainEvent,
  type: NotificationType,
  x: { subject: NotificationDraft["subject"]; pollId: string | null; actorId: string | null; data: Record<string, NotificationScalar>; dedupeKey?: string },
): NotificationDraft {
  return {
    type,
    eventId: event.id,
    eventActorId: event.actorId,
    actorId: x.actorId,
    subject: x.subject,
    pollId: x.pollId,
    data: x.data,
    dedupeKey: x.dedupeKey ?? `notifications:${naturalKey(event) ?? event.id}`,
    createdAt: new Date(event.occurredAt),
  };
}

type PollRow = { authorId: string; status: string };
async function pollOf(tx: Tx, pollId: string): Promise<PollRow> {
  const [row] = await tx.$queryRaw<PollRow[]>`SELECT author_id::text AS "authorId", status::text AS status FROM polls WHERE id = ${pollId}::uuid`;
  if (!row) throw new PermanentEventError(`anket yok: ${pollId}`);
  return row;
}

type CommentRow = { authorId: string; pollId: string; status: string; pollAuthorId: string; pollStatus: string; parentAuthorId: string | null; parentId: string | null };
async function commentOf(tx: Tx, commentId: string): Promise<CommentRow> {
  const [row] = await tx.$queryRaw<CommentRow[]>`
    SELECT c.author_id::text AS "authorId", c.poll_id::text AS "pollId", c.status::text AS status,
           p.author_id::text AS "pollAuthorId", p.status::text AS "pollStatus",
           parent.author_id::text AS "parentAuthorId", c.parent_id::text AS "parentId"
    FROM comments c JOIN polls p ON p.id = c.poll_id LEFT JOIN comments parent ON parent.id = c.parent_id
    WHERE c.id = ${commentId}::uuid`;
  if (!row) throw new PermanentEventError(`yorum yok: ${commentId}`);
  return row;
}

/** Yorum / öneri: anket sahibine; yorum ve anket teslimde görünür olmalı. */
async function toPollAuthorOfComment(tx: Tx, commentId: string): Promise<Recipients | null> {
  const c = await commentOf(tx, commentId);
  if (!visible(c.status) || !visible(c.pollStatus)) return null;
  return { userIds: [c.pollAuthorId] };
}

/** Anket konulu bildirim: anket sahibine; anket teslimde görünür olmalı. */
async function toPollAuthor(tx: Tx, pollId: string): Promise<Recipients | null> {
  const p = await pollOf(tx, pollId);
  return visible(p.status) ? { userIds: [p.authorId] } : null;
}

const NOTIFIED_SANCTIONS = new Set(["WARNING", "RESTRICT_COMMENTS", "RESTRICT_POSTING"]);
/** Trend dışı bırakma / geri alma: sıralama kararı, bildirilmez (KV-21 karar 4); olay yine üretilir. */
const TREND_ACTIONS = new Set(["EXCLUDE_FROM_TRENDS", "INCLUDE_IN_TRENDS"]);
/** Yalnız yorumları kapatma / açma (KV-37): anketin görünürlüğünü etkilemez, bildirim üretmez; olay yine yazılır. */
const COMMENT_SWITCH_ACTIONS = new Set(["CLOSE_COMMENTS", "OPEN_COMMENTS"]);

export const notificationAdapters: Readonly<Partial<Record<EventType, NotificationAdapter>>> = Object.freeze({
  "comment.created": define({
    eventType: "comment.created",
    type: "COMMENT_ON_POLL",
    draft: (e) => draftOf(e, "COMMENT_ON_POLL", { subject: { type: "COMMENT", id: e.subject.id }, pollId: e.payload.pollId, actorId: e.actorId, data: {} }),
    recipients: (tx, e) => toPollAuthorOfComment(tx, e.subject.id),
  }),
  "comment.replied": define({
    eventType: "comment.replied",
    type: "REPLY_TO_COMMENT",
    draft: (e) =>
      draftOf(e, "REPLY_TO_COMMENT", { subject: { type: "COMMENT", id: e.subject.id }, pollId: e.payload.pollId, actorId: e.actorId, data: { parentId: e.payload.parentId } }),
    recipients: async (tx, e) => {
      const c = await commentOf(tx, e.subject.id);
      if (!c.parentAuthorId || c.parentId !== e.payload.parentId) throw new PermanentEventError(`cevabın üst yorumu tutmuyor: ${e.subject.id}`);
      if (!visible(c.status) || !visible(c.pollStatus)) return null;
      return { userIds: [c.parentAuthorId] };
    },
  }),
  "alternative.created": define({
    eventType: "alternative.created",
    type: "ALTERNATIVE_ON_POLL",
    draft: (e) => draftOf(e, "ALTERNATIVE_ON_POLL", { subject: { type: "COMMENT", id: e.subject.id }, pollId: e.payload.pollId, actorId: e.actorId, data: {} }),
    recipients: (tx, e) => toPollAuthorOfComment(tx, e.subject.id),
  }),
  "poll.milestone": define({
    eventType: "poll.milestone",
    type: "POLL_MILESTONE",
    // Yalnız KV-21 §4 eşikleri; üretici aynı listeyi (contracts POLL_MILESTONES) kullanır, listede olmayan eşik yok sayılır.
    draft: (e) =>
      POLL_MILESTONES.includes(e.payload.milestone)
        ? draftOf(e, "POLL_MILESTONE", { subject: { type: "POLL", id: e.subject.id }, pollId: e.subject.id, actorId: null, data: { metric: e.payload.metric, milestone: e.payload.milestone } })
        : null,
    recipients: (tx, e) => toPollAuthor(tx, e.subject.id),
  }),
  "poll.trending": define({
    eventType: "poll.trending",
    type: "POLL_TRENDING",
    // Katalogdaki doğal anahtar trend çalıştırması başınadır (5 dk); bildirim anket + format başına ömür boyu bir kez.
    draft: (e) =>
      draftOf(e, "POLL_TRENDING", {
        subject: { type: "POLL", id: e.subject.id },
        pollId: e.subject.id,
        actorId: null,
        data: { format: e.payload.format, rank: e.payload.rank },
        dedupeKey: `notifications:poll.trending:${e.subject.id}:${e.payload.format}`,
      }),
    recipients: (tx, e) => toPollAuthor(tx, e.subject.id),
  }),
  "poll.closed": define({
    eventType: "poll.closed",
    type: "POLL_CLOSED",
    draft: (e) => draftOf(e, "POLL_CLOSED", { subject: { type: "POLL", id: e.subject.id }, pollId: e.subject.id, actorId: e.actorId, data: { reason: e.payload.reason } }),
    // Bütün geçerli oy verenler + anket sahibi (karar 4). Anket sahibi kendi anketine oy veremez (KV_SELF_VOTE); verseydi
    // de aynı dedupe_key ile tek satır kalırdı. OWNER kapattığında sahip aktördür ve süzgeç onu düşürür.
    recipients: async (tx, e) => {
      const p = await pollOf(tx, e.subject.id);
      return visible(p.status) ? { userIds: [p.authorId], voters: { pollId: e.subject.id } } : null;
    },
  }),
  "decision.updated": define({
    eventType: "decision.updated",
    type: "DECISION_UPDATED",
    // Seçilen seçenek yazılmaz; yalnız ilk karar mı bilgisi.
    draft: (e) => draftOf(e, "DECISION_UPDATED", { subject: { type: "POLL", id: e.subject.id }, pollId: e.subject.id, actorId: e.actorId, data: { first: e.payload.first } }),
    recipients: async (tx, e) => {
      const p = await pollOf(tx, e.subject.id);
      return visible(p.status) ? { userIds: [], voters: { pollId: e.subject.id } } : null;
    },
  }),
  "moderation.applied": define({
    eventType: "moderation.applied",
    type: "MODERATION_APPLIED",
    // İçeriğin sahibine; moderatör gösterilmez. Görünürlük kuralı uygulanmaz (gizlenen içeriğin sahibi bilmeli).
    // Trend dışı bırakma / geri alma bildirilmez: trend oyunlamasına bilgi vermemek için (KV-21 karar 4).
    draft: (e) =>
      TREND_ACTIONS.has(e.payload.action) || COMMENT_SWITCH_ACTIONS.has(e.payload.action)
        ? null
        : draftOf(e, "MODERATION_APPLIED", {
            subject: { type: e.subject.type === "COMMENT" ? "COMMENT" : "POLL", id: e.subject.id },
            pollId: e.subject.type === "POLL" ? e.subject.id : null,
            actorId: null,
            data: { action: e.payload.action, toStatus: e.payload.toStatus },
          }),
    recipients: async (tx, e) => {
      if (e.subject.type === "POLL") return { userIds: [(await pollOf(tx, e.subject.id)).authorId] };
      const c = await commentOf(tx, e.subject.id);
      return { userIds: [c.authorId], pollId: c.pollId };
    },
  }),
  "community.featured": define({
    eventType: "community.featured",
    type: "COMMUNITY_FEATURED",
    // Yalnız anket sahibine; topluluk üyelerine bildirim yok (KV-21 §4). Öne çıkaran gösterilmez.
    draft: (e) =>
      draftOf(e, "COMMUNITY_FEATURED", { subject: { type: "POLL", id: e.subject.id }, pollId: e.subject.id, actorId: null, data: { communityId: e.payload.communityId } }),
    recipients: (tx, e) => toPollAuthor(tx, e.subject.id),
  }),
  "announcement.published": define({
    eventType: "announcement.published",
    type: "ANNOUNCEMENT_PUBLISHED",
    draft: (e) => draftOf(e, "ANNOUNCEMENT_PUBLISHED", {
      subject: { type: "ANNOUNCEMENT", id: e.subject.id },
      pollId: null, actorId: null, data: { level: e.payload.level },
    }),
    recipients: async (tx, e) => {
      const announcement = await tx.announcement.findUnique({ where: { id: e.subject.id } });
      const now = new Date();
      // Deletion, rescheduling or expiry before dispatch must not broadcast stale content.
      if (!announcement?.activatedAt || announcement.startsAt > now ||
          (announcement.endsAt && announcement.endsAt <= now)) return null;
      // ALL also appears to guests as a banner. Both audiences notify signed-in accounts;
      // anonymous visitors have no inbox or recipient identity.
      return { userIds: [], broadcast: true };
    },
  }),
  "sanction.applied": define({
    eventType: "sanction.applied",
    type: "SANCTION_APPLIED",
    // WARNING ve RESTRICT_* bildirilir; SUSPEND/BAN bildirilmez (kullanıcı girişte görür). Yönetici ve gerekçe yazılmaz.
    draft: (e) =>
      NOTIFIED_SANCTIONS.has(e.payload.type)
        ? draftOf(e, "SANCTION_APPLIED", { subject: { type: "USER", id: e.subject.id }, pollId: null, actorId: null, data: { sanctionType: e.payload.type, endsAt: e.payload.endsAt } })
        : null,
    recipients: async (_tx, e) => ({ userIds: [e.subject.id] }),
  }),
});

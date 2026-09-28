// KV-04 olay kataloğunun örnekleri: katalogdaki her tip için bir geçerli olay. Mock tüketiciler
// (KV-06) ve sözleşme testleri kullanır. Üretim verisi değildir.
import type { EventPayload, EventSubjectType, EventType } from "../src/events.ts";

const id = (n: number) => `0190f3a4-0000-7000-8000-${String(n).padStart(12, "0")}`;
const eventId = (n: number) => `0190f3a5-0000-7000-8000-${String(n).padStart(12, "0")}`;

const USER = id(1);
const ADMIN = id(2);
const POLL = id(3);
const OPTION_A = id(4);
const OPTION_B = id(5);
const COMMENT = id(6);
const PARENT = id(7);
const CATEGORY = id(8);
const COMMUNITY = id(9);
const REPORT = id(10);
const PLACEMENT = id(11);
const RUN = id(12);
const LEDGER = id(13);
const SANCTION = id(14);
const ANNOUNCEMENT = id(15);
const VOTE = id(16);
const MODERATION = id(17);
const T0 = "2026-09-28T12:00:00Z";
const T1 = "2026-10-05T12:00:00Z";

export type EventExample<T extends EventType = EventType> = {
  id: string;
  type: T;
  occurredAt: string;
  actorId: string | null;
  subject: { type: EventSubjectType; id: string };
  payload: EventPayload<T>;
};

let n = 0;
const ex = <T extends EventType>(type: T, actorId: string | null, subject: EventExample["subject"], payload: EventPayload<T>): EventExample<T> => ({
  id: eventId(++n),
  type,
  occurredAt: T0,
  actorId,
  subject,
  payload,
});

const poll = { type: "POLL", id: POLL } as const;
const user = { type: "USER", id: USER } as const;
const ledger = { ledgerEntryId: LEDGER, balanceAfter: 10, referenceId: null };

export const eventExamples: { [T in EventType]: EventExample<T> } = {
  "user.registered": ex("user.registered", USER, user, { shareId: null }),
  "poll.created": ex("poll.created", USER, poll, {
    kind: "POLL",
    categoryId: CATEGORY,
    communityId: null,
    optionCount: 2,
    imageCount: 0,
    durationHours: 72,
    resultsVisibility: "AFTER_VOTE",
    commentsEnabled: true,
  }),
  "poll.closed": ex("poll.closed", null, poll, { reason: "EXPIRED", closedAt: T0 }),
  "vote.submitted": ex("vote.submitted", ADMIN, poll, { optionId: OPTION_A, discoverySource: "organic" }),
  "vote.changed": ex("vote.changed", ADMIN, poll, { fromOptionId: OPTION_A, toOptionId: OPTION_B }),
  "vote.invalidated": ex("vote.invalidated", ADMIN, poll, { voteId: VOTE, voterId: USER, optionId: OPTION_A }),
  "comment.created": ex("comment.created", USER, { type: "COMMENT", id: COMMENT }, { pollId: POLL }),
  "comment.replied": ex("comment.replied", USER, { type: "COMMENT", id: COMMENT }, { pollId: POLL, parentId: PARENT }),
  "alternative.created": ex("alternative.created", USER, { type: "COMMENT", id: COMMENT }, { pollId: POLL }),
  "reaction.changed": ex("reaction.changed", USER, { type: "COMMENT", id: COMMENT }, { commentKind: "ALTERNATIVE", previous: null, value: "LIKE" }),
  "decision.updated": ex("decision.updated", USER, poll, { chosenOptionId: OPTION_B, first: true }),
  "poll.milestone": ex("poll.milestone", null, poll, { metric: "VOTES", milestone: 100 }),
  "poll.trending": ex("poll.trending", null, poll, { format: "DAILY_RISING", rank: 1, trendRunId: RUN }),
  "featured.applied": ex("featured.applied", ADMIN, poll, { placementId: PLACEMENT, surface: "HOME_SPOTLIGHT", scopeId: null, startsAt: T0, endsAt: T1 }),
  "community.featured": ex("community.featured", ADMIN, poll, { placementId: PLACEMENT, communityId: COMMUNITY, startsAt: T0, endsAt: T1 }),
  "moderation.applied": ex("moderation.applied", ADMIN, poll, {
    moderationActionId: MODERATION,
    action: "HIDE",
    fromStatus: "ACTIVE",
    toStatus: "HIDDEN",
    reportId: REPORT,
  }),
  "announcement.published": ex("announcement.published", ADMIN, { type: "ANNOUNCEMENT", id: ANNOUNCEMENT }, { level: "INFO", startsAt: T0, endsAt: null }),
  "report.created": ex("report.created", USER, { type: "REPORT", id: REPORT }, { targetType: "POLL", targetId: POLL, reason: "SPAM", communityId: COMMUNITY }),
  "report.resolved": ex("report.resolved", ADMIN, { type: "REPORT", id: REPORT }, { resolution: "ACTIONED", targetType: "POLL", targetId: POLL }),
  "points.granted": ex("points.granted", null, user, { ...ledger, delta: 20, balanceAfter: 20, reason: "INITIAL_GRANT" }),
  "points.debited": ex("points.debited", USER, user, { ...ledger, delta: -10, reason: "PUBLISH", referenceId: POLL }),
  "points.adjusted": ex("points.adjusted", ADMIN, user, { ...ledger, delta: 10, balanceAfter: 20, reason: "ADMIN_ADJUSTMENT" }),
  "sanction.applied": ex("sanction.applied", ADMIN, user, { sanctionId: SANCTION, type: "RESTRICT_COMMENTS", endsAt: T1 }),
  "sanction.lifted": ex("sanction.lifted", ADMIN, user, { sanctionId: SANCTION, type: "RESTRICT_COMMENTS" }),
  "role.changed": ex("role.changed", ADMIN, user, { previousRoles: ["USER"], roles: ["USER", "MODERATOR"] }),
  "settings.changed": ex("settings.changed", ADMIN, { type: "SETTING", id: "polls.voteChangeAllowed" }, { version: 4, public: true }),
};

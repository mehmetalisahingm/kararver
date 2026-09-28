// #64'teki (Mehmet) ortak yardımcılar. Export adları ve davranışları aynen korunur;
// sadece TypeScript'e taşındı. Bu yardımcılar endpoint yetkilendirmesinin yerine geçmez.
import { errorStatuses, type ErrorCode } from "./errors.ts";

export { errorStatuses };
export const contractVersion = "1.0";

export type ErrorDetail = { field?: string; code: string; message?: string };
export type ErrorResponseBody = { error: { code: ErrorCode; message: string; details: unknown[] }; requestId: string };

export function errorResponse(code: string, message: string, requestId: string, details: unknown[] = []): ErrorResponseBody {
  if (
    !Object.hasOwn(errorStatuses, code) ||
    typeof message !== "string" ||
    !message ||
    typeof requestId !== "string" ||
    !requestId ||
    !Array.isArray(details)
  ) {
    throw new TypeError("Invalid error contract");
  }
  return { error: { code: code as ErrorCode, message, details }, requestId };
}

export type PageBody<T> = { data: T[]; page: { nextCursor: string | null; hasMore: boolean } };

export function pageResponse<T>(items: T[], nextCursor: string | null = null): PageBody<T> {
  if (!Array.isArray(items) || (nextCursor !== null && (typeof nextCursor !== "string" || !nextCursor))) {
    throw new TypeError("Invalid cursor page");
  }
  return { data: items, page: { nextCursor, hasMore: nextCursor !== null } };
}

export type ResultsProjection =
  | { visible: false }
  | { visible: true; total: number; options: { id: string; votes: number; percent: number }[] };

// Construct the public result projection explicitly; never spread a DB object.
export function pollResults({
  visible,
  total,
  options,
}: {
  visible: boolean;
  total?: number;
  options?: { id: string; votes: number }[];
}): ResultsProjection {
  if (typeof visible !== "boolean") throw new TypeError("Visibility must be explicit");
  if (!visible) return { visible: false };
  if (
    !Number.isSafeInteger(total) ||
    (total as number) < 0 ||
    !Array.isArray(options) ||
    options.some((o) => typeof o.id !== "string" || !Number.isSafeInteger(o.votes) || o.votes < 0) ||
    new Set(options.map((o) => o.id)).size !== options.length ||
    options.reduce((sum, o) => sum + o.votes, 0) !== total
  ) {
    throw new TypeError("Inconsistent vote totals");
  }
  const sum = total as number;
  return {
    visible: true,
    total: sum,
    options: options.map((o) => ({
      id: o.id,
      votes: o.votes,
      percent: sum === 0 ? 0 : Math.round((o.votes * 10000) / sum) / 100,
    })),
  };
}

// Domain olay tipleri. #64'teki ilk 12 tip korunur; sonrakiler KV-03'te eklendi.
// Olay listesinin nihai sahibi KV-04'tür (Utku); ekleme kırıcı değildir.
export const eventTypes: ReadonlySet<string> = new Set([
  "user.registered",
  "poll.created",
  "poll.closed",
  "vote.submitted",
  "comment.created",
  "alternative.created",
  "decision.updated",
  "poll.milestone",
  "poll.trending",
  "community.featured",
  "moderation.applied",
  "announcement.published",
  // KV-03 eklemeleri
  "vote.changed",
  "comment.replied",
  "reaction.changed",
  "report.created",
  "points.granted",
  "points.debited",
  "points.adjusted",
  // KV-04 eklemeleri (katalog: events.ts)
  "vote.invalidated",
  "report.resolved",
  "sanction.applied",
  "sanction.lifted",
  "role.changed",
  "settings.changed",
  "featured.applied",
]);

export type EventEnvelope = {
  version: 1;
  id: string;
  type: string;
  occurredAt: string;
  actorId: string | null;
  subject: { type: string; id: string };
  payload: Record<string, unknown>;
};

/**
 * #64 zarf kurucusu; yalnız zarfı doğrular (payload serbest, id/subject biçimi gevşek).
 * Geriye uyumluluk için korunur. **Yeni kod `createEvent` kullanır** (events.ts): payload
 * şeması, UUIDv7 ve konu tipi outbox'a yazma anında doğrulanır.
 */
export function eventEnvelope({
  id,
  type,
  occurredAt,
  actorId = null,
  subject,
  payload = {},
}: {
  id: string;
  type: string;
  occurredAt: string;
  actorId?: string | null;
  subject: { type: string; id: string };
  payload?: Record<string, unknown>;
}): EventEnvelope {
  if (
    typeof id !== "string" ||
    !id ||
    !eventTypes.has(type) ||
    typeof occurredAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(occurredAt) ||
    !Number.isFinite(Date.parse(occurredAt)) ||
    (actorId !== null && (typeof actorId !== "string" || !actorId)) ||
    !subject ||
    typeof subject.type !== "string" ||
    !subject.type ||
    typeof subject.id !== "string" ||
    !subject.id ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new TypeError("Invalid domain event");
  }
  return { version: 1, id, type, occurredAt, actorId, subject: { type: subject.type, id: subject.id }, payload };
}

export const roles = Object.freeze(["USER", "MODERATOR", "ADMIN", "SUPER_ADMIN"] as const);
export type Role = (typeof roles)[number];

// Reference predicate for contract tests. Production must load trusted role and
// resource community from the database, never from request body claims.
export function canModerate(
  { role, status, communityIds = [] }: { role: string; status: string; communityIds?: string[] },
  resource?: { communityId?: unknown } | null,
): boolean {
  if (status !== "ACTIVE" || !(roles as readonly string[]).includes(role)) return false;
  if (role === "ADMIN" || role === "SUPER_ADMIN") return true;
  return role === "MODERATOR" && typeof resource?.communityId === "string" && communityIds.includes(resource.communityId);
}

/**
 * AFTER_VOTE gizli sonuç kuralı (docs/API_CONTRACTS.md §4.4). Anket sahibi de bu kurala tabidir.
 * Geçersiz sayılmış oy "oy yok" kabul edilir.
 */
export function resultsVisibleTo({
  resultsVisibility,
  closed,
  viewerHasValidVote,
}: {
  resultsVisibility: "ALWAYS" | "AFTER_VOTE";
  closed: boolean;
  viewerHasValidVote: boolean;
}): boolean {
  return resultsVisibility === "ALWAYS" || closed || viewerHasValidVote;
}

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
 * AFTER_VOTE gizli sonuç kuralı (docs/API_CONTRACTS.md §4.4).
 * Anket sahibi oy veremediği için (SELF_VOTE_FORBIDDEN) sonuçları her zaman görür.
 * Geçersiz sayılmış oy "oy yok" kabul edilir.
 * viewerIsAuthor sunucuda oturum kullanıcısı ile DB'deki authorId karşılaştırılarak hesaplanır.
 */
export function resultsVisibleTo({
  resultsVisibility,
  closed,
  viewerHasValidVote,
  viewerIsAuthor,
}: {
  resultsVisibility: "ALWAYS" | "AFTER_VOTE";
  closed: boolean;
  viewerHasValidVote: boolean;
  viewerIsAuthor: boolean;
}): boolean {
  return resultsVisibility === "ALWAYS" || closed || viewerIsAuthor || viewerHasValidVote;
}

/** İzleyicinin oy verememe sebebi; öncelik sırası bu dizinin sırasıdır (ilk uyan döner). */
export const voteBlockedReasons = Object.freeze([
  "NOT_A_POLL",
  "OWN_POLL",
  "POLL_CLOSED",
  "CONTENT_LOCKED",
  "ACCOUNT_RESTRICTED",
  "EMAIL_NOT_VERIFIED",
  "VOTE_INVALIDATED",
  "VOTE_CHANGE_DISABLED",
] as const);
export type VoteBlockedReason = (typeof voteBlockedReasons)[number];

/**
 * Oturumlu izleyici için oy durumu (misafirde viewer null'dır; UI giriş ister).
 * Sağlayıcı (KV-11) ve contract testleri aynı kuralı kullanır; PUT /vote'un hata sırası da budur.
 */
export function voteAvailability(input: {
  kind: "POLL" | "DISCUSSION";
  viewerIsAuthor: boolean;
  closed: boolean;
  contentStatus: "ACTIVE" | "LOCKED";
  accountRestricted: boolean;
  emailVerified: boolean;
  voteInvalidated: boolean;
  hasVote: boolean;
  voteChangeAllowed: boolean;
}): { canVote: boolean; voteBlockedReason: VoteBlockedReason | null } {
  const blocked: Record<VoteBlockedReason, boolean> = {
    NOT_A_POLL: input.kind !== "POLL",
    OWN_POLL: input.viewerIsAuthor,
    POLL_CLOSED: input.closed,
    CONTENT_LOCKED: input.contentStatus === "LOCKED",
    ACCOUNT_RESTRICTED: input.accountRestricted,
    EMAIL_NOT_VERIFIED: !input.emailVerified,
    VOTE_INVALIDATED: input.voteInvalidated,
    VOTE_CHANGE_DISABLED: input.hasVote && !input.voteChangeAllowed,
  };
  const reason = voteBlockedReasons.find((r) => blocked[r]) ?? null;
  return { canVote: reason === null, voteBlockedReason: reason };
}

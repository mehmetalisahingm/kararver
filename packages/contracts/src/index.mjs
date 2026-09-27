// Shared v1 wire contracts. These helpers do not replace endpoint authorization.
export const contractVersion = '1.0';
export const errorStatuses = Object.freeze({
  VALIDATION_ERROR: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403,
  NOT_FOUND: 404, CONFLICT: 409, POLL_CLOSED: 409,
  CONTENT_LOCKED: 409, RATE_LIMITED: 429, INTERNAL_ERROR: 500,
});
export function errorResponse(code, message, requestId, details = []) {
  if (!(Object.hasOwn(errorStatuses, code)) || typeof message !== 'string' || !message ||
      typeof requestId !== 'string' || !requestId || !Array.isArray(details)) {
    throw new TypeError('Invalid error contract');
  }
  return { error: { code, message, details }, requestId };
}
export function pageResponse(items, nextCursor = null) {
  if (!Array.isArray(items) || (nextCursor !== null && (typeof nextCursor !== 'string' || !nextCursor))) {
    throw new TypeError('Invalid cursor page');
  }
  return { data: items, page: { nextCursor, hasMore: nextCursor !== null } };
}

// Construct the public result projection explicitly; never spread a DB object.
export function pollResults({ visible, total, options }) {
  if (typeof visible !== 'boolean') throw new TypeError('Visibility must be explicit');
  if (!visible) return { visible: false };
  if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(options) ||
      options.some(o => typeof o.id !== 'string' || !Number.isSafeInteger(o.votes) || o.votes < 0) ||
      new Set(options.map(o => o.id)).size !== options.length ||
      options.reduce((sum, o) => sum + o.votes, 0) !== total) {
    throw new TypeError('Inconsistent vote totals');
  }
  return { visible: true, total, options: options.map(o => ({
    id: o.id, votes: o.votes, percent: total === 0 ? 0 : Math.round(o.votes * 10000 / total) / 100,
  })) };
}
const eventTypes = new Set([
  'user.registered', 'poll.created', 'poll.closed', 'vote.submitted',
  'comment.created', 'alternative.created', 'decision.updated',
  'poll.milestone', 'poll.trending', 'community.featured',
  'moderation.applied', 'announcement.published',
]);
export function eventEnvelope({ id, type, occurredAt, actorId = null, subject, payload = {} }) {
  if (typeof id !== 'string' || !id || !eventTypes.has(type) ||
      typeof occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(occurredAt) || !Number.isFinite(Date.parse(occurredAt)) ||
      (actorId !== null && (typeof actorId !== 'string' || !actorId)) ||
      !subject || typeof subject.type !== 'string' || !subject.type || typeof subject.id !== 'string' || !subject.id ||
      !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Invalid domain event');
  }
  return { version: 1, id, type, occurredAt, actorId, subject: { type: subject.type, id: subject.id }, payload };
}

export const roles = Object.freeze(['USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN']);
// Reference predicate for contract tests. Production must load trusted role and
// resource community from the database, never from request body claims.
export function canModerate({ role, status, communityIds = [] }, resource) {
  if (status !== 'ACTIVE' || !roles.includes(role)) return false;
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') return true;
  return role === 'MODERATOR' && typeof resource?.communityId === 'string' &&
    communityIds.includes(resource.communityId);
}

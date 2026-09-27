import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canModerate, errorResponse, pageResponse, pollResults, eventEnvelope } from '../src/index.ts';

test('hidden result projection cannot leak vote counts or nested internal data', () => {
  const response = pollResults({ visible: false, total: 123, options: [{ id: 'a', votes: 123, voterIds: ['secret'] }] });
  assert.deepEqual(JSON.parse(JSON.stringify(response)), { visible: false });
});
test('public results handle zero votes and project only allowed fields', () => {
  assert.deepEqual(pollResults({ visible: true, total: 0, options: [{ id: 'a', votes: 0, voterIds: ['secret'] }] }),
    { visible: true, total: 0, options: [{ id: 'a', votes: 0, percent: 0 }] });
  assert.throws(() => pollResults({ visible: true, total: 1, options: [{ id: 'a', votes: 2 }] }));
  assert.throws(() => pollResults({ visible: 'false', total: 1, options: [] }));
});
test('community moderation cannot cross resource scope or use a suspended admin', () => {
  const moderator = { role: 'MODERATOR', status: 'ACTIVE', communityIds: ['a'] };
  assert.equal(canModerate(moderator, { communityId: 'a' }), true);
  assert.equal(canModerate(moderator, { communityId: 'b' }), false);
  assert.equal(canModerate(moderator, {}), false);
  assert.equal(canModerate({ role: 'ADMIN', status: 'SUSPENDED' }, {}), false);
  assert.equal(canModerate({ role: 'USER', status: 'ACTIVE' }, { communityId: 'a' }), false);
});
test('pagination has an explicit end and cannot accept an empty cursor', () => {
  assert.deepEqual(pageResponse([]), { data: [], page: { nextCursor: null, hasMore: false } });
  assert.equal(pageResponse([], 'next').page.hasMore, true);
  assert.throws(() => pageResponse([], ''));
});
test('error codes and event versions are stable and malformed events fail', () => {
  assert.equal(errorResponse('FORBIDDEN', 'Yetki yok', 'request-1').error.code, 'FORBIDDEN');
  assert.throws(() => errorResponse('UNKNOWN', 'x', 'request-1'));
  const input = { id: 'event-1', type: 'poll.closed', occurredAt: '2026-09-27T12:00:00Z', subject: { type: 'poll', id: 'poll-1' } };
  assert.equal(eventEnvelope(input).version, 1);
  assert.throws(() => eventEnvelope({ ...input, type: 'typo' }));
  assert.throws(() => eventEnvelope({ ...input, occurredAt: 'invalid' }));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { APPEAL_WINDOW_MS, appealWindow, filedInTime } from "../src/modules/moderation/appeal-window.ts";

const deliveredAt = new Date("2026-11-08T15:00:00.000Z");
test("appeal countdown is exactly 30 days from notice inbox DELIVERY, never the rejection time", () => {
  const deadlineAt = new Date(deliveredAt.getTime() + APPEAL_WINDOW_MS);
  assert.equal(deadlineAt.toISOString(), "2026-12-08T15:00:00.000Z");
  const beforeDelivery = new Date(deliveredAt.getTime() - 1);
  assert.deepEqual(appealWindow(deliveredAt, beforeDelivery), { state: "NOT_DELIVERED", deadlineAt: null });
  assert.equal(filedInTime(deliveredAt, beforeDelivery), false);
  assert.deepEqual(appealWindow(deliveredAt, new Date(deliveredAt)), { state: "OPEN", deadlineAt });
  assert.equal(filedInTime(deliveredAt, new Date(deliveredAt)), true);
  assert.deepEqual(appealWindow(deliveredAt, deadlineAt), { state: "OPEN", deadlineAt });
  assert.deepEqual(appealWindow(deliveredAt, new Date(deadlineAt.getTime() + 1)), { state: "EXPIRED", deadlineAt });
});
test("a queued, sent, failed or undelivered rejection notice has NO invented appeal deadline", () => {
  assert.deepEqual(appealWindow(null, new Date("2045-01-01T00:00:00Z")), { state: "NOT_DELIVERED", deadlineAt: null });
  assert.equal(filedInTime(null, deliveredAt), false, "requires receipt, not an inferred start time");
});
test("filing timestamp, not moderator resolution timestamp, determines lateness", () => {
  const timely = new Date(deliveredAt.getTime() + APPEAL_WINDOW_MS - 1);
  assert.equal(filedInTime(deliveredAt, timely), true);
  assert.equal(filedInTime(deliveredAt, new Date(timely.getTime() + 2)), false);
});
test("invalid clocks are not silently coerced to late or on-time", () => {
  assert.throws(() => appealWindow(new Date("invalid"), deliveredAt), RangeError);
  assert.throws(() => appealWindow(deliveredAt, new Date("invalid")), RangeError);
});

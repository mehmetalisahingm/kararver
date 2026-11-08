import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appealResolutionDueAt, appealResolutionUrgency,
  summarizeAppealWorkload, APPEAL_RESOLUTION_TARGET_MS,
} from "../src/modules/moderation/appeal-resolution-sla.ts";

const submittedAt = new Date("2026-11-08T15:00:00.000Z");
const at = (delta: number) => new Date(submittedAt.getTime() + delta);
const open = (atTime = submittedAt, status: "OPEN" | "IN_REVIEW" | "RESOLVED" = "OPEN") =>
  ({ submittedAt: atTime, status, resolvedAt: status === "RESOLVED" ? submittedAt : null });

test("V1 moderation appeal 14 calendar day resolution target starts from case SUBMISSION, not rejection/notification", () => {
  assert.equal(APPEAL_RESOLUTION_TARGET_MS, 14 * 24 * 60 * 60 * 1000);
  assert.equal(appealResolutionDueAt(submittedAt).toISOString(), "2026-11-22T15:00:00.000Z");
  assert.equal(appealResolutionUrgency(open(), at(12 * 24 * 60 * 60 * 1000 - 1)), "OPEN");
  assert.equal(appealResolutionUrgency(open(), at(12 * 24 * 60 * 60 * 1000)), "DUE_SOON");
  assert.equal(appealResolutionUrgency(open(), at(APPEAL_RESOLUTION_TARGET_MS)), "DUE_SOON",
    "the exact last instant is still within the target");
  assert.equal(appealResolutionUrgency(open(), at(APPEAL_RESOLUTION_TARGET_MS + 1)), "OVERDUE");
});

test("overdue cases stay OPEN / IN_REVIEW, never change outcome, status, content or points", () => {
  const existing = open(submittedAt, "IN_REVIEW");
  assert.equal(appealResolutionUrgency(existing, at(35 * 24 * 60 * 60 * 1000)), "OVERDUE");
  assert.equal(existing.status, "IN_REVIEW", "pure urgency is advisory, not a mutation");
  assert.equal(existing.resolvedAt, null);
  assert.equal(appealResolutionUrgency(open(submittedAt, "RESOLVED"), at(60 * 24 * 60 * 60 * 1000)), "RESOLVED");
});

test("moderator queue workload is aggregate-only and prioritizes urgent cases without exposing narratives", () => {
  const now = at(APPEAL_RESOLUTION_TARGET_MS + 1000);
  const cases = [
    open(submittedAt), // overdue
    open(at(4 * 24 * 60 * 60 * 1000)), // still in target
    open(at(3 * 24 * 60 * 60 * 1000), "IN_REVIEW"), // still in target
    open(submittedAt, "RESOLVED"),
  ];
  const summary = summarizeAppealWorkload(cases, now);
  assert.deepEqual(summary, {
    open: 3, dueSoon: 0, overdue: 1, resolved: 1, oldestUnresolvedAt: submittedAt,
  });
  assert.equal(Object.keys(summary).some(k => /email|userId|reason|text|actor/i.test(k)), false);
});

test("bad timestamps fail rather than giving a fake deadline", () => {
  assert.throws(() => appealResolutionDueAt(new Date("invalid")), RangeError);
  assert.throws(() => appealResolutionUrgency(open(), new Date("invalid")), RangeError);
});

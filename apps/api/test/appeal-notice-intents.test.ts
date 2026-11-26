import assert from "node:assert/strict";
import { test } from "node:test";
import { appealNoticeIntent, appealReminderCandidate } from "../src/modules/moderation/appeal-notice-intents.ts";

test("14-day resolution notice intents use staff-only escalation and stable dedupe keys", () => {
  const id = "01999888-0000-7000-8000-000000000003";
  const due = appealNoticeIntent("APPEAL_DUE_SOON_STAFF", id);
  const over = appealNoticeIntent("APPEAL_OVERDUE_STAFF", id);
  assert.equal(due.audience, "AUTHORIZED_STAFF");
  assert.equal(over.audience, "AUTHORIZED_STAFF");
  assert.equal(due.dedupeKey, `appeal:${id}:APPEAL_DUE_SOON_STAFF`);
  assert.deepEqual(appealNoticeIntent("APPEAL_DUE_SOON_STAFF", id), due);
  assert.match(over.message, /otomatik karar vermeyin/);
});

test("user received and decision messages do not expose rejection content or moderator identity", () => {
  const id = "01999888-0000-7000-8000-000000000003";
  const kinds = ["APPEAL_RECEIVED", "APPEAL_RESOLVED_ACCEPTED", "APPEAL_RESOLVED_REJECTED"] as const;
  for (const kind of kinds) {
    const intent = appealNoticeIntent(kind, id);
    assert.equal(intent.audience, "APPELLANT");
    assert.deepEqual(Object.keys(intent).sort(), ["audience", "caseId", "dedupeKey", "kind", "message"]);
    assert.doesNotMatch(intent.message, /e-?posta|hastalık|siyasi görüş|moderator id|gizli/i);
  }
});


test("reminder candidates use filing time, suppress erased/resolved cases and keep stable per-stage dedupe", () => {
  const id = "01999888-0000-7000-8000-000000000003";
  const filedAt = new Date("2026-11-08T15:00:00.000Z");
  const day = 86400000;
  const row = { rejectionActionId: id, submittedAt: filedAt, status: "OPEN" as const, resolvedAt: null, erased: false };
  const at = (ms: number) => new Date(filedAt.getTime() + ms);
  assert.equal(appealReminderCandidate(row, at(12*day - 1)), null);
  const due = appealReminderCandidate(row, at(12*day));
  assert.equal(due?.kind, "APPEAL_DUE_SOON_STAFF");
  assert.deepEqual(appealReminderCandidate(row, at(14*day)), due);
  const overdue = appealReminderCandidate(row, at(14*day+1));
  assert.equal(overdue?.kind, "APPEAL_OVERDUE_STAFF");
  assert.notEqual(overdue?.dedupeKey, due?.dedupeKey);
  assert.deepEqual(appealReminderCandidate(row, at(20*day)), overdue);
  assert.equal(appealReminderCandidate({...row, erased:true}, at(20*day)), null);
  assert.equal(appealReminderCandidate({...row, status:"RESOLVED", resolvedAt:at(10*day)}, at(20*day)), null);
  assert.equal(row.status, "OPEN");
});

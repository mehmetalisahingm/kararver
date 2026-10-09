import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateBeta } from "./beta-report.mjs";

const I = "2026-10-01T12:00:00.000Z";
const A = "2026-10-02T12:00:00.000Z";
const START = "2026-10-03T12:00:00.000Z";
const TODAY = "2026-10-11T12:00:00.000Z";

const user = (id = "BETA-001", rest = {}) => ({
  participantId: id,
  segment: "new_user",
  invitedAt: I,
  consentedAt: "2026-10-01T13:00:00.000Z",
  acceptedAt: A,
  activatedAt: START,
  activityDatesUtc: ["2026-10-03", "2026-10-04", "2026-10-10"],
  firstActions: { vote: START },
  withdrawnAt: null,
  ...rest,
});
const task = (overrides = {}) => ({
  participantId: "BETA-001", caseId: "B01", result: "PASS", assisted: false,
  observedAt: "2026-10-03T16:00:00.000Z", ...overrides,
});
const bug = (overrides = {}) => ({
  id: "BETA-BUG-001", severity: "P2", state: "OPEN",
  owner: "test-user", issueUrl: "https://github.com/example/project/issues/123",
  ...overrides,
});

test("empty beta is NOT a fabricated success; D1/D7 are N/A", () => {
  const r = aggregateBeta([], [], [], TODAY);
  assert.deepEqual(r.actual, { invited: 0, accepted: 0, activated: 0, withdrawn: 0 });
  assert.equal(r.status, "GATED_NO_AUTOMATIC_GO");
  assert.equal(r.retention.D7.rate, null);
  assert.equal(r.requirements.invitationTargetMet, false);
  assert.equal(r.requirements.hasD7MatureCohort, false);
  assert.equal(r.requirements.manualSecurityApprovalRequired, true);
});

test("invite, acceptance, activation and actual first action are separate", () => {
  const r = aggregateBeta([user(), user("BETA-002", {
    segment: "creator", consentedAt: null, acceptedAt: null,
    activatedAt: null, firstActions: {}, activityDatesUtc: [],
  })], [task()], [], TODAY);
  assert.deepEqual(r.actual, { invited: 2, accepted: 1, activated: 1, withdrawn: 0 });
  assert.equal(r.funnel.acceptanceRate, 50);
  assert.equal(r.firstActions.vote, 1);
  assert.equal(r.firstActions.poll, 0);
  assert.equal(r.tasks.assistanceRate, 0);
});

test("D1/D7 only count matured activation cohorts with exact UTC return date", () => {
  const r = aggregateBeta([
    user(),
    user("BETA-002", { segment: "social", invitedAt: "2026-10-08T01:00:00.000Z",
      consentedAt: "2026-10-08T02:00:00.000Z", acceptedAt: "2026-10-08T03:00:00.000Z",
      activatedAt: "2026-10-09T01:00:00.000Z", activityDatesUtc: ["2026-10-09", "2026-10-10"], firstActions: {},
    }),
  ], [task()], [], TODAY);
  assert.equal(r.retention.D1.mature, 2);
  assert.equal(r.retention.D1.returned, 2);
  assert.equal(r.retention.D1.rate, 100);
  assert.equal(r.retention.D7.mature, 1);
  assert.equal(r.retention.D7.returned, 1);
  assert.equal(r.retention.D7.rate, 100);
});

test("task attempts, assistance and failed/blocked are counted transparently", () => {
  const r = aggregateBeta([user()], [
    task({ assisted: true }), task({ caseId: "B02", result: "FAIL" }),
    task({ caseId: "B03", result: "BLOCKED", assisted: false }),
  ], [bug({ severity: "P1", state: "FIXED" })], TODAY);
  assert.equal(r.tasks.attempted, 2);
  assert.equal(r.tasks.completed, 1);
  assert.equal(r.tasks.assisted, 1);
  assert.equal(r.tasks.assistanceRate, 50);
  assert.equal(r.tasks.scenarios.B03.blocked, 1);
  assert.equal(r.bugs.criticalOrHighOpen, 1); // FIXED needs independent regression verification.
});

test("verified P0/P1 is no longer a release-blocking open issue", () => {
  const r = aggregateBeta([], [], [bug({ severity: "P0", state: "VERIFIED" })], TODAY);
  assert.equal(r.bugs.criticalOrHighOpen, 0);
});

test("reject personally identifying fields before reporting", () => {
  assert.throws(() => aggregateBeta([user("BETA-001", { email: "test@example.com" })], [], [], TODAY), /forbidden field/);
  assert.throws(() => aggregateBeta([user("test@example.com")], [], [], TODAY), /unique pseudonym/);
  assert.throws(() => aggregateBeta([user("BETA-001"), user("BETA-001")], [], [], TODAY), /unique pseudonym/);
});

test("reject missing explicit consent and impossible timelines", () => {
  assert.throws(() => aggregateBeta([user("BETA-001", { consentedAt: null })], [], [], TODAY), /prior explicit consent/);
  assert.throws(() => aggregateBeta([user("BETA-001", { acceptedAt: I })], [], [], TODAY), /prior explicit consent/);
  assert.throws(() => aggregateBeta([user("BETA-001", { invitedAt: "2027-10-01T00:00:00.000Z" })], [], [], TODAY), /earlier than invitation|future|predates|consent/);
});

test("reject invalid task association, duplicate case and unsafe bug URL", () => {
  assert.throws(() => aggregateBeta([user()], [task({ participantId: "BETA-999" })], [], TODAY), /non-activated/);
  assert.throws(() => aggregateBeta([user()], [task(), task()], [], TODAY), /duplicate participant-case/);
  assert.throws(() => aggregateBeta([user()], [], [bug({ issueUrl: "https://example.com/?email=person@example.com" })], TODAY), /GitHub issue/);
});

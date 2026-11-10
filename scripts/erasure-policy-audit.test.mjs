import assert from "node:assert/strict";
import test from "node:test";
import { ERASURE_GATES, inspectErasureSources, scanCurrentRepository } from "./erasure-policy-audit.mjs";

test("current V1 implementation is explicitly NO-GO for strict erasure policy", () => {
  const result = scanCurrentRepository();
  assert.equal(result.readyForPublicGo, false);
  assert.equal(result.manuallyVerified, false);
  assert.deepEqual(result.blockers.map(g => g.id), ERASURE_GATES.map(g => g.id),
    "Known V1 gaps must remain visible until the real migration/cleanup/retention proof is implemented");
});

test("readiness is never inferred from missing or renamed code", () => {
  const result = inspectErasureSources({});
  assert.equal(result.readyForPublicGo, false);
  assert.equal(result.manuallyVerified, false);
  assert.ok(result.blockers.length > 0, "Legal/restore proof absence still blocks release");
});

test("erasure gate is read-only and every blocker has an owner", () => {
  for (const gate of ERASURE_GATES) {
    assert.ok(gate.id && gate.owner && gate.detail);
    assert.doesNotMatch(gate.detail, /@|password|token/i, "No PII or secrets in public blocker strings");
  }
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createTotpSecret, decodeBase32, encodeBase32, hotp, matchTotpStep, totpEnrollmentUri } from "../src/modules/security/totp.ts";
import { canApproveRoleChange, type ApprovalContext, type PendingRoleApproval } from "../src/modules/security/critical-approval.ts";

describe("SA #180 TOTP RFC 6238", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // RFC test key ASCII "12345678901234567890"
  test("RFC 6238 SHA1 vectors and 6-digit profile", () => {
    assert.equal(hotp(decodeBase32(secret), 1, 8), "94287082");
    assert.equal(hotp(decodeBase32(secret), 1), "287082");
    assert.equal(hotp(decodeBase32(secret), Math.floor(1111111109 / 30), 8), "07081804");
  });
  test("secret generation has >=128 bit entropy; base32 canonical roundtrip", () => {
    const key = createTotpSecret();
    assert.equal(decodeBase32(key).length, 20);
    assert.equal(encodeBase32(decodeBase32(key)), key);
    assert.match(totpEnrollmentUri(key, "test@example.invalid"), /digits=6&period=30/);
  });
  test("rejects malformed, weak and noncanonical secrets", () => {
    assert.throws(() => decodeBase32("!") );
    assert.throws(() => decodeBase32("AAAA") );
    assert.throws(() => decodeBase32("A".repeat(27) + "B") );
  });
  test("clock skew bounded and accepted counter replay forbidden", () => {
    assert.equal(matchTotpStep({ base32Secret: secret, code: "287082", nowMs: 59000, lastAcceptedStep: -1 }), 1);
    assert.equal(matchTotpStep({ base32Secret: secret, code: "287082", nowMs: 89000, lastAcceptedStep: -1 }), 1);
    assert.equal(matchTotpStep({ base32Secret: secret, code: "287082", nowMs: 59000, lastAcceptedStep: 1 }), null);
    assert.equal(matchTotpStep({ base32Secret: secret, code: "287082", nowMs: 119000, lastAcceptedStep: -1 }), null);
    assert.equal(matchTotpStep({ base32Secret: secret, code: "287082 ", nowMs: 59000, lastAcceptedStep: -1 }), null);
  });
});

describe("SA #182 independent role approval policy", () => {
  const now = 1000000;
  const approval: PendingRoleApproval = {
    status: "PENDING", initiatorId: "u1", targetUserId: "u3",
    expectedRole: "USER", requestedRole: "SUPER_ADMIN", baseRevision: "r7",
    createdAtMs: now - 60000, expiresAtMs: now + 300000, approverIds: [],
  };
  const ctx: ApprovalContext = {
    approverId: "u2", approverHasFreshSuperAdminRole: true,
    stepUpAtMs: now - 30000, targetUserId: "u3", currentRole: "USER",
    requestedRole: "SUPER_ADMIN", currentRevision: "r7", nowMs: now,
  };
  const reason = (a: PendingRoleApproval, c: ApprovalContext) => {
    const result = canApproveRoleChange(a, c);
    assert.equal(result.allowed, false);
    return result.allowed ? "" : result.reason;
  };
  test("unrelated, self, duplicate, stale and demoted approvers denied", () => {
    assert.deepEqual(canApproveRoleChange(approval, ctx), { allowed: true });
    assert.equal(reason(approval, { ...ctx, approverId: "u1" }), "self_approval");
    assert.equal(reason({ ...approval, approverIds: ["u2"] }, ctx), "duplicate");
    assert.equal(reason(approval, { ...ctx, approverHasFreshSuperAdminRole: false }), "role_required");
    assert.equal(reason(approval, { ...ctx, currentRevision: "r8" }), "invalid_context");
    assert.equal(reason(approval, { ...ctx, targetUserId: "other" }), "invalid_context");
    assert.equal(reason(approval, { ...ctx, requestedRole: "ADMIN" }), "invalid_context");
    assert.equal(reason({ ...approval, status: "CONSUMED" }, ctx), "closed");
    assert.equal(reason({ ...approval, expiresAtMs: now }, ctx), "expired");
    assert.equal(reason(approval, { ...ctx, stepUpAtMs: null }), "stepup_required");
    assert.equal(reason(approval, { ...ctx, stepUpAtMs: now - 301000 }), "stepup_required");
    assert.equal(reason(approval, { ...ctx, stepUpAtMs: now + 1000 }), "stepup_required");
  });
});

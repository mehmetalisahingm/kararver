// #185 audit sonuç süzgeci: (işlem, tür) → sonuç eşlemesi. DB gerektirmez.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  AuditOutcome,
  allowedAuditOperations,
  auditOperations,
  auditOutcomeOf,
  auditOutcomeOverrides,
  auditOutcomePairs,
  systemAuditActions,
  type AuditAction,
} from "../src/index.ts";

const allPairs = (): [AuditAction, string][] =>
  [...(Object.keys(auditOperations) as AuditAction[]), ...systemAuditActions].flatMap((a) =>
    allowedAuditOperations(a).map((op): [AuditAction, string] => [a, op]),
  );

describe("auditOutcomeOf", () => {
  test("eşlemedeki her çift izinli bir (işlem, tür)", () => {
    for (const [action, ops] of Object.entries(auditOutcomeOverrides)) {
      for (const op of Object.keys(ops!)) assert.ok(allowedAuditOperations(action as AuditAction).includes(op), `${action}/${op}`);
    }
  });

  test("olumsuz adlı her tür sınıflanmış; unutulan yeni tür APPLIED görünmez", () => {
    const negative = /^(deny|reject|dismissed|cancel|expire)$/;
    for (const [action, op] of allPairs()) {
      if (negative.test(op)) assert.notEqual(auditOutcomeOf(action, op), "APPLIED", `${action}/${op} sonuç eşlemesinde yok`);
    }
  });

  test("tür adı tek başına belirlemez: moderasyon kilidi uygulanmış, MFA kilidi engellenmiş", () => {
    assert.equal(auditOutcomeOf("moderation.poll.apply", "lock"), "APPLIED");
    assert.equal(auditOutcomeOf("account.mfa", "lock"), "DENIED");
    assert.equal(auditOutcomeOf("account.mfa", "verify"), "APPLIED");
    assert.equal(auditOutcomeOf("report.resolve", "dismissed"), "REJECTED");
    assert.equal(auditOutcomeOf("moderation.bulk.expire", "expire"), "CANCELLED");
  });

  test("bilinmeyen veya prototip adı APPLIED döner, hata vermez", () => {
    assert.equal(auditOutcomeOf("legacy.action", "deny"), "APPLIED");
    assert.equal(auditOutcomeOf("account.mfa", "toString"), "APPLIED");
    assert.equal(auditOutcomeOf("__proto__", "deny"), "APPLIED");
  });

  test("auditOutcomePairs her sonucu eksiksiz ve örtüşmeden kapsar", () => {
    const seen = new Set<string>();
    for (const outcome of AuditOutcome.options.filter((o) => o !== "APPLIED")) {
      for (const { action, operations } of auditOutcomePairs(outcome as Exclude<typeof outcome, "APPLIED">)) {
        for (const op of operations) {
          const key = `${action}/${op}`;
          assert.ok(!seen.has(key), key);
          seen.add(key);
          assert.equal(auditOutcomeOf(action, op), outcome);
        }
      }
    }
    const nonApplied = allPairs().filter(([a, op]) => auditOutcomeOf(a, op) !== "APPLIED").map(([a, op]) => `${a}/${op}`);
    assert.deepEqual([...seen].sort(), nonApplied.sort());
  });
});

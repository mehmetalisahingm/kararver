// #185 kritik güvenlik alarmı kuralları: audit kataloğuyla tutarlılık ve olay/bildirim sözleşmesi. DB gerektirmez.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  eventCatalog,
  MANDATORY_NOTIFICATION_TYPES,
  notificationData,
  SecurityAlertRuleId,
  securityAlertRule,
  securityAlertRuleProblems,
  securityAlertRules,
} from "../src/index.ts";

describe("güvenlik alarmı kuralları", () => {
  test("her kural kimliği bir kez tanımlı; kimlik listesiyle birebir", () => {
    assert.deepEqual(securityAlertRules.map((r) => r.id).sort(), [...SecurityAlertRuleId.options].sort());
    for (const id of SecurityAlertRuleId.options) assert.equal(securityAlertRule(id).id, id);
    assert.throws(() => securityAlertRule("yok" as never), TypeError);
  });

  test("kurallar audit kataloğuyla tutarlı: bilinen işlem ve tür, pozitif eşik, 5 dk – 24 sa pencere", () => {
    for (const r of securityAlertRules) assert.deepEqual(securityAlertRuleProblems(r), [], r.id);
  });

  test("kural doğrulayıcısı hatalı kuralı yakalar", () => {
    const bad = { ...securityAlertRule("mfa.lock.wave"), match: { actions: ["account.mfa" as const], operations: ["explode"] }, threshold: 0, windowMinutes: 1 };
    assert.deepEqual(securityAlertRuleProblems(bad), ["account.mfa/explode izinli tür değil", "eşik pozitif tam sayı olmalı", "pencere 5 dk – 24 sa"]);
  });

  test("kural metinleri boş değil; ilk adım runbook'a yönlendirir", () => {
    for (const r of securityAlertRules) {
      assert.ok(r.label.length > 5 && r.label.length <= 120, r.id);
      assert.ok(r.firstStep.length > 10, r.id);
    }
  });

  test("olay yalnız sistemden, bildirim kapatılamaz ve kişisel veri taşımaz", () => {
    const def = eventCatalog["security.alert.opened"];
    assert.equal(def.actor, "system");
    assert.deepEqual(def.subjects, ["SECURITY_ALERT"]);
    assert.equal(def.notification, "SECURITY_ALERT");
    assert.ok(MANDATORY_NOTIFICATION_TYPES.includes("SECURITY_ALERT"));
    assert.deepEqual(Object.keys(notificationData.SECURITY_ALERT.shape).sort(), ["count", "rule", "severity"]);
  });
});

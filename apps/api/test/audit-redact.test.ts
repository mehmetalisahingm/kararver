// #185 okuma tarafı savunma katmanı: admin.audit.list yanıtında before/after içindeki hassas adlı alanların değeri
// "[gizli]" olur (iç içe nesne ve dizilerde de). Kayıt değişmez; yalnız yanıttaki kopya. DB gerektirmez.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isSensitiveKey, REDACTED, redactAuditSummary } from "../src/modules/audit/redact.ts";

describe("audit özet temizliği (#185)", () => {
  test("hassas anahtarlar: büyük/küçük harf, camelCase, snake_case, kebab-case, çoğul", () => {
    for (const key of [
      "password", "PASSWORD", "passwordHash", "password_hash", "hash", "hashes", "token", "accessToken", "refresh_tokens",
      "secret", "clientSecret", "mfa", "mfaSecret", "MFA_ENABLED", "totp", "totpSeed", "otp", "otpCode", "recovery",
      "recoveryCodes", "apiKey", "api_key", "API-KEY", "apikey", "cookie", "cookies", "session", "sessionToken",
      "sessionId", "email", "emailNormalized", "ip", "IP", "ipAddress", "IPAddress", "clientIp", "last_ip", "ip4",
      "userAgent", "user_agent", "useragent", "User-Agent",
    ]) assert.ok(isSensitiveKey(key), key);
  });

  test("zararsız alanlar kelime eşleşmesi sayesinde gizlenmez", () => {
    for (const key of ["description", "recipient", "membership", "ownership", "zip", "footprint", "status", "keyword", "agentName", "user", "sanctionType", "hashtag", "tokenizer"])
      assert.ok(!isSensitiveKey(key), key);
  });

  test("iç içe nesne ve dizilerde değer [gizli] olur; anahtar ve diğer alanlar korunur; girdi değişmez", () => {
    const input = {
      status: "ACTIVE",
      passwordHash: "$argon2id$v=19$abc",
      profile: { displayName: "Ada", Email: "ada@example.test", security: { totpSecret: { value: "JBSW" }, recoveryCodes: ["a", "b"] } },
      sessions: [{ id: "s1" }],
      devices: [{ userAgent: "Mozilla/5.0", ip: "203.0.113.7", label: "telefon" }],
      count: 3,
    };
    const copy = structuredClone(input);
    assert.deepEqual(redactAuditSummary(input), {
      status: "ACTIVE",
      passwordHash: REDACTED,
      profile: { displayName: "Ada", Email: REDACTED, security: { totpSecret: REDACTED, recoveryCodes: REDACTED } },
      sessions: REDACTED,
      devices: [{ userAgent: REDACTED, ip: REDACTED, label: "telefon" }],
      count: 3,
    });
    assert.deepEqual(input, copy, "girdi değişmez");
  });

  test("null ve ilkel değerler olduğu gibi döner", () => {
    assert.equal(redactAuditSummary(null), null);
    assert.equal(redactAuditSummary("x"), "x");
    assert.deepEqual(redactAuditSummary({}), {});
  });
});

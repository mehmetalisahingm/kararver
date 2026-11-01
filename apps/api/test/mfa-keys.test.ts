/**
 * #180/#291 — MFA anahtarının oturum pepper'ından ayrılması. Kilitlenmeden pepper değişimi:
 * v1 (pepper) kayıt → ayrı anahtar tanımlanır → doğrulamada/CLI ile v2'ye taşınır → pepper değişir (eski değer
 * MFA_LEGACY_PEPPER) → TOTP ve eski kurtarma kodları çalışmaya devam eder.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { cipherVersion, createMfaEnrollment, legacyOnly, needsRekey, protectTotpSecret, recoverTotpSecret, rekeyTotpSecret } from "../src/modules/security/encryption.ts";
import { rekeyMfaCredentials } from "../src/modules/security/mfa-rekey.ts";
import { hashRecoveryCode, recoveryCodeHashCandidates, recoveryCodeHashForStorage } from "../src/modules/security/recovery.ts";
import { PEPPER, prismaBackend, WEB_ORIGIN } from "./support/harness.ts";

const OLD = "old-pepper-0123456789-abcdefghijklmnopqr";
const NEW = "new-pepper-9876543210-zyxwvutsrqponmlkjih";
const KEY = "mfa-key-0123456789-abcdefghijklmnopqrstuv";

describe("MFA anahtar sürümleri", () => {
  test("v1 (eski biçim) ayrı anahtar tanımlandıktan sonra da okunur ve taşınması gerekir", () => {
    const id = randomUUID();
    const v1 = createMfaEnrollment("a@example.test", id, legacyOnly(OLD));
    assert.equal(cipherVersion(v1.ciphertext), 1);
    const keys = { current: KEY, legacy: OLD };
    assert.equal(recoverTotpSecret(v1.ciphertext, id, keys), v1.secret);
    assert.equal(needsRekey(v1.ciphertext, keys), true);
    assert.equal(needsRekey(v1.ciphertext, legacyOnly(OLD)), false, "ayrı anahtar yoksa taşıma yok");
  });

  test("ayrı anahtarla yazılan v2, pepper tamamen değişse de çözülür; anahtarsız çözülmez", () => {
    const id = randomUUID();
    const v2 = protectTotpSecret("JBSWY3DPEHPK3PXP", id, { current: KEY, legacy: OLD });
    assert.equal(cipherVersion(v2), 2);
    assert.equal(recoverTotpSecret(v2, id, { current: KEY, legacy: NEW }), "JBSWY3DPEHPK3PXP");
    assert.throws(() => recoverTotpSecret(v2, id, legacyOnly(OLD)), /MFA_ENCRYPTION_KEY gerekli/);
    assert.throws(() => recoverTotpSecret(v2, id, { current: "y".repeat(40), legacy: OLD }), "yanlış anahtar");
    assert.throws(() => recoverTotpSecret(v2, randomUUID(), { current: KEY, legacy: OLD }), "hesaba bağlı (AAD)");
  });

  test("taşıma: v1 → v2; pepper değişince v1 çözülemez, v2 çözülür (kilitlenme önlenir)", () => {
    const id = randomUUID();
    const v1 = protectTotpSecret("JBSWY3DPEHPK3PXP", id, legacyOnly(OLD));
    const v2 = rekeyTotpSecret(v1, id, { current: KEY, legacy: OLD });
    assert.equal(cipherVersion(v2), 2);
    assert.throws(() => recoverTotpSecret(v1, id, { current: KEY, legacy: NEW }), "eski sırrı bilinmeyen v1 çözülemez");
    assert.equal(recoverTotpSecret(v2, id, { current: KEY, legacy: NEW }), "JBSWY3DPEHPK3PXP");
    assert.throws(() => rekeyTotpSecret(v1, id, legacyOnly(OLD)), /MFA_ENCRYPTION_KEY/);
  });

  test("kurtarma kodu: yeni kod v2 özeti; eski v1 özeti MFA_LEGACY_PEPPER ile doğrulanmaya devam eder", () => {
    const id = randomUUID();
    const oldHash = hashRecoveryCode("AbCd1234", id, OLD);
    assert.equal(recoveryCodeHashForStorage("AbCd1234", id, legacyOnly(OLD)), oldHash, "anahtar yokken biçim aynı");
    const fresh = recoveryCodeHashForStorage("abcd1234", id, { current: KEY, legacy: OLD });
    assert.notEqual(fresh, oldHash);
    // Pepper değişti, eski değer MFA_LEGACY_PEPPER: hem yeni hem eski kod kabul.
    const after = recoveryCodeHashCandidates("ABCD1234", id, { current: KEY, legacy: OLD });
    assert.ok(after.includes(fresh) && after.includes(oldHash));
    // Eski değer verilmezse (legacy = yeni pepper) eski kod artık geçmez: runbook bu yüzden MFA_LEGACY_PEPPER ister.
    assert.equal(recoveryCodeHashCandidates("abcd1234", id, { current: KEY, legacy: NEW }).includes(oldHash), false);
  });
});

describe("MFA anahtar yapılandırması", () => {
  const env = {
    APP_ENV: "test",
    WEB_URL: WEB_ORIGIN,
    API_URL: "http://localhost:4000",
    AUTH_TOKEN_PEPPER: PEPPER,
    MAIL_FROM: "KararVer <no-reply@kararver.test>",
    MEDIA_PUBLIC_BASE_URL: "http://cdn.test/media",
  };
  test("varsayılan: ayrı anahtar yok, eski sır oturum pepper'ı (davranış değişmez)", () => {
    assert.deepEqual(loadConfig(env).mfa, { current: null, legacy: PEPPER });
  });
  test("ayrı anahtar ve eski pepper; pepper ile aynı anahtar ve anahtarsız eski pepper reddedilir", () => {
    assert.deepEqual(loadConfig({ ...env, MFA_ENCRYPTION_KEY: KEY, MFA_LEGACY_PEPPER: OLD }).mfa, { current: KEY, legacy: OLD });
    assert.throws(() => loadConfig({ ...env, MFA_ENCRYPTION_KEY: PEPPER }), /aynı olamaz/);
    assert.throws(() => loadConfig({ ...env, MFA_LEGACY_PEPPER: OLD }), /yalnız MFA_ENCRYPTION_KEY ile/);
    assert.throws(() => loadConfig({ ...env, MFA_ENCRYPTION_KEY: "kisa" }), /32/);
  });
});

const backend = prismaBackend();
(backend ? describe : describe.skip)("mfa:rekey toplu taşıma (postgres)", () => {
  let ctx: Awaited<ReturnType<NonNullable<typeof backend>["create"]>>;
  const users = [randomUUID(), randomUUID(), randomUUID()];
  const secret = "JBSWY3DPEHPK3PXP";

  before(async () => {
    ctx = await backend!.create();
    const db = ctx.prisma!;
    for (const [i, id] of users.entries()) {
      const name = `rk_${id.slice(0, 8)}`;
      await db.$executeRaw`INSERT INTO users (id, email, email_normalized, username, username_normalized, display_name, password_hash, updated_at)
        VALUES (${id}::uuid, ${name + "@example.test"}, ${name + "@example.test"}, ${name}, ${name}, ${name}, 'x', now())`;
      // İki v1 (eski) ve bir v2 kayıt.
      const cipher = i < 2 ? protectTotpSecret(secret, id, legacyOnly(OLD)) : protectTotpSecret(secret, id, { current: KEY, legacy: OLD });
      await db.$executeRaw`INSERT INTO user_mfa_credentials (user_id, secret_cipher, setup_session_id, pending_expires_at, enabled_at, last_accepted_step)
        VALUES (${id}::uuid, ${cipher}, ${randomUUID()}::uuid, now(), now(), -1)`;
    }
  });
  after(async () => {
    await ctx.prisma!.$executeRaw`DELETE FROM users WHERE id = ANY(${users}::uuid[])`;
    await ctx.close();
  });

  const ours = async () =>
    (await ctx.prisma!.$queryRaw<{ user_id: string; secret_cipher: Uint8Array }[]>`
      SELECT user_id::text, secret_cipher FROM user_mfa_credentials WHERE user_id = ANY(${users}::uuid[]) ORDER BY user_id`);

  test("deneme yazmaz; yanlış eski sırla çözülemeyen kayıt sayılır ve dokunulmaz", async () => {
    const before = await ours();
    const dry = await rekeyMfaCredentials(ctx.prisma!, { current: KEY, legacy: OLD }, { apply: false, only: users });
    assert.equal(dry.applied, false);
    assert.deepEqual([dry.total, dry.v1, dry.v2, dry.failed], [3, 2, 1, 0]);
    assert.deepEqual(await ours(), before);
    const wrong = await rekeyMfaCredentials(ctx.prisma!, { current: KEY, legacy: NEW }, { apply: true, only: users });
    assert.equal(wrong.failed, 2, "pepper zaten değişmiş ve eski değer verilmemiş: taşıma reddedilir");
    assert.deepEqual(await ours(), before);
  });

  test("--apply: v1 kayıtlar v2 olur; sonra pepper değişse de TOTP sırrı çözülür; ikinci çalıştırma bir şey yapmaz", async () => {
    const r = await rekeyMfaCredentials(ctx.prisma!, { current: KEY, legacy: OLD }, { apply: true, only: users });
    assert.equal(r.failed, 0);
    assert.equal(r.rekeyed, 2);
    for (const row of await ours()) {
      assert.equal(cipherVersion(row.secret_cipher), 2);
      assert.equal(recoverTotpSecret(row.secret_cipher, row.user_id, { current: KEY, legacy: NEW }), secret);
    }
    const again = await rekeyMfaCredentials(ctx.prisma!, { current: KEY, legacy: NEW }, { apply: true, only: users });
    assert.equal(again.failed, 0, "v1 kalmadı; yeni pepper ile de sorun yok");
  });
});

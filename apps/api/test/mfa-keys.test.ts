/**
 * #180/#291 — MFA anahtarının oturum pepper'ından ayrılması ve pepper'ın kilitlenmeden değiştirilmesi.
 * - Birim: v1/v2 sürümleri, taşıma, eski sır LİSTESİ (A→B→C), kurtarma kodu özetleri, yapılandırma kuralları.
 * - PostgreSQL, gerçek MFA deposu (createPrismaMfaStore) ile uçtan uca: her aşama bir deploy'un yapılandırmasını taklit
 *   eder; v1 kayıt → step-up'ta v2'ye taşınma → pepper A→B→C → TOTP ve eski kurtarma kodları çalışır.
 * - PostgreSQL toplu taşıma (mfa:rekey).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { cipherVersion, createMfaEnrollment, legacyOnly, needsRekey, protectTotpSecret, recoverTotpSecret, rekeyTotpSecret, type MfaKeys } from "../src/modules/security/encryption.ts";
import { rekeyMfaCredentials } from "../src/modules/security/mfa-rekey.ts";
import { createPrismaMfaStore } from "../src/modules/security/prisma-store.ts";
import { hashRecoveryCode, recoveryCodeHashCandidates, recoveryCodeHashForStorage } from "../src/modules/security/recovery.ts";
import { decodeBase32, hotp } from "../src/modules/security/totp.ts";
import { PEPPER, prismaBackend, WEB_ORIGIN } from "./support/harness.ts";

const A = "pepper-A-0123456789-abcdefghijklmnopqrstu";
const B = "pepper-B-9876543210-zyxwvutsrqponmlkjihgf";
const C = "pepper-C-1122334455-qwertyuiopasdfghjklzx";
const KEY = "mfa-key-0123456789-abcdefghijklmnopqrstuv";

describe("MFA anahtar sürümleri", () => {
  test("v1 (eski biçim) ayrı anahtar tanımlandıktan sonra da okunur ve taşınması gerekir", () => {
    const id = randomUUID();
    const v1 = createMfaEnrollment("a@example.test", id, legacyOnly(A));
    assert.equal(cipherVersion(v1.ciphertext), 1);
    const keys: MfaKeys = { current: KEY, legacy: [A] };
    assert.equal(recoverTotpSecret(v1.ciphertext, id, keys), v1.secret);
    assert.equal(needsRekey(v1.ciphertext, keys), true);
    assert.equal(needsRekey(v1.ciphertext, legacyOnly(A)), false, "ayrı anahtar yoksa taşıma yok");
  });

  test("ayrı anahtarla yazılan v2, pepper tamamen değişse de çözülür; anahtarsız ya da yanlış anahtarla çözülmez", () => {
    const id = randomUUID();
    const v2 = protectTotpSecret("JBSWY3DPEHPK3PXP", id, { current: KEY, legacy: [A] });
    assert.equal(cipherVersion(v2), 2);
    assert.equal(recoverTotpSecret(v2, id, { current: KEY, legacy: [C] }), "JBSWY3DPEHPK3PXP");
    assert.throws(() => recoverTotpSecret(v2, id, legacyOnly(A)), /MFA_ENCRYPTION_KEY gerekli/);
    assert.throws(() => recoverTotpSecret(v2, id, { current: "y".repeat(40), legacy: [A] }), "yanlış anahtar");
    assert.throws(() => recoverTotpSecret(v2, randomUUID(), { current: KEY, legacy: [A] }), "hesaba bağlı (AAD)");
  });

  test("v1 kayıt, eski sır listesindeki hangi pepper'la yazıldıysa onunla çözülür; listede yoksa çözülmez", () => {
    const id = randomUUID();
    const v1 = protectTotpSecret("JBSWY3DPEHPK3PXP", id, legacyOnly(A));
    assert.equal(recoverTotpSecret(v1, id, { current: KEY, legacy: [C, A, B] }), "JBSWY3DPEHPK3PXP");
    assert.throws(() => recoverTotpSecret(v1, id, { current: KEY, legacy: [C, B] }), /MFA_LEGACY_PEPPERS/);
    const v2 = rekeyTotpSecret(v1, id, { current: KEY, legacy: [B, A] });
    assert.equal(cipherVersion(v2), 2);
    assert.equal(recoverTotpSecret(v2, id, { current: KEY, legacy: [C] }), "JBSWY3DPEHPK3PXP");
    assert.throws(() => rekeyTotpSecret(v1, id, legacyOnly(A)), /MFA_ENCRYPTION_KEY/);
  });

  test("kurtarma kodu: yeni kod v2; A→B→C sonrası listede kalan her eski pepper'ın v1 özeti kabul edilir", () => {
    const id = randomUUID();
    const underA = hashRecoveryCode("AbCd1234", id, A);
    const underB = hashRecoveryCode("abcd1234", id, B);
    assert.equal(recoveryCodeHashForStorage("AbCd1234", id, legacyOnly(A)), underA, "anahtar yokken biçim aynı");
    const fresh = recoveryCodeHashForStorage("abcd1234", id, { current: KEY, legacy: [A] });
    assert.ok(![underA, underB].includes(fresh));
    const afterC = recoveryCodeHashCandidates("ABCD1234", id, { current: KEY, legacy: [C, A, B] });
    for (const h of [fresh, underA, underB]) assert.ok(afterC.includes(h));
    assert.equal(recoveryCodeHashCandidates("abcd1234", id, { current: KEY, legacy: [C, B] }).includes(underA), false, "A silinirse A kodları ölür");
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
  test("varsayılan: ayrı anahtar yok, eski sır yalnız güncel pepper (davranış değişmez)", () => {
    assert.deepEqual(loadConfig(env).mfa, { current: null, legacy: [PEPPER] });
  });
  test("eski pepper listesi: güncel pepper önce, sonra eskiler, tekrarsız", () => {
    assert.deepEqual(loadConfig({ ...env, MFA_ENCRYPTION_KEY: KEY, MFA_LEGACY_PEPPERS: ` ${A}, ${B},${A}` }).mfa, { current: KEY, legacy: [PEPPER, A, B] });
  });
  test("reddedilenler: pepper ile aynı anahtar, anahtarsız eski liste, listede anahtar, kısa değer, production'da anahtarsız", () => {
    assert.throws(() => loadConfig({ ...env, MFA_ENCRYPTION_KEY: PEPPER }), /aynı olamaz/);
    assert.throws(() => loadConfig({ ...env, MFA_LEGACY_PEPPERS: A }), /yalnız MFA_ENCRYPTION_KEY ile/);
    assert.throws(() => loadConfig({ ...env, MFA_ENCRYPTION_KEY: KEY, MFA_LEGACY_PEPPERS: `${A},${KEY}` }), /listesinde olamaz/);
    assert.throws(() => loadConfig({ ...env, MFA_ENCRYPTION_KEY: KEY, MFA_LEGACY_PEPPERS: `${A},kisa` }), /32/);
    assert.throws(() => loadConfig({ ...env, MFA_ENCRYPTION_KEY: "kisa" }), /32/);
  });
});

const backend = prismaBackend();
(backend ? describe : describe.skip)("MFA deposu uçtan uca: v1 → v2 → pepper A→B→C (postgres)", () => {
  let ctx: Awaited<ReturnType<NonNullable<typeof backend>["create"]>>;
  const userId = randomUUID();
  const sessionId = randomUUID();
  const t0 = Date.parse("2026-11-04T10:00:00.000Z");
  let step = 0;
  /** Her çağrı yeni bir TOTP adımı (tekrar oynatma koruması aynı adımı reddeder). */
  const nextNow = () => new Date(t0 + ++step * 60_000);
  const codeAt = (secret: string, now: Date) => hotp(decodeBase32(secret), Math.floor(now.getTime() / 30_000));
  const cipherOf = async () =>
    (await ctx.prisma!.$queryRaw<{ c: Uint8Array }[]>`SELECT secret_cipher AS c FROM user_mfa_credentials WHERE user_id = ${userId}::uuid`)[0]!.c;
  let secret = "";
  let codes: string[] = [];

  before(async () => {
    ctx = await backend!.create();
    const name = `mk_${userId.slice(0, 8)}`;
    await ctx.prisma!.$executeRaw`INSERT INTO users (id, email, email_normalized, username, username_normalized, display_name, password_hash, updated_at)
      VALUES (${userId}::uuid, ${name + "@example.test"}, ${name + "@example.test"}, ${name}, ${name}, ${name}, 'x', now())`;
    await ctx.prisma!.$executeRaw`INSERT INTO sessions (id, user_id, token_hash, expires_at)
      VALUES (${sessionId}::uuid, ${userId}::uuid, ${randomUUID().replaceAll("-", "").padEnd(64, "0")}, now() + interval '30 days')`;
  });
  // Hesap silinmez: MFA adımları audit'e yazar ve audit ekleme-yalnızdır (FK RESTRICT). Rastgele kimlikli test hesabı kalır.
  after(async () => {
    await ctx.close();
  });

  const store = (keys: MfaKeys) => createPrismaMfaStore(ctx.prisma!, keys);
  const stepUp = (keys: MfaKeys) => { const now = nextNow(); return store(keys).stepUp({ userId, sessionId, code: codeAt(secret, now), now, requestId: randomUUID() }); };
  const recover = (keys: MfaKeys, code: string) => store(keys).recover({ userId, sessionId, code, now: nextNow(), requestId: randomUUID() });

  test("1. ayrım öncesi (yalnız pepper A): kurulum v1 kayıt ve v1 kurtarma kodları üretir", async () => {
    const s = store(legacyOnly(A));
    const begun = await s.begin({ userId, sessionId, email: "mk@example.test", now: nextNow(), requestId: randomUUID() });
    assert.equal(begun.kind, "created");
    secret = (begun as { secret: string }).secret;
    const now = nextNow();
    const enabled = await s.confirm({ userId, sessionId, code: codeAt(secret, now), now, requestId: randomUUID() });
    assert.equal(enabled.kind, "enabled");
    codes = (enabled as { recoveryCodes: string[] }).recoveryCodes;
    assert.equal(cipherVersion(await cipherOf()), 1);
  });

  test("2. ayrı anahtar eklendi (pepper hâlâ A): step-up geçer ve kayıt AYNI işlemde v2'ye taşınır; eski kod geçer", async () => {
    const keys: MfaKeys = { current: KEY, legacy: [A] };
    assert.equal((await stepUp(keys)).kind, "verified");
    assert.equal(cipherVersion(await cipherOf()), 2, "doğrulamada taşındı");
    assert.equal((await recover(keys, codes[0]!)).kind, "verified", "v1 kurtarma kodu");
    assert.equal((await recover(keys, codes[0]!)).kind, "invalid", "kod tek kullanımlık");
  });

  test("3. pepper A→B (MFA_LEGACY_PEPPERS=A): TOTP ve A dönemindeki kurtarma kodu çalışır", async () => {
    const keys: MfaKeys = { current: KEY, legacy: [B, A] };
    assert.equal((await stepUp(keys)).kind, "verified");
    assert.equal((await recover(keys, codes[1]!)).kind, "verified");
  });

  test("4. pepper B→C (MFA_LEGACY_PEPPERS=A,B): A dönemindeki kod SESSİZCE bozulmaz", async () => {
    const keys: MfaKeys = { current: KEY, legacy: [C, A, B] };
    assert.equal((await stepUp(keys)).kind, "verified");
    assert.equal((await recover(keys, codes[2]!)).kind, "verified");
  });

  test("5. negatif: listeden A silinirse (runbook ihlali) A kodu reddedilir ama TOTP çalışır; anahtar yoksa TOTP reddedilir", async () => {
    assert.equal((await recover({ current: KEY, legacy: [C, B] }, codes[3]!)).kind, "invalid");
    assert.equal((await stepUp({ current: KEY, legacy: [C, B] })).kind, "verified");
    // Ayrı anahtar kaldırılırsa (geri dönüş kuralı ihlali) v2 kayıt çözülemez: istek reddedilir, kayıt değişmez.
    const before = Buffer.from(await cipherOf());
    await assert.rejects(stepUp(legacyOnly(C)), /MFA_ENCRYPTION_KEY gerekli/);
    assert.deepEqual(Buffer.from(await cipherOf()), before);
    // Doğru yapılandırmaya dönülünce kalan kodlar hâlâ geçer.
    assert.equal((await recover({ current: KEY, legacy: [C, A, B] }, codes[3]!)).kind, "verified");
  });
});

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
      const cipher = i < 2 ? protectTotpSecret(secret, id, legacyOnly(A)) : protectTotpSecret(secret, id, { current: KEY, legacy: [A] });
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

  test("deneme yazmaz; eski sırrı listede olmayan kayıt çözülemez sayılır ve dokunulmaz", async () => {
    const before = await ours();
    const dry = await rekeyMfaCredentials(ctx.prisma!, { current: KEY, legacy: [A] }, { apply: false, only: users });
    assert.equal(dry.applied, false);
    assert.deepEqual([dry.total, dry.v1, dry.v2, dry.failed], [3, 2, 1, 0]);
    assert.deepEqual(await ours(), before);
    const wrong = await rekeyMfaCredentials(ctx.prisma!, { current: KEY, legacy: [B] }, { apply: true, only: users });
    assert.equal(wrong.failed, 2, "pepper zaten değişmiş ve eski değer listede yok: taşıma reddedilir");
    assert.deepEqual(await ours(), before);
  });

  test("--apply: v1 kayıtlar v2 olur; sonra pepper değişse de TOTP sırrı çözülür; ikinci çalıştırma bir şey yapmaz", async () => {
    const r = await rekeyMfaCredentials(ctx.prisma!, { current: KEY, legacy: [B, A] }, { apply: true, only: users });
    assert.equal(r.failed, 0);
    assert.equal(r.rekeyed, 2);
    for (const row of await ours()) {
      assert.equal(cipherVersion(row.secret_cipher), 2);
      assert.equal(recoverTotpSecret(row.secret_cipher, row.user_id, { current: KEY, legacy: [C] }), secret);
    }
    const again = await rekeyMfaCredentials(ctx.prisma!, { current: KEY, legacy: [C] }, { apply: true, only: users });
    assert.equal(again.failed, 0, "v1 kalmadı; yeni pepper ile de sorun yok");
  });
});

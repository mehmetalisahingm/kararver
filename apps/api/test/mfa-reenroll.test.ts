// #180/#291 — kullanıcının kendi doğrulayıcısını (TOTP sırrı + kurtarma kodları) kilitlenmeden yenilemesi. Gerçek PostgreSQL.
// Sıra önemlidir: testler aynı hesabın durumunu adım adım ilerletir (başlatma → yanlış onay → doğru onay → sonrası).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createHarness, PEPPER, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";
import { cipherVersion } from "../src/modules/security/encryption.ts";
import { createPrismaMfaStore } from "../src/modules/security/prisma-store.ts";
import { decodeBase32, hotp } from "../src/modules/security/totp.ts";

const backend = prismaBackend();
const suite = backend ? describe : describe.skip;
const KEY = "reenroll-key-0123456789-abcdefghijklmnopq";

suite("#180/#291 doğrulayıcı yenileme (PostgreSQL)", () => {
  let h: Harness, cookie: string, other: string;
  let userId: string, email: string;
  let oldSecret: string, newSecret: string;
  let oldCodes: string[], newCodes: string[];
  const password = "ornek-guclu-parola-1234";
  const secrets: string[] = [];

  async function request(method: "GET" | "POST", path: string, body?: unknown, session?: string) {
    return h.app.inject({
      method,
      url: "/v1" + path,
      headers: {
        origin: WEB_ORIGIN,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(session ? { cookie: session } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const codeFor = (secret: string) => hotp(decodeBase32(secret), Math.floor(h.clock.now.getTime() / 30000));
  const credential = () => h.prisma!.userMfaCredential.findUniqueOrThrow({ where: { userId } });
  const stepUp = async (secret: string, session = cookie) => {
    h.clock.advance(30_000);
    return request("POST", "/me/mfa/step-up", { code: codeFor(secret) }, session);
  };
  const login = async () => {
    const r = await request("POST", "/auth/login", { email, password });
    assert.equal(r.statusCode, 200, r.body);
    return sessionCookie(r.headers["set-cookie"] as string);
  };

  before(async () => {
    h = await createHarness(backend!, { mfaKey: KEY });
    const id = randomUUID().replaceAll("-", "").slice(0, 12);
    email = "reenroll_" + id + "@example.test";
    assert.equal((await request("POST", "/auth/register", { email, username: "re_" + id, displayName: "Yenileme", password })).statusCode, 202);
    assert.equal((await request("POST", "/auth/email/verify", { token: tokenFrom(h.mails.at(-1)!) })).statusCode, 200);
    cookie = await login();
    other = await login();
    userId = (await request("GET", "/me", undefined, cookie)).json().data.id;
    const setup = await request("POST", "/me/mfa/setup", { password }, cookie);
    assert.equal(setup.statusCode, 200, setup.body);
    oldSecret = setup.json().data.secret;
    secrets.push(oldSecret);
    const confirmed = await request("POST", "/me/mfa/confirm", { code: codeFor(oldSecret) }, cookie);
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    oldCodes = confirmed.json().data.recoveryCodes;
  });
  after(async () => { await h?.close(); });

  test("step-up yokken, yanlış parolayla ya da MFA kapalıyken başlatılamaz; ayrı anahtar yoksa başlatılamaz", async () => {
    const before = await credential();
    const noStepup = await request("POST", "/me/mfa/reenroll", { password }, cookie);
    assert.equal(noStepup.statusCode, 403, noStepup.body);
    assert.equal(noStepup.json().error.details[0].code, "stepup_required");
    assert.equal((await request("POST", "/me/mfa/reenroll", { password })).statusCode, 401);

    assert.equal((await stepUp(oldSecret)).statusCode, 200);
    assert.equal((await request("POST", "/me/mfa/reenroll", { password: "yanlis-parola-1234" }, cookie)).statusCode, 403);
    const after = await credential();
    assert.equal(after.reenrollSecretCipher, null, "reddedilen başlatma bekleyen sır yazmaz");
    assert.deepEqual(Buffer.from(after.secretCipher), Buffer.from(before.secretCipher));

    // Ayrı anahtarsız yapılandırma: yeni sır eski pepper'a bağlanmasın diye başlatma reddedilir, step-up tüketilmez.
    const session = await h.prisma!.session.findFirstOrThrow({ where: { userId, revokedAt: null }, orderBy: { createdAt: "asc" } });
    const legacy = createPrismaMfaStore(h.prisma!, PEPPER);
    const r = await legacy.reenrollBegin({ userId, sessionId: session.id, email, now: h.clock.now });
    assert.equal(r.kind, "key_required");

    // MFA'sı olmayan hesap.
    const id = randomUUID().replaceAll("-", "").slice(0, 12);
    const plain = { email: "plain_" + id + "@example.test", username: "pl_" + id, displayName: "Düz", password };
    assert.equal((await request("POST", "/auth/register", plain)).statusCode, 202);
    assert.equal((await request("POST", "/auth/email/verify", { token: tokenFrom(h.mails.at(-1)!) })).statusCode, 200);
    const plainLogin = await request("POST", "/auth/login", { email: plain.email, password });
    const noMfa = await request("POST", "/me/mfa/reenroll", { password }, sessionCookie(plainLogin.headers["set-cookie"] as string));
    assert.equal(noMfa.statusCode, 409);
    assert.equal(noMfa.json().error.details[0].code, "mfa_not_enabled");
  });

  test("başlatma step-up'ı tüketir; yeni sır ayrı alanda, eski sır ve kodlar geçerli kalır", async () => {
    const before = await credential();
    const started = await request("POST", "/me/mfa/reenroll", { password }, cookie);
    assert.equal(started.statusCode, 200, started.body);
    newSecret = started.json().data.secret;
    secrets.push(newSecret);
    assert.notEqual(newSecret, oldSecret);
    assert.ok(started.json().data.uri.startsWith("otpauth://totp/"));

    const c = await credential();
    assert.deepEqual(Buffer.from(c.secretCipher), Buffer.from(before.secretCipher), "etkin sır değişmedi");
    assert.equal(cipherVersion(c.reenrollSecretCipher!), 2, "bekleyen sır ayrı anahtarla");
    assert.equal(c.reenrollSessionId !== null, true);
    assert.equal(Buffer.from(c.reenrollSecretCipher!).includes(Buffer.from(newSecret)), false);

    const again = await request("POST", "/me/mfa/reenroll", { password }, cookie);
    assert.equal(again.statusCode, 403, "aynı step-up ikinci kez kullanılamaz");
    // Eski sır bekleyen yenileme sırasında çalışır.
    assert.equal((await stepUp(oldSecret)).statusCode, 200);
  });

  test("yanlış kodla, eski sırrın koduyla ya da başka oturumdan onay reddedilir; eski sır çalışmaya devam eder", async () => {
    const before = await credential();
    assert.equal((await request("POST", "/me/mfa/reenroll/confirm", { code: "000000" }, cookie)).statusCode, 403);
    h.clock.advance(30_000);
    assert.equal((await request("POST", "/me/mfa/reenroll/confirm", { code: codeFor(oldSecret) }, cookie)).statusCode, 403);
    assert.equal((await request("POST", "/me/mfa/reenroll/confirm", { code: codeFor(newSecret) }, other)).statusCode, 403,
      "bekleyen sır başlatan oturuma bağlı");
    const c = await credential();
    assert.deepEqual(Buffer.from(c.secretCipher), Buffer.from(before.secretCipher));
    assert.notEqual(c.reenrollSecretCipher, null, "bekleyen yenileme yeniden denenebilir");
    assert.equal((await stepUp(oldSecret)).statusCode, 200, "eski sır hâlâ geçerli");
    assert.equal(await h.prisma!.mfaRecoveryCode.count({ where: { userId, revokedAt: { not: null } } }), 0);
  });

  test("eşzamanlı iki onaydan yalnız biri kazanır; diğer oturumların step-up'ı düşer", async () => {
    assert.equal((await stepUp(oldSecret, other)).statusCode, 200);
    assert.ok((await request("GET", "/me/mfa", undefined, other)).json().data.stepUpExpiresAt);
    h.clock.advance(30_000);
    const code = codeFor(newSecret);
    const results = await Promise.all([
      request("POST", "/me/mfa/reenroll/confirm", { code }, cookie),
      request("POST", "/me/mfa/reenroll/confirm", { code }, cookie),
    ]);
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 403]);
    newCodes = results.find(r => r.statusCode === 200)!.json().data.recoveryCodes;
    assert.equal(newCodes.length, 10);
    assert.equal(newCodes.some(x => oldCodes.includes(x)), false);

    const c = await credential();
    assert.equal(cipherVersion(c.secretCipher), 2);
    assert.equal(c.reenrollSecretCipher, null);
    assert.equal(c.reenrollSessionId, null);
    assert.equal(await h.prisma!.mfaRecoveryCode.count({ where: { userId, revokedAt: null, usedAt: null } }), 10);
    assert.equal(await h.prisma!.mfaRecoveryCode.count({ where: { userId, revokedAt: { not: null } } }), 10);
    assert.equal(await h.prisma!.userMfaCredential.count({ where: { userId } }), 1, "MFA kaydı silinmez");
    assert.equal((await request("GET", "/me/mfa", undefined, other)).json().data.stepUpExpiresAt, null, "diğer oturumun step-up'ı düştü");
  });

  test("onaydan sonra eski sır ve eski kurtarma kodları geçmez, yenileri geçer", async () => {
    assert.equal((await stepUp(oldSecret)).statusCode, 403, "eski TOTP sırrı geçersiz");
    assert.equal((await stepUp(newSecret)).statusCode, 200, "yeni TOTP sırrı geçerli");
    assert.equal((await request("POST", "/me/mfa/recover", { password, code: oldCodes[0]! }, cookie)).statusCode, 403);
    assert.equal((await request("POST", "/me/mfa/recover", { password, code: oldCodes[1]! }, other)).statusCode, 403);
    assert.equal((await request("POST", "/me/mfa/recover", { password, code: newCodes[0]! }, cookie)).statusCode, 200);
    assert.equal((await request("POST", "/me/mfa/recover", { password, code: newCodes[0]! }, cookie)).statusCode, 403, "tek kullanımlık");
    assert.equal((await request("POST", "/me/mfa/recover", { password, code: newCodes[1]! }, other)).statusCode, 200);
    // Kurtarma koduyla kanıtlanmış step-up da yeniden başlatmaya yeter.
    const restart = await request("POST", "/me/mfa/reenroll", { password }, other);
    assert.equal(restart.statusCode, 200, restart.body);
    secrets.push(restart.json().data.secret);
  });

  test("audit kayıtlarında sır, kurtarma kodu ya da şifreli kayıt bulunmaz", async () => {
    const audit = await h.prisma!.auditLog.findMany({ where: { actorId: userId, action: "account.mfa" }, orderBy: { createdAt: "asc" } });
    const ops = audit.map(a => a.operation);
    assert.ok(ops.includes("reenroll_begin"));
    assert.equal(ops.filter(o => o === "reenroll").length, 1, "eşzamanlı onayda tek kayıt");
    const done = audit.find(a => a.operation === "reenroll")!;
    assert.deepEqual(done.after, { cipherVersion: 2, recoveryCodesIssued: 10, recoveryCodesRevoked: 10, stepupsRevoked: 1 });
    const text = JSON.stringify(audit);
    const c = await credential();
    for (const value of [...secrets, ...oldCodes, ...newCodes, Buffer.from(c.secretCipher).toString("hex"), Buffer.from(c.secretCipher).toString("base64")])
      assert.equal(text.toLowerCase().includes(value.toLowerCase()), false);
    assert.equal(/secret|code/i.test(text.replace(/recoveryCodes(Issued|Revoked)/g, "")), false);
  });
});

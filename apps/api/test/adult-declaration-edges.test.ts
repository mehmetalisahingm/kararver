/**
 * #373 bağımsız denetim — 18+ öz beyanının sınır durumları (#289, karar 54A). adult-declaration.test.ts temel akışı
 * kapsar (eksik/false/string gövde, tekrar istek, tek audit); burada başka cihaz/oturum, başka hesap adına beyan,
 * CSRF, eşzamanlılık, audit içeriği ve yaptırım sınırı var. Öz beyan gerçek yaş doğrulaması değildir.
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL veya .env). Veriler sentetiktir.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();
const json = { origin: WEB_ORIGIN, "content-type": "application/json" };
const PASSWORD = "strong-test-password-18";

describe("18+ öz beyanı sınır durumları (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;

  before(async () => {
    h = await createHarness(backend!, { adultDeclarationRequired: true, legacyAdultDeclarationEnforced: true });
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `adulte-${randomUUID().slice(0, 8)}`, name: "18+ sınır testi" } })).id;
  });
  after(async () => { await h?.close(); });

  const login = async (email: string) => {
    const res = await h.app.inject({ method: "POST", url: "/v1/auth/login", headers: json, payload: JSON.stringify({ email, password: PASSWORD }) });
    assert.equal(res.statusCode, 200, res.body);
    return sessionCookie(res.headers["set-cookie"]);
  };

  /** Kural öncesi açılmış hesabı taklit eder: kayıtta beyan verilir, sonra beyan kaydı silinir. */
  async function legacyAccount() {
    const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
    const account = { email: `adulte_${nonce}@example.test`, username: `ae_${nonce}`, displayName: "Sınır Testi", password: PASSWORD };
    const reg = await h.app.inject({ method: "POST", url: "/v1/auth/register", headers: json, payload: JSON.stringify({ ...account, adultConfirmed: true }) });
    assert.equal(reg.statusCode, 202, reg.body);
    const mail = h.mails.filter((m) => m.to === account.email).at(-1);
    const verify = await h.app.inject({ method: "POST", url: "/v1/auth/email/verify", headers: json, payload: JSON.stringify({ token: tokenFrom(mail) }) });
    assert.ok(verify.statusCode < 300, verify.body);
    const cookie = await login(account.email);
    const id = (await db.user.findUniqueOrThrow({ where: { email: account.email }, select: { id: true } })).id;
    await db.user.update({ where: { id }, data: { adultDeclaredAt: null } });
    return { ...account, id, cookie };
  }

  const send = (method: "GET" | "POST" | "PUT", url: string, cookie: string, body?: unknown, origin = WEB_ORIGIN) =>
    h.app.inject({ method, url, headers: { ...json, origin, cookie, "idempotency-key": randomUUID() }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });

  const declare = (cookie: string, body: unknown = { adultConfirmed: true }, origin = WEB_ORIGIN) => send("POST", "/v1/me/adult-declaration", cookie, body, origin);
  const declaredAt = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id }, select: { adultDeclaredAt: true } })).adultDeclaredAt;

  async function poll() {
    const owner = await legacyAccount();
    return db.poll.create({
      data: {
        authorId: owner.id, categoryId, publicId: randomUUID().replaceAll("-", "").slice(0, 12), slug: "sinir", title: "Sınır anketi",
        closesAt: new Date("2031-01-01T00:00:00Z"), options: { create: [{ position: 0, label: "Evet" }, { position: 1, label: "Hayır" }] },
      },
      select: { id: true, options: { select: { id: true }, orderBy: { position: "asc" } } },
    });
  }
  const vote = (cookie: string, p: { id: string; options: { id: string }[] }) => send("PUT", `/v1/polls/${p.id}/vote`, cookie, { optionId: p.options[0]!.id });

  test("beyan hesaba bağlıdır: bir cihazdaki beyan diğer cihazın açık oturumunda ve yeni girişte hemen geçerli", async () => {
    const u = await legacyAccount();
    const phone = u.cookie;
    const laptop = await login(u.email);
    const p = await poll();
    assert.equal((await vote(laptop, p)).json().error.code, "ADULT_DECLARATION_REQUIRED", "kontrol: beyansız oturum kısıtlı");

    assert.equal((await declare(phone)).statusCode, 200);
    assert.equal((await send("GET", "/v1/me", laptop)).json().data.adultDeclarationRequired, false, "eski oturum önbellekten eski durumu görmemeli");
    assert.ok([200, 201].includes((await vote(laptop, p)).statusCode), "diğer cihaz yeniden sorulmadan katılır");
    const fresh = await login(u.email);
    assert.equal((await send("GET", "/v1/me", fresh)).json().data.adultDeclarationRequired, false, "yeni girişte tekrar sorulmaz");
  });

  test("başka hesap adına beyan verilemez: fazladan kimlik alanı 400, hedef hesap beyansız kalır", async () => {
    const a = await legacyAccount();
    const b = await legacyAccount();
    for (const body of [{ adultConfirmed: true, userId: b.id }, { adultConfirmed: true, id: b.id }, { adultConfirmed: true, email: b.email }]) {
      const res = await declare(a.cookie, body);
      assert.equal(res.statusCode, 400, `${JSON.stringify(Object.keys(body))}: ${res.body}`);
    }
    assert.equal(await declaredAt(a.id), null, "geçersiz istek çağıranın beyanını da yazmaz");
    assert.equal(await declaredAt(b.id), null);
    assert.equal((await declare(a.cookie)).statusCode, 200);
    assert.equal(await declaredAt(b.id), null, "A'nın beyanı B'ye geçmez");
  });

  test("CSRF: yabancı Origin'den beyan 403 ve hiçbir şey yazılmaz", async () => {
    const u = await legacyAccount();
    const res = await declare(u.cookie, { adultConfirmed: true }, "https://attacker.invalid");
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(await declaredAt(u.id), null);
  });

  test("eşzamanlı beş beyan: tek ilk zaman, tek audit; hepsi aynı declaredAt'i döner", async () => {
    const u = await legacyAccount();
    const results = await Promise.all(Array.from({ length: 5 }, () => declare(u.cookie)));
    assert.deepEqual(results.map((r) => r.statusCode), [200, 200, 200, 200, 200], results.map((r) => r.body).join(" | "));
    assert.equal(new Set(results.map((r) => r.json().data.declaredAt)).size, 1);
    assert.equal(await db.auditLog.count({ where: { actorId: u.id, action: "account.adult.declare" } }), 1);
  });

  test("audit kaydı yalnız beyan bayrağını taşır: e-posta, kullanıcı adı, parola ya da oturum yok", async () => {
    const u = await legacyAccount();
    assert.equal((await declare(u.cookie)).statusCode, 200);
    const [row] = await db.auditLog.findMany({ where: { actorId: u.id, action: "account.adult.declare" } });
    assert.ok(row, "audit yazılmadı");
    const text = JSON.stringify(row);
    for (const secret of [u.email, u.username, PASSWORD, u.cookie]) assert.equal(text.includes(secret), false, "audit kişisel veri ya da sır taşıyor");
    assert.deepEqual(row!.before, { adultDeclared: false });
    assert.deepEqual(row!.after, { adultDeclared: true });
  });

  test("beyan yaptırımı aşmaz: yasaklı hesap beyan verse de katılım ACCOUNT_RESTRICTED kalır", async () => {
    const u = await legacyAccount();
    const p = await poll();
    await db.user.update({ where: { id: u.id }, data: { status: "BANNED" } });
    const attempt = await declare(u.cookie);
    assert.ok([200, 401, 403].includes(attempt.statusCode), attempt.body);
    const res = await vote(u.cookie, p);
    assert.ok([401, 403].includes(res.statusCode), res.body);
    assert.notEqual(res.json().error.code, "ADULT_DECLARATION_REQUIRED", "yasaklı hesapta belirleyici kısıt yaptırım olmalı");
    assert.equal(await db.vote.count({ where: { userId: u.id } }), 0);
  });
});

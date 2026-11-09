/**
 * #289 karar 54A: eski hesaplardan sonraki girişte 18+ öz beyanı.
 * Beyan yokken katılım (anket, oy, yorum, görsel) ADULT_DECLARATION_REQUIRED alır; okuma ve veri hakları açık kalır.
 * Öz beyan gerçek yaş doğrulaması değildir; eski hesaplar silinmez veya yasaklanmaz.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { createHarness, memoryBackend, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();
const json = { origin: WEB_ORIGIN, "content-type": "application/json" };

async function signUp(h: Harness, adultConfirmed: boolean | undefined) {
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const account = { email: `adult_${nonce}@example.test`, username: `ad_${nonce}`, displayName: "Beyan Testi", password: "strong-test-password-18" };
  const reg = await h.app.inject({ method: "POST", url: "/v1/auth/register", headers: json,
    payload: JSON.stringify({ ...account, ...(adultConfirmed === undefined ? {} : { adultConfirmed }) }) });
  assert.equal(reg.statusCode, 202, reg.body);
  const mail = h.mails.filter((m) => m.to === account.email).at(-1);
  const verify = await h.app.inject({ method: "POST", url: "/v1/auth/email/verify", headers: json, payload: JSON.stringify({ token: tokenFrom(mail) }) });
  assert.ok(verify.statusCode < 300, verify.body);
  const login = await h.app.inject({ method: "POST", url: "/v1/auth/login", headers: json,
    payload: JSON.stringify({ email: account.email, password: account.password }) });
  assert.equal(login.statusCode, 200, login.body);
  return { ...account, id: login.json().data.id as string, cookie: sessionCookie(login.headers["set-cookie"]) };
}

describe("eski hesap 18+ öz beyanı (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;


  before(async () => {
    h = await createHarness(backend!, { adultDeclarationRequired: true });
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `adult-${randomUUID().slice(0, 8)}`, name: "18+ beyan testi" } })).id;
  });
  after(async () => {
    // Audit ve oy olayları append-only'dir; sentetik satırlar diğer testler gibi yerinde kalır.
    await h?.close();
  });

  const send = (method: "GET" | "POST" | "PUT", url: string, cookie: string, body?: unknown) =>
    h.app.inject({ method, url, headers: { ...json, cookie, "idempotency-key": randomUUID() }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });

  test("kayıtta verilen beyan kalıcıdır; yeni hesaba tekrar sorulmaz", async () => {
    const u = await signUp(h, true);

    const row = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { adultDeclaredAt: true } });
    assert.ok(row.adultDeclaredAt, "kayıt anında adult_declared_at yazılır");
    const me = await send("GET", "/v1/me", u.cookie);
    assert.equal(me.json().data.adultDeclarationRequired, false);
  });

  test("beyanı olmayan eski hesap: katılım 403, okuma ve veri hakları açık; beyandan sonra katılım açılır", async () => {
    const owner = await signUp(h, true);
    const legacy = await signUp(h, true);

    // Kural öncesi açılmış hesabı taklit eder: beyan kaydı yok.
    await db.user.update({ where: { id: legacy.id }, data: { adultDeclaredAt: null } });
    const poll = await db.poll.create({
      data: {
        authorId: owner.id, categoryId, publicId: randomUUID().replaceAll("-", "").slice(0, 12), slug: "beyan", title: "Beyan anketi",
        closesAt: new Date("2031-01-01T00:00:00Z"), options: { create: [{ position: 0, label: "Evet" }, { position: 1, label: "Hayır" }] },
      },
      select: { id: true, options: { select: { id: true }, orderBy: { position: "asc" } } },
    });

    const me = await send("GET", "/v1/me", legacy.cookie);
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().data.adultDeclarationRequired, true);

    const blocked = [
      await send("PUT", `/v1/polls/${poll.id}/vote`, legacy.cookie, { optionId: poll.options[0]!.id }),
      await send("POST", `/v1/polls/${poll.id}/comments`, legacy.cookie, { body: "Beyansız yorum" }),
      await send("POST", "/v1/polls", legacy.cookie, { kind: "DISCUSSION", title: "Beyansız anket", categoryId }),
    ];
    for (const r of blocked) {
      assert.equal(r.statusCode, 403, r.body);
      assert.equal(r.json().error.code, "ADULT_DECLARATION_REQUIRED");
    }
    assert.equal(await db.vote.count({ where: { userId: legacy.id } }), 0);
    assert.equal(await db.comment.count({ where: { authorId: legacy.id } }), 0);
    assert.equal(await db.poll.count({ where: { authorId: legacy.id } }), 0);

    // Veri hakları ve okuma beyan istemez.
    assert.equal((await send("GET", `/v1/polls/${poll.id}`, legacy.cookie)).statusCode, 200);
    assert.equal((await send("GET", "/v1/me/deletion", legacy.cookie)).statusCode, 200);
    const emailChange = await send("POST", "/v1/me/email-change", legacy.cookie, { newEmail: `new_${randomUUID().slice(0, 8)}@example.test`, password: legacy.password });
    assert.notEqual(emailChange.json()?.error?.code, "ADULT_DECLARATION_REQUIRED", emailChange.body);

    // Yanlış/eksik beyan kabul edilmez.
    for (const body of [{}, { adultConfirmed: false }, { adultConfirmed: "true" }]) {
      assert.equal((await send("POST", "/v1/me/adult-declaration", legacy.cookie, body)).statusCode, 400);
    }
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: legacy.id } })).adultDeclaredAt, null);

    const first = await send("POST", "/v1/me/adult-declaration", legacy.cookie, { adultConfirmed: true });
    assert.equal(first.statusCode, 200, first.body);
    const declaredAt = first.json().data.declaredAt as string;
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    const again = await send("POST", "/v1/me/adult-declaration", legacy.cookie, { adultConfirmed: true });
    assert.equal(again.json().data.declaredAt, declaredAt, "ilk beyan zamanı korunur");
    const audits = await db.auditLog.findMany({ where: { actorId: legacy.id, action: "account.adult.declare" } });
    assert.equal(audits.length, 1, "yalnız ilk beyan audit üretir");
    assert.equal(audits[0]!.operation, "declare");
    assert.equal(audits[0]!.targetId, legacy.id);

    assert.equal((await send("GET", "/v1/me", legacy.cookie)).json().data.adultDeclarationRequired, false);
    const vote = await send("PUT", `/v1/polls/${poll.id}/vote`, legacy.cookie, { optionId: poll.options[0]!.id });
    assert.ok(vote.statusCode === 200 || vote.statusCode === 201, vote.body);
    assert.equal(await db.vote.count({ where: { userId: legacy.id } }), 1);
  });

  test("beyan uç noktası oturum ister", async () => {
    const r = await h.app.inject({ method: "POST", url: "/v1/me/adult-declaration", headers: json, payload: JSON.stringify({ adultConfirmed: true }) });
    assert.equal(r.statusCode, 401);
  });
});

test("kural kapalı eski test düzenekleri etkilenmez (bellek)", async () => {
  const h = await createHarness(memoryBackend);
  try {
    const u = await signUp(h, undefined);
    const me = await h.app.inject({ method: "GET", url: "/v1/me", headers: { origin: WEB_ORIGIN, cookie: u.cookie } });
    assert.equal(me.json().data.adultDeclarationRequired, false);
  } finally {
    await h.close();
  }
});

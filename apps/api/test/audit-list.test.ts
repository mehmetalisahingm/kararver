/**
 * KV-39 (#41) audit okuma (admin.audit.list) ve kabul: gerçek yönetici işlemleri kayıt üretir, liste filtrelenir ve
 * sayfalanır, yalnız ADMIN+ okur, kayıt değiştirilemez/silinemez, sırlar ve kişisel veri görünmez, içerik geçmişi
 * okuması da izlenir (revision.read). #185: requestId / reasonContains / outcome süzgeçleri ve yanıttaki hassas alan temizliği.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { AuditEntry, ErrorBody, PollDetail } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";
import { rbacSeeds } from "./support/rbac-probe.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string; email: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };

describe("audit okuma (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let root: User;
  let admin: User;
  let moderator: User;
  let categoryId: string;

  function send(method: "GET" | "POST" | "PUT", url: string, body?: unknown, cookie?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
        ...(method === "POST" ? { "idempotency-key": `audit-${randomUUID()}` } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as Promise<Res>;
  }
  const assertError = (res: Res, status: number, code: string) => {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  };

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `audit_${id}@example.test`, username: `audit_${id}`, displayName: "Audit", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id, email: account.email };
  }

  const list = async (query: string, cookie = admin.cookie) => {
    const res = await send("GET", `/admin/audit${query}`, undefined, cookie);
    assert.equal(res.statusCode, 200, res.body);
    return { items: (res.json().data as unknown[]).map((e) => AuditEntry.parse(e)), next: res.json().page.nextCursor as string | null };
  };

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `audit-${randomUUID().slice(0, 8)}`, name: "Audit" } })).id;
    root = await signUp();
    admin = await signUp();
    moderator = await signUp();
    const seeds = rbacSeeds(h);
    await seeds.setRole(root.id, "SUPER_ADMIN", null);
    await seeds.setRole(admin.id, "ADMIN", root.id);
    await seeds.setRole(moderator.id, "MODERATOR", root.id);
  });
  after(async () => {
    await h?.close();
  });

  test("gerçek yönetici işlemleri kayıt üretir: aktör, işlem, tür, hedef, gerekçe ve istek kimliği; en yeni önce", async () => {
    const target = await signUp();
    const warn = await send("POST", `/admin/users/${target.id}/sanctions`, { type: "WARNING", reason: "Kaba dil uyarısı" }, admin.cookie);
    assert.equal(warn.statusCode, 201, warn.body);
    const slug = `aud-${randomUUID().slice(0, 8)}`;
    const cat = await send("POST", "/admin/categories", { slug, name: "Audit Kategorisi", reason: "Yeni kategori ihtiyacı" }, admin.cookie);
    assert.equal(cat.statusCode, 201, cat.body);

    const { items } = await list(`?actorId=${admin.id}&limit=10`);
    const [category, sanction] = items;
    assert.deepEqual(
      [category!.action, category!.operation, category!.target.type, category!.reason, category!.requestId],
      ["category.manage", "create", "CATEGORY", "Yeni kategori ihtiyacı", cat.headers["x-request-id"]],
    );
    assert.deepEqual(
      [sanction!.action, sanction!.operation, sanction!.target, sanction!.reason, sanction!.requestId],
      ["user.sanction", "apply", { type: "USER", id: target.id }, "Kaba dil uyarısı", warn.headers["x-request-id"]],
    );
    for (const e of [category!, sanction!]) {
      assert.deepEqual([e.source, e.actor?.id, e.actor?.username], ["API", admin.id, `audit_${admin.email.slice(6, 16)}`]);
      assert.ok(Date.parse(e.createdAt) > 0);
    }
    assert.ok(Date.parse(category!.createdAt) >= Date.parse(sanction!.createdAt), "en yeni önce");
  });

  test("filtreler (işlem, tür, hedef, kaynak, zaman) ve cursor; cursor başka filtreyle kullanılamaz", async () => {
    const targets = [await signUp(), await signUp(), await signUp()];
    for (const t of targets) {
      const r = await send("POST", `/admin/users/${t.id}/sanctions`, { type: "WARNING", reason: "Sayfalama testi" }, admin.cookie);
      assert.equal(r.statusCode, 201, r.body);
    }
    const one = await list(`?targetType=USER&targetId=${targets[1]!.id}`);
    assert.deepEqual(one.items.map((e) => e.target.id), [targets[1]!.id]);

    const page1 = await list(`?action=user.sanction&operation=apply&source=API&limit=2`);
    assert.equal(page1.items.length, 2);
    assert.ok(page1.next);
    const page2 = await list(`?action=user.sanction&operation=apply&source=API&limit=2&cursor=${encodeURIComponent(page1.next!)}`);
    assert.ok(page2.items.length >= 1);
    assert.equal(new Set([...page1.items, ...page2.items].map((e) => e.id)).size, page1.items.length + page2.items.length, "sayfalar çakışmaz");

    const other = await send("GET", `/admin/audit?action=category.manage&limit=2&cursor=${encodeURIComponent(page1.next!)}`, undefined, admin.cookie);
    assertError(other, 400, "INVALID_CURSOR");

    const future = new Date(h.clock.now.getTime() + 3600_000).toISOString();
    // Aynı test veritabanını kullanan diğer dosyalar saati ileri sarar; kontrol bu testin hedefleriyle sınırlı.
    const mine = `&targetType=USER&targetId=${targets[0]!.id}`;
    assert.equal((await list(`?action=user.sanction${mine}&from=${encodeURIComponent(future)}`)).items.length, 0);
    const past = new Date(h.clock.now.getTime() - 3600_000).toISOString();
    assert.equal((await list(`?action=user.sanction${mine}&from=${encodeURIComponent(past)}&to=${encodeURIComponent(future)}`)).items.length, 1);
    // CLI kaynaklı kayıt (admin:bootstrap) ayrı süzülür: API süzgecine girmez.
    assert.ok((await list(`?source=API&limit=50`)).items.every((e) => e.source === "API"));
  });

  test("#185 requestId ve reasonContains süzgeçleri; cursor bu süzgeçlere de bağlı", async () => {
    const tag = randomUUID().slice(0, 8);
    const targets = [await signUp(), await signUp(), await signUp()];
    const responses = [];
    for (const [i, t] of targets.entries()) {
      const reason = i === 2 ? `Başka gerekçe ${tag}` : `Kampanya %${tag} spam ${i}`;
      const r = await send("POST", `/admin/users/${t.id}/sanctions`, { type: "WARNING", reason }, admin.cookie);
      assert.equal(r.statusCode, 201, r.body);
      responses.push(r);
    }
    const requestId = responses[1]!.headers["x-request-id"] as string;
    const byRequest = await list(`?requestId=${encodeURIComponent(requestId)}`);
    assert.deepEqual(byRequest.items.map((e) => [e.target.id, e.requestId]), [[targets[1]!.id, requestId]]);
    assert.equal((await list(`?requestId=${encodeURIComponent(`${requestId}-yok`)}`)).items.length, 0);

    const range = `&from=${encodeURIComponent(new Date(h.clock.now.getTime() - 3600_000).toISOString())}&to=${encodeURIComponent(new Date(h.clock.now.getTime() + 3600_000).toISOString())}`;
    const reasons = async (text: string, extra = "") =>
      (await list(`?reasonContains=${encodeURIComponent(text)}${range}${extra}`)).items.map((e) => e.reason).sort();
    assert.deepEqual(await reasons(`%${tag} SPAM`), [`Kampanya %${tag} spam 0`, `Kampanya %${tag} spam 1`], "harf duyarsız");
    assert.deepEqual(await reasons(`gerekçe ${tag}`), [`Başka gerekçe ${tag}`]);
    assert.deepEqual(await reasons(`yok ${tag}`), []);
    // "%" ve "_" joker olsaydı bu aralıktaki bütün kayıtlar dönerdi; düz karakter olarak yalnız "%" içerenler döner.
    const percent = await list(`?reasonContains=${encodeURIComponent("%" + tag.slice(0, 2))}${range}&limit=100`);
    assert.ok(percent.items.length >= 2 && percent.items.every((e) => e.reason?.includes(`%${tag.slice(0, 2)}`)), "% düz karakter");
    assert.ok((await list(`?reasonContains=${encodeURIComponent("___")}${range}&limit=100`)).items.every((e) => e.reason?.includes("___")), "_ düz karakter");

    const page1 = await list(`?reasonContains=${encodeURIComponent(`%${tag}`)}${range}&limit=1`);
    assert.equal(page1.items.length, 1);
    assert.ok(page1.next);
    const page2 = await list(`?reasonContains=${encodeURIComponent(`%${tag}`)}${range}&limit=1&cursor=${encodeURIComponent(page1.next!)}`);
    assert.notEqual(page2.items[0]?.id, page1.items[0]!.id);
    const cursor = `&limit=1&cursor=${encodeURIComponent(page1.next!)}`;
    assertError(await send("GET", `/admin/audit?reasonContains=${encodeURIComponent(`spam ${tag}`)}${range}${cursor}`, undefined, admin.cookie), 400, "INVALID_CURSOR");
    assertError(await send("GET", `/admin/audit?reasonContains=${encodeURIComponent(`%${tag}`)}${range}&requestId=${encodeURIComponent(requestId)}${cursor}`, undefined, admin.cookie), 400, "INVALID_CURSOR");
    const byRequestPage = await list(`?requestId=${encodeURIComponent(requestId)}&limit=1`);
    assert.equal(byRequestPage.next, null);
  });

  test("#185 outcome süzgeci (işlem, türden türetilir); yanıtta outcome; cursor outcome'a bağlı", async () => {
    // Aynı hedefte altı kayıt: tür adı tek başına sonucu belirlemez (moderasyon lock uygulanmış, MFA lock engellenmiş).
    const targetId = randomUUID();
    const rows: [string, string, "API" | "WORKER"][] = [
      ["account.mfa", "deny", "API"],
      ["account.mfa", "lock", "API"],
      ["report.resolve", "dismissed", "API"],
      ["moderation.bulk.expire", "expire", "WORKER"],
      ["moderation.poll.apply", "lock", "API"],
      ["account.mfa", "verify", "API"],
    ];
    for (const [i, [action, operation, source]] of rows.entries()) {
      await db.auditLog.create({
        data: { actorId: source === "API" ? admin.id : null, source, action, operation, targetType: "USER", targetId, reason: null, requestId: source === "API" ? `outcome-${i}` : null },
      });
    }
    const pick = async (outcome: string) =>
      (await list(`?targetId=${targetId}&outcome=${outcome}`)).items.map((e) => `${e.action}/${e.operation}:${e.outcome}`).sort();
    assert.deepEqual(await pick("DENIED"), ["account.mfa/deny:DENIED", "account.mfa/lock:DENIED"]);
    assert.deepEqual(await pick("REJECTED"), ["report.resolve/dismissed:REJECTED"]);
    assert.deepEqual(await pick("CANCELLED"), ["moderation.bulk.expire/expire:CANCELLED"]);
    assert.deepEqual(await pick("APPLIED"), ["account.mfa/verify:APPLIED", "moderation.poll.apply/lock:APPLIED"]);
    // Diğer süzgeçlerle birlikte (AND): aynı işlem içinde yalnız sonucu tutanlar.
    assert.deepEqual((await list(`?targetId=${targetId}&action=account.mfa&outcome=APPLIED`)).items.map((e) => e.operation), ["verify"]);
    assert.equal((await list(`?targetId=${targetId}`)).items.length, rows.length, "süzgeçsiz hepsi");

    assertError(await send("GET", `/admin/audit?outcome=FAILED`, undefined, admin.cookie), 400, "VALIDATION_ERROR");
    const page1 = await list(`?targetId=${targetId}&outcome=DENIED&limit=1`);
    assert.ok(page1.next);
    assertError(await send("GET", `/admin/audit?targetId=${targetId}&outcome=APPLIED&limit=1&cursor=${encodeURIComponent(page1.next!)}`, undefined, admin.cookie), 400, "INVALID_CURSOR");
    const page2 = await list(`?targetId=${targetId}&outcome=DENIED&limit=1&cursor=${encodeURIComponent(page1.next!)}`);
    assert.deepEqual([...page1.items, ...page2.items].map((e) => e.operation).sort(), ["deny", "lock"]);
  });

  test("#185 reasonContains sınırları: from/to zorunlu, en çok 31 gün, 3..100 karakter; requestId en çok 128", async () => {
    const from = h.clock.now.getTime();
    const iso = (days: number) => encodeURIComponent(new Date(from + days * 86_400_000).toISOString());
    const get = (q: string) => send("GET", `/admin/audit?${q}`, undefined, admin.cookie);
    for (const q of [
      "reasonContains=spam",
      `reasonContains=spam&from=${iso(0)}`,
      `reasonContains=spam&to=${iso(1)}`,
      `reasonContains=spam&from=${iso(0)}&to=${iso(32)}`,
      `reasonContains=spam&from=${iso(1)}&to=${iso(0)}`,
      `reasonContains=ab&from=${iso(0)}&to=${iso(1)}`,
      `reasonContains=${"x".repeat(101)}&from=${iso(0)}&to=${iso(1)}`,
      `requestId=${"r".repeat(129)}`,
    ])
      assertError(await get(q), 400, "VALIDATION_ERROR");
    assert.equal((await get(`reasonContains=spam&from=${iso(0)}&to=${iso(31)}`)).statusCode, 200, "tam 31 gün");
  });

  test("#185 yanıtta hassas anahtarların değeri [gizli] (iç içe dahil); kayıt değişmez", async () => {
    const targetId = randomUUID();
    // Yazma yolu (assertAuditEntry) hassas anahtarı reddeder; eski/elle eklenmiş kaydı taklit etmek için doğrudan yazılır.
    // Zaman çok eski: "en yeni" listelerine (ör. aşağıdaki sır taraması) girmez.
    const before = { status: "ACTIVE", passwordHash: "$argon2id$gizli", profile: { Email: "x@example.test", security: { totpSecret: "JBSW", recoveryCodes: ["a"] } } };
    const after = { status: "SUSPENDED", sessions: [{ sessionToken: "tok" }], devices: [{ ipAddress: "203.0.113.7", userAgent: "Mozilla", label: "telefon" }], description: "kalır" };
    await db.auditLog.create({
      data: { source: "CLI", action: "user.status.sync", operation: "sync", targetType: "USER", targetId, before, after, createdAt: new Date("2000-01-01T00:00:00.000Z") },
    });
    const [entry] = (await list(`?targetId=${targetId}`)).items;
    assert.deepEqual(entry!.before, { status: "ACTIVE", passwordHash: "[gizli]", profile: { Email: "[gizli]", security: { totpSecret: "[gizli]", recoveryCodes: "[gizli]" } } });
    assert.deepEqual(entry!.after, { status: "SUSPENDED", sessions: "[gizli]", devices: [{ ipAddress: "[gizli]", userAgent: "[gizli]", label: "telefon" }], description: "kalır" });
    const stored = await db.auditLog.findFirstOrThrow({ where: { targetId }, select: { before: true, after: true } });
    assert.deepEqual([stored.before, stored.after], [before, after], "DB'deki kayıt değişmedi");
  });

  test("yalnız ADMIN+ okur: misafir 401, kullanıcı ve moderatör 403; yazma/silme endpoint'i yok", async () => {
    const user = await signUp();
    assertError(await send("GET", "/admin/audit"), 401, "UNAUTHENTICATED");
    assertError(await send("GET", "/admin/audit", undefined, user.cookie), 403, "FORBIDDEN");
    assertError(await send("GET", "/admin/audit", undefined, moderator.cookie), 403, "FORBIDDEN");
    assert.equal((await send("GET", "/admin/audit", undefined, root.cookie)).statusCode, 200);
    // #185: yeni süzgeçler yetkiyi değiştirmez; geçerli sorgu da olsa ADMIN olmayan 403 alır.
    const now = h.clock.now.getTime();
    const filtered = `/admin/audit?requestId=req-1&reasonContains=spam&from=${encodeURIComponent(new Date(now).toISOString())}&to=${encodeURIComponent(new Date(now + 86_400_000).toISOString())}`;
    assertError(await send("GET", filtered), 401, "UNAUTHENTICATED");
    assertError(await send("GET", filtered, undefined, user.cookie), 403, "FORBIDDEN");
    assertError(await send("GET", filtered, undefined, moderator.cookie), 403, "FORBIDDEN");
    for (const method of ["POST", "PUT"] as const) {
      assert.equal((await send(method, "/admin/audit", {}, admin.cookie)).statusCode, 404, `${method} /admin/audit yok`);
    }
  });

  test("admin kendi kaydını değiştiremez ve silemez (veritabanı da reddeder)", async () => {
    const { items } = await list(`?actorId=${admin.id}&limit=1`);
    const id = items[0]!.id;
    await assert.rejects(db.auditLog.update({ where: { id }, data: { reason: "Değiştirilmiş gerekçe" } }), /KV_AUDIT_LOGS_APPEND_ONLY/);
    await assert.rejects(db.auditLog.delete({ where: { id } }), /KV_AUDIT_LOGS_APPEND_ONLY/);
    await assert.rejects(db.$executeRawUnsafe("TRUNCATE audit_logs"), /KV_AUDIT_LOGS_APPEND_ONLY/);
    assert.equal((await list(`?actorId=${admin.id}&limit=1`)).items[0]!.id, id);
  });

  test("içerik geçmişi okuması izlenir (revision.read); sonraki sayfa ayrı kayıt üretmez", async () => {
    const owner = await signUp();
    const res = await send(
      "POST",
      "/polls",
      { kind: "POLL", title: `Geçmiş ${randomUUID().slice(0, 8)}`, categoryId, durationHours: 24, resultsVisibility: "ALWAYS", options: [{ label: "A" }, { label: "B" }] },
      owner.cookie,
    );
    assert.equal(res.statusCode, 201, res.body);
    const poll = PollDetail.parse(res.json().data);
    const read = await send("GET", `/admin/polls/${poll.id}/revisions?limit=1`, undefined, admin.cookie);
    assert.equal(read.statusCode, 200, read.body);
    const logs = await list(`?action=revision.read&targetId=${poll.id}`);
    assert.deepEqual(
      logs.items.map((e) => [e.actor?.id, e.operation, e.target.type, e.requestId]),
      [[admin.id, "read", "POLL", read.headers["x-request-id"]]],
    );
    const next = read.json().page.nextCursor as string | null;
    if (next) await send("GET", `/admin/polls/${poll.id}/revisions?limit=1&cursor=${encodeURIComponent(next)}`, undefined, admin.cookie);
    assert.equal((await list(`?action=revision.read&targetId=${poll.id}`)).items.length, 1);
    // Moderatör geçmişi okuyamaz; iz de oluşmaz.
    assertError(await send("GET", `/admin/polls/${poll.id}/revisions`, undefined, moderator.cookie), 403, "FORBIDDEN");
    assert.equal((await list(`?action=revision.read&targetId=${poll.id}`)).items.length, 1);
  });

  test("kayıtlarda sır ve kişisel veri yok: e-posta, parola, token, oturum, IP, oy seçimi", async () => {
    const { items } = await list("?limit=100");
    assert.ok(items.length > 0);
    const text = JSON.stringify(items);
    for (const u of [root, admin, moderator]) assert.ok(!text.includes(u.email), "e-posta");
    assert.ok(!/password|passwordHash|token|cookie|sessionId|ipAddress|userAgent|optionId/i.test(JSON.stringify(items.map((e) => [e.before, e.after]))));
  });
});

/**
 * KV-39 (#41) audit okuma (admin.audit.list) ve kabul: gerçek yönetici işlemleri kayıt üretir, liste filtrelenir ve
 * sayfalanır, yalnız ADMIN+ okur, kayıt değiştirilemez/silinemez, sırlar ve kişisel veri görünmez, içerik geçmişi
 * okuması da izlenir (revision.read).
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

  test("yalnız ADMIN+ okur: misafir 401, kullanıcı ve moderatör 403; yazma/silme endpoint'i yok", async () => {
    const user = await signUp();
    assertError(await send("GET", "/admin/audit"), 401, "UNAUTHENTICATED");
    assertError(await send("GET", "/admin/audit", undefined, user.cookie), 403, "FORBIDDEN");
    assertError(await send("GET", "/admin/audit", undefined, moderator.cookie), 403, "FORBIDDEN");
    assert.equal((await send("GET", "/admin/audit", undefined, root.cookie)).statusCode, 200);
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

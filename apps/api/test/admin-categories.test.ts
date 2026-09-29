/**
 * KV-26 (#28) admin kategori yönetimi (admin.categories.*). Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL).
 * Yetki KV-12 RBAC katmanından gelir (category.manage, ADMIN+); rol satırları rbacSeeds ile yazılır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { AdminCategory, ErrorBody } from "@kararver/contracts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";
import { rbacSeeds } from "./support/rbac-probe.ts";

const backend = prismaBackend();

describe("admin kategori yönetimi (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let admin: { cookie: string; id: string };

  function send(method: "GET" | "POST" | "PATCH", url: string, body?: unknown, cookie?: string, key?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function assertError(res: { statusCode: number; json(): any }, status: number, code: string) {
    assert.equal(res.statusCode, status, JSON.stringify(res.json()));
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp() {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `kat_${id}@example.test`, username: `kat_${id}`, displayName: "Kategori", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  const slug = (prefix = "kat") => `${prefix}-${randomUUID().slice(0, 8)}`;
  const create = (body: Record<string, unknown>, cookie = admin.cookie, key?: string) =>
    send("POST", "/admin/categories", { reason: "yeni kategori ihtiyacı", ...body }, cookie, key);
  const update = (id: string, body: Record<string, unknown>) =>
    send("PATCH", `/admin/categories/${id}`, { reason: "düzenleme gerekçesi", ...body }, admin.cookie);
  const publicIds = async () => ((await send("GET", "/categories")).json().data as { id: string }[]).map((c) => c.id);

  async function createOk(body: Record<string, unknown>) {
    const res = await create(body);
    assert.equal(res.statusCode, 201, res.body);
    return AdminCategory.parse(res.json().data);
  }

  before(async () => {
    h = await createHarness(backend!);
    const seeds = rbacSeeds(h);
    const root = await signUp();
    await seeds.setRole(root.id, "SUPER_ADMIN", null);
    admin = await signUp();
    await seeds.setRole(admin.id, "ADMIN", root.id);
  });
  after(async () => {
    await h?.close();
  });

  test("yetki: misafir 401, kullanıcı ve moderatör 403, ADMIN geçer", async () => {
    const user = await signUp();
    const moderator = await signUp();
    const seeds = rbacSeeds(h);
    await seeds.setRole(moderator.id, "MODERATOR", admin.id);

    assertError(await send("GET", "/admin/categories"), 401, "UNAUTHENTICATED");
    assertError(await send("GET", "/admin/categories", undefined, user.cookie), 403, "FORBIDDEN");
    assertError(await send("GET", "/admin/categories", undefined, moderator.cookie), 403, "FORBIDDEN");
    assertError(await create({ slug: slug(), name: "Yetkisiz" }, moderator.cookie), 403, "FORBIDDEN");
    assert.equal((await send("GET", "/admin/categories", undefined, admin.cookie)).statusCode, 200);
  });

  test("oluşturma: varsayılanlar, public listede görünür; aynı slug 409; gerekçe zorunlu", async () => {
    const s = slug();
    const cat = await createOk({ slug: s, name: "Bahçe", description: "Bitkiler", sortOrder: 500 });
    assert.deepEqual(
      { slug: cat.slug, name: cat.name, description: cat.description, iconKey: cat.iconKey, sortOrder: cat.sortOrder, isActive: cat.isActive, pollCount: cat.pollCount },
      { slug: s, name: "Bahçe", description: "Bitkiler", iconKey: null, sortOrder: 500, isActive: true, pollCount: 0 },
    );
    assert.ok((await publicIds()).includes(cat.id));

    assertError(await create({ slug: s, name: "Başka" }), 409, "CONFLICT");
    assertError(await create({ slug: "otomobil", name: "Seed ile çakışan" }), 409, "CONFLICT");
    assertError(await send("POST", "/admin/categories", { slug: slug(), name: "Gerekçesiz" }, admin.cookie), 400, "VALIDATION_ERROR");
    assertError(await create({ slug: slug(), name: "Taşan", sortOrder: 2 ** 31 }), 400, "VALIDATION_ERROR");
  });

  test("Idempotency-Key: aynı istek aynı kaydı döner, farklı gövde 409", async () => {
    const key = `test-${randomUUID()}`;
    const body = { slug: slug(), name: "Tekrarlanan" };
    const first = await create(body, admin.cookie, key);
    const second = await create(body, admin.cookie, key);
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(second.statusCode, 201, second.body);
    assert.equal(second.json().data.id, first.json().data.id);
    assertError(await create({ ...body, name: "Farklı" }, admin.cookie, key), 409, "IDEMPOTENCY_KEY_REUSED");
  });

  test("eşzamanlı: aynı slug'la 10 istek tek kayıt; aynı anahtarla 10 istek tek kayıt, hepsi 201", async () => {
    const s = slug();
    const racing = await Promise.all(Array.from({ length: 10 }, (_, i) => create({ slug: s, name: `Yarış ${i}` })));
    assert.deepEqual(racing.map((r) => r.statusCode).sort(), [201, ...Array(9).fill(409)]);
    assert.equal(await h.prisma!.category.count({ where: { slug: s } }), 1);

    const key = `test-${randomUUID()}`;
    const body = { slug: slug(), name: "Aynı anahtar" };
    const replays = await Promise.all(Array.from({ length: 10 }, () => create(body, admin.cookie, key)));
    assert.deepEqual(
      replays.map((r) => r.statusCode),
      Array(10).fill(201),
      replays.map((r) => r.body).join("\n"),
    );
    assert.equal(new Set(replays.map((r) => r.json().data.id)).size, 1);
    assert.equal(await h.prisma!.category.count({ where: { slug: body.slug } }), 1);
  });

  test("aynı slug'ı yazan açık transaction commit edince bekleyen istek 500 değil 409 alır", async () => {
    // HTTP yarışı zamanlamaya bağlı; burada çakışan yazma elle tutulur. Kilit olmasaydı istek
    // commit edilmemiş satırı göremez, unique index'te bekler ve P2002 ile 500 dönerdi.
    const s = slug();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));
    const holder = h.prisma!.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`categories.slug:${s}`}, 0))`;
        await tx.category.create({ data: { slug: s, name: "Tutulan" } });
        locked();
        await hold;
      },
      { timeout: 10_000 },
    );
    await holding;
    const pending = create({ slug: s, name: "Bekleyen" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await holder;
    assertError(await pending, 409, "CONFLICT");
  });

  test("güncelleme: alan değişir, slug çakışması 409, olmayan kategori 404", async () => {
    const a = await createOk({ slug: slug(), name: "Birinci" });
    const b = await createOk({ slug: slug(), name: "İkinci" });

    const res = await update(a.id, { name: "Birinci (yeni)", iconKey: "leaf", description: null });
    assert.equal(res.statusCode, 200, res.body);
    const updated = AdminCategory.parse(res.json().data);
    assert.equal(updated.name, "Birinci (yeni)");
    assert.equal(updated.iconKey, "leaf");
    assert.equal(updated.slug, a.slug);

    assertError(await update(a.id, { slug: b.slug }), 409, "CONFLICT");
    assert.equal((await update(a.id, { slug: a.slug })).statusCode, 200, "kendi slug'ı çakışma sayılmaz");
    assertError(await update(randomUUID(), { name: "Yok" }), 404, "NOT_FOUND");
  });

  test("pasife alma: public listeden çıkar, anket sayısı kalır; tekrar aktif edilebilir", async () => {
    const cat = await createOk({ slug: slug(), name: "Geçici" });
    const author = await signUp();
    const poll = await send(
      "POST",
      "/polls",
      { kind: "POLL", title: `Geçici kategoride ${randomUUID()}`, categoryId: cat.id, durationHours: 24, resultsVisibility: "ALWAYS", options: [{ label: "A" }, { label: "B" }] },
      author.cookie,
      `test-${randomUUID()}`,
    );
    assert.equal(poll.statusCode, 201, poll.body);

    const off = AdminCategory.parse((await update(cat.id, { isActive: false })).json().data);
    assert.equal(off.isActive, false);
    assert.equal(off.pollCount, 1);
    assert.ok(!(await publicIds()).includes(cat.id));

    assert.equal(AdminCategory.parse((await update(cat.id, { isActive: true })).json().data).isActive, true);
    assert.ok((await publicIds()).includes(cat.id));
  });

  test("liste: pasifler dahil sortOrder + id sıralı; sayfalama tekrar/kayıp yok", async () => {
    const inactive = await createOk({ slug: slug(), name: "Pasif liste", sortOrder: 7, isActive: false });
    const same = [await createOk({ slug: slug(), name: "Eşit A", sortOrder: 7 }), await createOk({ slug: slug(), name: "Eşit B", sortOrder: 7 })];

    // Diğer test dosyaları aynı DB'de paralel kategori ekleyebilir: yürüyüşten önce var olanların hepsi gelmeli.
    const existing = (await h.prisma!.category.findMany({ select: { id: true } })).map((c) => c.id);
    const seen: { id: string; sortOrder: number }[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await send("GET", `/admin/categories?limit=3${cursor ? `&cursor=${cursor}` : ""}`, undefined, admin.cookie);
      assert.equal(res.statusCode, 200, res.body);
      for (const item of res.json().data) seen.push(AdminCategory.parse(item));
      cursor = res.json().page.nextCursor;
      pages++;
    } while (cursor && pages < 200);

    const ids = seen.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, "tekrar yok");
    assert.deepEqual(existing.filter((id) => !ids.includes(id)), [], "kayıp yok");
    for (const c of [inactive, ...same]) assert.ok(ids.includes(c.id));
    const sorted = [...seen].sort((x, y) => x.sortOrder - y.sortOrder || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    assert.deepEqual(ids, sorted.map((c) => c.id));

    // Cursor listeye bağlı: arama cursor'ı burada geçersiz.
    const other = (await send("GET", "/search?type=categories&q=er&limit=1")).json().page.nextCursor as string;
    assert.ok(other);
    assertError(await send("GET", `/admin/categories?cursor=${other}`, undefined, admin.cookie), 400, "INVALID_CURSOR");
  });
});

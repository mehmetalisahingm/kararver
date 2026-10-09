/**
 * KV-32 (#34) topluluk yönetimi: admin.communities.create/update/moderators.put/moderators.delete.
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL; CI'da tanımlı). Moderatörlük ve kapatma kararları
 * her istekte DB'den okunduğu için "açık oturumda etkili" davranışı burada gerçek oturumlarla doğrulanır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { CommunityDetail, ErrorBody } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string };

describe("topluluk yönetimi (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let superAdmin: User;
  let admin: User;
  let categoryId: string;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `topluluk-yonetim-${randomUUID().slice(0, 8)}`, name: "Topluluk Yönetimi" } })).id;
    superAdmin = await signUp();
    await db.userRole.create({ data: { userId: superAdmin.id, role: "SUPER_ADMIN" } });
    admin = await staff("ADMIN");
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, cookie?: string, key?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const get = (url: string, cookie?: string) => send("GET", url, undefined, cookie);

  function assertError(res: { statusCode: number; body: string; json(): any }, status: number, code: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `ty_${id}@example.test`, username: `ty_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  async function staff(role: "ADMIN" | "MODERATOR"): Promise<User> {
    const user = await signUp();
    await db.userRole.create({ data: { userId: user.id, role, grantedById: superAdmin.id } });
    return user;
  }

  const slug = () => `kampus-${randomUUID().slice(0, 8)}`;
  const create = (cookie: string | undefined, body: Record<string, unknown> = {}, key?: string) =>
    send("POST", "/admin/communities", { slug: slug(), name: "Samsun Üniversitesi", ...body }, cookie, key);
  const patch = (cookie: string | undefined, id: string, body: Record<string, unknown>) =>
    send("PATCH", `/admin/communities/${id}`, { reason: "Yönetici düzenlemesi", ...body }, cookie);
  const assign = (cookie: string | undefined, id: string, userId: string) =>
    send("PUT", `/admin/communities/${id}/moderators/${userId}`, { reason: "Topluluk moderatörü olarak atandı" }, cookie);
  const unassign = (cookie: string | undefined, id: string, userId: string) =>
    send("DELETE", `/admin/communities/${id}/moderators/${userId}`, undefined, cookie);

  async function newCommunity(body: Record<string, unknown> = {}) {
    const res = await create(admin.cookie, body);
    assert.equal(res.statusCode, 201, res.body);
    return CommunityDetail.parse(res.json().data);
  }

  async function communityMedia(status: "APPROVED" | "QUARANTINED" = "APPROVED", purpose: "COMMUNITY" | "POLL" = "COMMUNITY") {
    const uploader = await signUp();
    const key = `test/${randomUUID()}`;
    return db.mediaAsset.create({
      data: {
        uploaderId: uploader.id,
        purpose,
        status,
        originalObjectKey: `${key}/original`,
        processedObjectKey: `${key}/processed.webp`,
        ...(status === "APPROVED" ? { publicObjectKey: `m/${randomUUID()}.webp` } : {}),
      },
    });
  }

  // ─── Yetki ──────────────────────────────────────────────────

  test("yetki: misafir 401; normal kullanıcı ve topluluk moderatörü 403", async () => {
    const community = await newCommunity();
    const user = await signUp();
    const moderator = await staff("MODERATOR");
    await db.communityMembership.create({ data: { communityId: community.id, userId: moderator.id, role: "MODERATOR" } });

    for (const cookie of [user.cookie, moderator.cookie]) {
      assertError(await create(cookie), 403, "FORBIDDEN");
      assertError(await patch(cookie, community.id, { name: "Değişti" }), 403, "FORBIDDEN");
      assertError(await assign(cookie, community.id, user.id), 403, "FORBIDDEN");
      assertError(await unassign(cookie, community.id, moderator.id), 403, "FORBIDDEN");
    }
    assertError(await create(undefined), 401, "UNAUTHENTICATED");
    assertError(await assign(undefined, community.id, user.id), 401, "UNAUTHENTICATED");
    assert.equal((await db.community.findUniqueOrThrow({ where: { id: community.id } })).name, "Samsun Üniversitesi");
    assert.equal((await db.communityMembership.findUniqueOrThrow({ where: { communityId_userId: { communityId: community.id, userId: moderator.id } } })).role, "MODERATOR");
  });

  // ─── Oluşturma ──────────────────────────────────────────────

  test("topluluk açılır: varsayılan görünürlük MEMBERS, yönetici üye sayılmaz, kamuya açık sayfada görünür", async () => {
    const res = await create(admin.cookie, { description: "  Kampüs soruları  " });
    assert.equal(res.statusCode, 201, res.body);
    const created = CommunityDetail.parse(res.json().data);
    assert.deepEqual(
      [created.name, created.description, created.membersVisibility, created.memberCount, created.imageUrl, created.viewer],
      ["Samsun Üniversitesi", "Kampüs soruları", "MEMBERS", 0, null, { role: null }],
    );
    const row = await db.community.findUniqueOrThrow({ where: { id: created.id } });
    assert.deepEqual([row.status, row.createdById], ["ACTIVE", admin.id]);

    const page = await get(`/communities/${created.slug}`);
    assert.equal(page.statusCode, 200, page.body);
    assert.equal(page.json().data.id, created.id);
  });

  test("slug çakışması 409 CONFLICT (field=slug); eşzamanlı aynı slug tek topluluk üretir", async () => {
    const taken = await newCommunity();
    const dup = await create(admin.cookie, { slug: taken.slug });
    assertError(dup, 409, "CONFLICT");
    assert.equal(dup.json().error.details[0].field, "slug");

    const same = slug();
    const results = await Promise.all(Array.from({ length: 5 }, () => create(admin.cookie, { slug: same })));
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409, 409, 409, 409]);
    assert.equal(await db.community.count({ where: { slug: same } }), 1);
  });

  test("Idempotency-Key: aynı anahtar aynı topluluğu döner, farklı gövde 422/409 reddedilir", async () => {
    const key = `topluluk-${randomUUID()}`;
    const body = { slug: slug(), name: "Tekrar Denenen" };
    const first = await send("POST", "/admin/communities", body, admin.cookie, key);
    const again = await send("POST", "/admin/communities", body, admin.cookie, key);
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(again.statusCode, 201, again.body);
    assert.equal(again.json().data.id, first.json().data.id);
    assert.equal(await db.community.count({ where: { slug: body.slug } }), 1);

    const reused = await send("POST", "/admin/communities", { ...body, name: "Başka" }, admin.cookie, key);
    assert.equal(reused.json().error.code, "IDEMPOTENCY_KEY_REUSED", reused.body);
  });

  test("topluluk görseli: yayınlanmış COMMUNITY görseli bağlanır; karantinadaki ya da başka amaçlı görsel 400", async () => {
    const approved = await communityMedia();
    const community = await newCommunity({ imageMediaId: approved.id });
    assert.equal(community.imageUrl, `http://cdn.test/media/${approved.publicObjectKey}`);

    for (const bad of [await communityMedia("QUARANTINED"), await communityMedia("APPROVED", "POLL"), { id: randomUUID() }]) {
      const res = await create(admin.cookie, { imageMediaId: bad.id });
      assertError(res, 400, "VALIDATION_ERROR");
      assert.equal(res.json().error.details[0].field, "imageMediaId");
    }
    assertError(await patch(admin.cookie, community.id, { imageMediaId: (await communityMedia("QUARANTINED")).id }), 400, "VALIDATION_ERROR");
    assert.equal((await db.community.findUniqueOrThrow({ where: { id: community.id } })).imageMediaId, approved.id);
  });

  test("geçersiz gövde 400: kötü slug, kısa ad, bilinmeyen alan", async () => {
    for (const body of [{ slug: "Büyük Harf" }, { slug: "a" }, { name: "x" }, { membersVisibility: "HERKES" }, { rol: "ADMIN" }]) {
      assertError(await create(admin.cookie, body), 400, "VALIDATION_ERROR");
    }
  });

  // ─── Düzenleme ve kapatma ───────────────────────────────────

  test("düzenleme: yalnız gönderilen alanlar değişir; slug çakışması 409; olmayan topluluk 404", async () => {
    const community = await newCommunity({ description: "Eski açıklama" });
    const other = await newCommunity();

    const res = await patch(admin.cookie, community.id, { name: "Yeni Ad", membersVisibility: "PUBLIC" });
    assert.equal(res.statusCode, 200, res.body);
    const updated = CommunityDetail.parse(res.json().data);
    assert.deepEqual(
      [updated.name, updated.membersVisibility, updated.description, updated.slug],
      ["Yeni Ad", "PUBLIC", "Eski açıklama", community.slug],
    );

    assert.equal((await patch(admin.cookie, community.id, { description: "" })).json().data.description, null);
    assertError(await patch(admin.cookie, community.id, { slug: other.slug }), 409, "CONFLICT");
    const renamed = slug();
    assert.equal((await patch(admin.cookie, community.id, { slug: renamed })).json().data.slug, renamed);
    assert.equal((await get(`/communities/${renamed}`)).statusCode, 200);
    assertError(await get(`/communities/${community.slug}`), 404, "NOT_FOUND");

    assertError(await patch(admin.cookie, randomUUID(), { name: "Yok" }), 404, "NOT_FOUND");
    assertError(await send("PATCH", `/admin/communities/${community.id}`, { reason: "gerekçe var" }, admin.cookie), 400, "VALIDATION_ERROR");
    assertError(await send("PATCH", `/admin/communities/${community.id}`, { name: "Gerekçesiz" }, admin.cookie), 400, "VALIDATION_ERROR");
  });

  test("kapatma açık oturumlarda hemen etkilidir; üyelikler korunur ve yeniden açılınca geri gelir", async () => {
    const community = await newCommunity({ membersVisibility: "PUBLIC" });
    const member = await signUp();
    const author = await signUp();
    for (const user of [member, author]) {
      assert.equal((await send("PUT", `/communities/${community.id}/membership`, undefined, user.cookie)).statusCode, 200);
    }
    const poll = () =>
      send(
        "POST",
        "/polls",
        {
          kind: "POLL",
          // KV-20 aynı yazarın aynı başlığı tekrar açmasını engeller
          title: `Yemekhane saatleri uzatılsın mı? ${randomUUID().slice(0, 8)}`,
          categoryId,
          communityId: community.id,
          durationHours: 24,
          resultsVisibility: "ALWAYS",
          options: [{ label: "Evet" }, { label: "Hayır" }],
        },
        author.cookie,
        `poll-${randomUUID()}`,
      );
    assert.equal((await poll()).statusCode, 201);
    assert.equal((await get(`/communities/${community.slug}`)).statusCode, 200);

    const closed = await patch(admin.cookie, community.id, { status: "HIDDEN" });
    assert.equal(closed.statusCode, 200, closed.body);
    assert.equal(closed.json().data.memberCount, 2, "yönetici kapatılmış topluluğu hâlâ görür");

    // Aynı oturumlarla: sayfa, liste, üye listesi, katılım ve yeni anket artık yok.
    assertError(await get(`/communities/${community.slug}`, member.cookie), 404, "NOT_FOUND");
    assertError(await get(`/communities/${community.id}/members`, member.cookie), 404, "NOT_FOUND");
    // Liste yalnız ACTIVE toplulukları döner (sayfalama kapsamı topluluk testlerinde).
    assert.equal(await db.community.count({ where: { id: community.id, status: "ACTIVE" } }), 0);
    assertError(await send("PUT", `/communities/${community.id}/membership`, undefined, (await signUp()).cookie), 404, "NOT_FOUND");
    assertError(await poll(), 400, "VALIDATION_ERROR");

    // Üyelikler silinmedi; topluluk yeniden açılınca her şey olduğu gibi döner.
    assert.equal(await db.communityMembership.count({ where: { communityId: community.id } }), 2);
    assert.equal((await patch(admin.cookie, community.id, { status: "ACTIVE" })).statusCode, 200);
    assert.equal((await get(`/communities/${community.slug}`, member.cookie)).json().data.viewer.role, "MEMBER");
    assert.equal((await poll()).statusCode, 201);
  });

  // ─── Moderatör atama ────────────────────────────────────────

  test("moderatör atanır: yeni üye olarak eklenir (sayaç artar), mevcut üyenin rolü yükselir (sayaç değişmez)", async () => {
    const community = await newCommunity({ membersVisibility: "MODERATORS" });
    const outsider = await signUp();
    const member = await signUp();
    assert.equal((await send("PUT", `/communities/${community.id}/membership`, undefined, member.cookie)).statusCode, 200);

    const res = await assign(admin.cookie, community.id, outsider.id);
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().data, { role: "MODERATOR" });
    assert.equal((await assign(admin.cookie, community.id, member.id)).statusCode, 200);
    // Aynı atamanın tekrarı idempotent.
    assert.equal((await assign(admin.cookie, community.id, outsider.id)).statusCode, 200);

    const rows = await db.communityMembership.findMany({ where: { communityId: community.id } });
    assert.deepEqual(rows.map((r) => r.role), ["MODERATOR", "MODERATOR"]);
    assert.equal((await db.community.findUniqueOrThrow({ where: { id: community.id } })).memberCount, 2);
    // Üye listesi yalnız moderatörlere açık topluluk: atanan kullanıcı artık görebilir.
    assert.equal((await get(`/communities/${community.id}/members`, outsider.cookie)).statusCode, 200);
  });

  test("atama hataları: olmayan topluluk/kullanıcı 404, silinmiş hesap 404, gerekçesiz gövde 400", async () => {
    const community = await newCommunity();
    const deleted = await signUp();
    await db.user.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

    assertError(await assign(admin.cookie, randomUUID(), (await signUp()).id), 404, "NOT_FOUND");
    assertError(await assign(admin.cookie, community.id, randomUUID()), 404, "NOT_FOUND");
    assertError(await assign(admin.cookie, community.id, deleted.id), 404, "NOT_FOUND");
    assertError(await send("PUT", `/admin/communities/${community.id}/moderators/${(await signUp()).id}`, {}, admin.cookie), 400, "VALIDATION_ERROR");
    assert.equal(await db.communityMembership.count({ where: { communityId: community.id } }), 0);
    assert.equal((await db.community.findUniqueOrThrow({ where: { id: community.id } })).memberCount, 0);
  });

  test("moderatör yalnız kendi topluluğunda yetkilidir; atama ve kaldırma açık oturumda hemen etkilidir", async () => {
    const mine = await newCommunity();
    const other = await newCommunity();
    const moderator = await staff("MODERATOR");

    // Atanmamış moderatör: kuyruk 403.
    assertError(await get("/admin/reports", moderator.cookie), 403, "FORBIDDEN");

    assert.equal((await assign(admin.cookie, mine.id, moderator.id)).statusCode, 200);
    const mineReport = await reportBy(await communityPollIn(mine.id));
    const foreignReport = await reportBy(await communityPollIn(other.id));
    const resolve = (id: string) => send("POST", `/admin/reports/${id}/resolve`, { resolution: "DISMISSED", note: "Kurallara uygun" }, moderator.cookie);

    // Aynı oturum, atamadan hemen sonra kuyruğu görür ve yalnız kendi topluluğunda karar verir.
    const queue = await get(`/admin/reports?communityId=${mine.id}`, moderator.cookie);
    assert.equal(queue.statusCode, 200, queue.body);
    assert.deepEqual(queue.json().data.map((r: any) => r.id), [mineReport]);
    assertError(await resolve(foreignReport), 403, "FORBIDDEN");

    // Rol kaldırılınca aynı oturum bir sonraki istekte yetkisini yitirir; üyelik ve sayaç korunur.
    assert.equal((await unassign(admin.cookie, mine.id, moderator.id)).statusCode, 204);
    assertError(await get("/admin/reports", moderator.cookie), 403, "FORBIDDEN");
    assertError(await resolve(mineReport), 403, "FORBIDDEN");
    const membership = await db.communityMembership.findUniqueOrThrow({
      where: { communityId_userId: { communityId: mine.id, userId: moderator.id } },
    });
    assert.equal(membership.role, "MEMBER");
    const after = await db.community.findUniqueOrThrow({ where: { id: mine.id } });
    assert.equal(after.memberCount, await db.communityMembership.count({ where: { communityId: mine.id } }));
  });

  test("moderatörlük kaldırma idempotent: moderatör olmayan veya üye olmayan için 204, olmayan topluluk 404", async () => {
    const community = await newCommunity();
    const member = await signUp();
    assert.equal((await send("PUT", `/communities/${community.id}/membership`, undefined, member.cookie)).statusCode, 200);

    assert.equal((await unassign(admin.cookie, community.id, member.id)).statusCode, 204);
    assert.equal((await unassign(admin.cookie, community.id, (await signUp()).id)).statusCode, 204);
    assert.equal((await unassign(admin.cookie, community.id, randomUUID())).statusCode, 204);
    assertError(await unassign(admin.cookie, randomUUID(), member.id), 404, "NOT_FOUND");
    const row = await db.communityMembership.findUniqueOrThrow({ where: { communityId_userId: { communityId: community.id, userId: member.id } } });
    assert.equal(row.role, "MEMBER");
    assert.equal((await db.community.findUniqueOrThrow({ where: { id: community.id } })).memberCount, 1);
  });

  test("eşzamanlı atamalar sayacı bozmaz: 8 istek tek üyelik, sayaç 1", async () => {
    const community = await newCommunity();
    const target = await signUp();
    const results = await Promise.all(Array.from({ length: 8 }, () => assign(admin.cookie, community.id, target.id)));
    assert.deepEqual([...new Set(results.map((r) => r.statusCode))], [200]);
    assert.equal(await db.communityMembership.count({ where: { communityId: community.id } }), 1);
    assert.equal((await db.community.findUniqueOrThrow({ where: { id: community.id } })).memberCount, 1);
  });

  // ─── Yardımcılar (rapor akışı) ──────────────────────────────

  async function communityPollIn(communityId: string) {
    const author = await signUp();
    await db.$transaction([
      db.communityMembership.create({ data: { communityId, userId: author.id } }),
      db.community.update({ where: { id: communityId }, data: { memberCount: { increment: 1 } } }),
    ]);
    const res = await send(
      "POST",
      "/polls",
      {
        kind: "POLL",
        title: "Bu karar doğru mu?",
        categoryId,
        communityId,
        durationHours: 24,
        resultsVisibility: "ALWAYS",
        options: [{ label: "Evet" }, { label: "Hayır" }],
      },
      author.cookie,
      `poll-${randomUUID()}`,
    );
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }

  async function reportBy(pollId: string) {
    const reporter = await signUp();
    const res = await send("POST", "/reports", { target: { type: "POLL", id: pollId }, reason: "SPAM" }, reporter.cookie);
    assert.equal(res.statusCode, 202, res.body);
    return res.json().data.reportId as string;
  }
});

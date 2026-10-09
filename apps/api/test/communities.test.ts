/**
 * KV-31 (#33) topluluk senaryoları. Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL; CI'da tanımlı):
 * üyelik PK'si, sayaç ve eşzamanlı katılım bellek içinde taklit edilmez. Topluluklar admin endpoint'i
 * (KV-32) gelene kadar doğrudan DB'ye eklenir. Cevaplar router tarafından sözleşme şemasıyla doğrulanır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { CommunityDetail, ErrorBody } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { canSeeMembers } from "../src/modules/communities/routes.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

test("üye listesi görünürlüğü: PUBLIC herkese, MEMBERS üyelere, MODERATORS sadece moderatörlere", () => {
  assert.equal(canSeeMembers("PUBLIC", null), true);
  assert.equal(canSeeMembers("MEMBERS", null), false);
  assert.equal(canSeeMembers("MEMBERS", "MEMBER"), true);
  assert.equal(canSeeMembers("MODERATORS", "MEMBER"), false);
  assert.equal(canSeeMembers("MODERATORS", "MODERATOR"), true);
});

describe("topluluklar (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let adminId: string;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    adminId = (await signUp()).id;
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "POST" | "PUT" | "DELETE", url: string, body: unknown, cookie?: string, key?: string) {
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
  const get = (url: string, cookie?: string) => h.app.inject({ method: "GET", url: `/v1${url}`, headers: cookie ? { cookie } : {} });

  function assertError(res: { statusCode: number; body: string; json(): any }, status: number, code: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp() {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `topluluk_${id}@example.test`, username: `topluluk_${id}`, displayName: "Üye", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  async function community(fields: { memberCount?: number; status?: "ACTIVE" | "HIDDEN"; membersVisibility?: "PUBLIC" | "MEMBERS" | "MODERATORS"; imageMediaId?: string } = {}) {
    const slug = `samsun-${randomUUID().slice(0, 8)}`;
    return db.community.create({
      data: { slug, name: "Samsun Üniversitesi", description: "Kampüs soruları", createdById: adminId, ...fields },
    });
  }

  /** API'nin yaptığı gibi üyelik ve sayaç aynı transaction'da (sayaç tutarlılığı DB CHECK'iyle korunur). */
  async function addMember(communityId: string, userId: string, role: "MEMBER" | "MODERATOR" = "MEMBER") {
    await db.$transaction([
      db.communityMembership.create({ data: { communityId, userId, role } }),
      db.community.update({ where: { id: communityId }, data: { memberCount: { increment: 1 } } }),
    ]);
  }

  // ─── Liste ──────────────────────────────────────────────────

  test("liste sadece açık toplulukları üye sayısına göre sıralar ve cursor ile sayfalar", async () => {
    // Diğer testlerin topluluklarının önüne geçmek için çok büyük sayaçlar.
    const base = 900_000_000 + Math.floor(Math.random() * 1_000_000);
    const a = await community({ memberCount: base + 3 });
    const b = await community({ memberCount: base + 2 });
    const hidden = await community({ memberCount: base + 10, status: "HIDDEN" });
    const c = await community({ memberCount: base + 1 });

    const first = await get("/communities?limit=2");
    assert.equal(first.statusCode, 200, first.body);
    assert.deepEqual(first.json().data.map((x: { id: string }) => x.id), [a.id, b.id]);
    assert.equal(first.json().page.hasMore, true);

    const second = await get(`/communities?limit=2&cursor=${first.json().page.nextCursor}`);
    assert.equal(second.json().data[0].id, c.id);
    const all = [...first.json().data, ...second.json().data].map((x: { id: string }) => x.id);
    assert.ok(!all.includes(hidden.id), "kapatılmış topluluk listede yok");
    assert.deepEqual(Object.keys(first.json().data[0]).sort(), ["description", "id", "imageUrl", "memberCount", "name", "slug"]);
  });

  test("bozuk veya başka listeye ait cursor 400 INVALID_CURSOR", async () => {
    assertError(await get("/communities?cursor=bozuk-cursor"), 400, "INVALID_CURSOR");
    const foreign = Buffer.from(JSON.stringify({ v: 1, l: "baska.liste", k: [1, randomUUID()] })).toString("base64url");
    assertError(await get(`/communities?cursor=${foreign}`), 400, "INVALID_CURSOR");
  });

  test("topluluk görseli sadece APPROVED ise URL alır", async () => {
    const approved = await h.addMedia(adminId, { purpose: "POLL", status: "APPROVED" });
    const pending = await h.addMedia(adminId, { purpose: "POLL", status: "PENDING" });
    const withImage = await community({ imageMediaId: approved.id });
    const withPending = await community({ imageMediaId: pending.id });
    assert.equal((await get(`/communities/${withImage.slug}`)).json().data.imageUrl, `http://cdn.test/media/${approved.publicKey}`);
    assert.equal((await get(`/communities/${withPending.slug}`)).json().data.imageUrl, null);
  });

  // ─── Sayfa ──────────────────────────────────────────────────

  test("sayfa: misafirde viewer null, üyede rolü; kapatılmış ve olmayan topluluk 404", async () => {
    const c = await community({ membersVisibility: "PUBLIC" });
    const guest = CommunityDetail.parse((await get(`/communities/${c.slug}`)).json().data);
    assert.equal(guest.viewer, null);
    assert.equal(guest.membersVisibility, "PUBLIC");

    const user = await signUp();
    assert.deepEqual((await get(`/communities/${c.slug}`, user.cookie)).json().data.viewer, { role: null });
    await addMember(c.id, user.id, "MODERATOR");
    assert.deepEqual((await get(`/communities/${c.slug}`, user.cookie)).json().data.viewer, { role: "MODERATOR" });

    const hidden = await community({ status: "HIDDEN" });
    assertError(await get(`/communities/${hidden.slug}`), 404, "NOT_FOUND");
    assertError(await get(`/communities/yok-boyle-bir-topluluk`), 404, "NOT_FOUND");
    assertError(await get(`/communities/Buyuk_Harf`), 400, "VALIDATION_ERROR");
  });

  // ─── Üye listesi ────────────────────────────────────────────

  test("üye listesi görünürlüğü sunucuda uygulanır; yetkisiz izleyici 404 alır", async () => {
    const member = await signUp();
    const moderator = await signUp();
    const outsider = await signUp();
    for (const visibility of ["PUBLIC", "MEMBERS", "MODERATORS"] as const) {
      const c = await community({ membersVisibility: visibility });
      await addMember(c.id, member.id);
      await addMember(c.id, moderator.id, "MODERATOR");
      const status = async (cookie?: string) => (await get(`/communities/${c.id}/members`, cookie)).statusCode;
      assert.deepEqual(
        [await status(), await status(outsider.cookie), await status(member.cookie), await status(moderator.cookie)],
        { PUBLIC: [200, 200, 200, 200], MEMBERS: [404, 404, 200, 200], MODERATORS: [404, 404, 404, 200] }[visibility],
        visibility,
      );
    }
  });

  test("üye listesi yeniden eskiye sayfalanır, silinmiş hesabı ve e-postayı göstermez", async () => {
    const c = await community({ membersVisibility: "PUBLIC" });
    const users = [await signUp(), await signUp(), await signUp()];
    for (const [i, u] of users.entries()) {
      await db.communityMembership.create({ data: { communityId: c.id, userId: u.id, createdAt: new Date(Date.UTC(2026, 9, 1, 10, i)) } });
    }
    await db.user.update({ where: { id: users[1]!.id }, data: { deletedAt: new Date() } });

    const first = await get(`/communities/${c.id}/members?limit=1`);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().data[0].user.id, users[2]!.id);
    assert.ok(!JSON.stringify(first.json()).includes("@example.test"), "e-posta sızmaz");
    const second = await get(`/communities/${c.id}/members?limit=1&cursor=${first.json().page.nextCursor}`);
    assert.deepEqual(second.json().data.map((m: { user: { id: string } }) => m.user.id), [users[0]!.id]);
    assert.deepEqual(second.json().page, { nextCursor: null, hasMore: false });

    const other = await community({ membersVisibility: "PUBLIC" });
    assertError(await get(`/communities/${other.id}/members?cursor=${first.json().page.nextCursor}`), 400, "INVALID_CURSOR");
  });

  // ─── Katıl / ayrıl ──────────────────────────────────────────

  test("katılma idempotent: tekrar ve eşzamanlı istekler tek üyelik ve tek sayaç artışı üretir", async () => {
    const c = await community();
    const user = await signUp();
    const results = await Promise.all(Array.from({ length: 10 }, () => send("PUT", `/communities/${c.id}/membership`, undefined, user.cookie)));
    assert.ok(results.every((r) => r.statusCode === 200 && r.json().data.role === "MEMBER"), results[0]!.body);
    assert.equal(await db.communityMembership.count({ where: { communityId: c.id } }), 1);
    assert.equal((await db.community.findUniqueOrThrow({ where: { id: c.id } })).memberCount, 1);

    const moderator = await signUp();
    await addMember(c.id, moderator.id, "MODERATOR");
    const again = await send("PUT", `/communities/${c.id}/membership`, undefined, moderator.cookie);
    assert.equal(again.json().data.role, "MODERATOR", "moderatör tekrar katılınca rolünü kaybetmez");
  });

  test("ayrılma idempotent; kapatılmış topluluğa katılınamaz ama ayrılınabilir", async () => {
    const c = await community();
    const user = await signUp();
    await send("PUT", `/communities/${c.id}/membership`, undefined, user.cookie);
    for (let i = 0; i < 2; i++) {
      assert.equal((await send("DELETE", `/communities/${c.id}/membership`, undefined, user.cookie)).statusCode, 204);
    }
    assert.equal((await db.community.findUniqueOrThrow({ where: { id: c.id } })).memberCount, 0);

    const hidden = await community({ status: "HIDDEN" });
    await addMember(hidden.id, user.id);
    assertError(await send("PUT", `/communities/${hidden.id}/membership`, undefined, (await signUp()).cookie), 404, "NOT_FOUND");
    assert.equal((await send("DELETE", `/communities/${hidden.id}/membership`, undefined, user.cookie)).statusCode, 204);

    assertError(await send("DELETE", `/communities/${randomUUID()}/membership`, undefined, user.cookie), 404, "NOT_FOUND");
    assertError(await send("PUT", `/communities/${c.id}/membership`, undefined), 401, "UNAUTHENTICATED");
  });

  test("katıldıktan sonra toplulukta anket açılabilir, ayrılınca açılamaz (KV-10 entegrasyonu)", async () => {
    const c = await community();
    const user = await signUp();
    const category = await db.category.create({ data: { slug: `kampus-${randomUUID().slice(0, 8)}`, name: "Kampüs" } });
    const poll = () =>
      send(
        "POST",
        "/polls",
        {
          kind: "POLL",
          title: "Yemekhane saatleri uzatılsın mı?",
          categoryId: category.id,
          communityId: c.id,
          durationHours: 24,
          resultsVisibility: "ALWAYS",
          options: [{ label: "Evet" }, { label: "Hayır" }],
        },
        user.cookie,
        `poll-${randomUUID()}`,
      );

    assertError(await poll(), 403, "FORBIDDEN");
    await send("PUT", `/communities/${c.id}/membership`, undefined, user.cookie);
    const created = await poll();
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().data.community.id, c.id);

    await send("DELETE", `/communities/${c.id}/membership`, undefined, user.cookie);
    assertError(await poll(), 403, "FORBIDDEN");
  });
});

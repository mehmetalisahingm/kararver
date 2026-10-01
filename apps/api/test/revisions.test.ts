/**
 * #66 içerik sürüm geçmişi (admin.revisions.polls / admin.revisions.comments). Gerçek PostgreSQL gerektirir.
 * Kaynak: docs/V1_USER_FLOW.md "Yetkili admin içerik geçmişinden kimin ne paylaştığını ve hangi sürümü
 * değiştirdiğini inceleyebilir."
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, Revision } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";
import { rbacSeeds } from "./support/rbac-probe.ts";

const backend = prismaBackend();
type User = { cookie: string; id: string };

describe("içerik sürüm geçmişi (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let author: User;
  let admin: User;

  function send(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, cookie?: string, key?: string) {
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
  const get = (url: string, cookie?: string) => h.app.inject({ method: "GET", url: `/v1${url}`, headers: cookie ? { cookie } : {} });

  function assertError(res: { statusCode: number; body: string; json(): any }, status: number, code: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `rv_${id}@example.test`, username: `rv_${id}`, displayName: "Sürüm", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  async function createPoll(over: Record<string, unknown> = {}) {
    const res = await send(
      "POST",
      "/polls",
      { kind: "POLL", title: `İlk başlık ${randomUUID().slice(0, 8)}`, categoryId, durationHours: 24, resultsVisibility: "ALWAYS", options: [{ label: "A" }, { label: "B" }], ...over },
      author.cookie,
      `test-${randomUUID()}`,
    );
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data as { id: string; options: { id: string }[] };
  }

  async function history(target: "polls" | "comments", id: string, cookie = admin.cookie, limit = 50) {
    const all: ReturnType<typeof Revision.parse>[] = [];
    let cursor: string | null = null;
    do {
      const res = await get(`/admin/${target}/${id}/revisions?limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`, cookie);
      assert.equal(res.statusCode, 200, res.body);
      all.push(...(res.json().data as unknown[]).map((r) => Revision.parse(r)));
      cursor = res.json().page.nextCursor;
    } while (cursor);
    return all;
  }

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `rv-${randomUUID().slice(0, 8)}`, name: "Sürüm Testi" } })).id;
    author = await signUp();
    const root = await signUp();
    const seeds = rbacSeeds(h);
    await seeds.setRole(root.id, "SUPER_ADMIN", null);
    admin = await signUp();
    await seeds.setRole(admin.id, "ADMIN", root.id);
  });
  after(async () => {
    await h?.close();
  });

  test("anket: sürüm 1 ilk paylaşım, her düzenleme yeni sürüm; en yeni önce, sayfalanır", async () => {
    const poll = await createPoll({ description: "İlk açıklama", tagSlugs: ["araba"] });
    h.clock.advance(60_000);
    assert.equal((await send("PATCH", `/polls/${poll.id}`, { title: "İkinci başlık burada yazıyor", description: null }, author.cookie)).statusCode, 200);
    h.clock.advance(60_000);
    assert.equal((await send("PATCH", `/polls/${poll.id}`, { options: [{ id: poll.options[1]!.id, label: "B" }, { label: "C" }] }, author.cookie)).statusCode, 200);

    const revs = await history("polls", poll.id);
    assert.deepEqual(revs.map((r) => r.version), [3, 2, 1]);
    assert.deepEqual(revs.map((r) => r.editor.id), [author.id, author.id, author.id]);
    const [v3, v2, v1] = revs;
    assert.deepEqual([v1!.snapshot.title, v1!.snapshot.description, v1!.snapshot.tags, v1!.snapshot.kind], [revs[2]!.snapshot.title, "İlk açıklama", ["araba"], "POLL"]);
    assert.match(String(v1!.snapshot.title), /^İlk başlık/);
    assert.deepEqual([v2!.snapshot.title, v2!.snapshot.description], ["İkinci başlık burada yazıyor", null]);
    assert.deepEqual((v3!.snapshot.options as { label: string }[]).map((o) => o.label), ["B", "C"]);
    assert.ok(Date.parse(v3!.editedAt) > Date.parse(v2!.editedAt) && Date.parse(v2!.editedAt) > Date.parse(v1!.editedAt));

    // Sayfa sayfa aynı sıra.
    assert.deepEqual((await history("polls", poll.id, admin.cookie, 1)).map((r) => r.version), [3, 2, 1]);
    // Son sürüm, içeriğin şu anki hali ile aynı (anlık görüntü fonksiyonu tek kaynak).
    const [now] = await db.$queryRaw<{ s: unknown }[]>`SELECT kv_poll_snapshot(${poll.id}::uuid) AS s`;
    assert.deepEqual(v3!.snapshot, now!.s);
  });

  test("tartışma ve yorum: oluşturma ve düzenleme geçmişe yazılır", async () => {
    const d = await send("POST", "/polls", { kind: "DISCUSSION", title: `Tartışma ${randomUUID().slice(0, 8)} başlığı`, categoryId }, author.cookie, `test-${randomUUID()}`);
    assert.equal(d.statusCode, 201, d.body);
    const dRevs = await history("polls", d.json().data.id);
    assert.deepEqual([dRevs.length, dRevs[0]!.snapshot.kind, dRevs[0]!.snapshot.options, dRevs[0]!.snapshot.closesAt], [1, "DISCUSSION", [], null]);

    const commenter = await signUp();
    const created = await send("POST", `/polls/${d.json().data.id}/comments`, { body: "İlk yorum" }, commenter.cookie);
    assert.equal(created.statusCode, 201, created.body);
    const commentId = created.json().data.id as string;
    assert.equal((await send("PATCH", `/comments/${commentId}`, { body: "Düzeltilmiş yorum" }, commenter.cookie)).statusCode, 200);
    const cRevs = await history("comments", commentId);
    assert.deepEqual(cRevs.map((r) => [r.version, r.snapshot.body, r.editor.id]), [
      [2, "Düzeltilmiş yorum", commenter.id],
      [1, "İlk yorum", commenter.id],
    ]);
  });

  test("yetki: misafir 401, kullanıcı ve moderatör 403, yazarın kendisi de 403; yok 404; kaldırılan içeriğin geçmişi açık", async () => {
    const poll = await createPoll();
    const moderator = await signUp();
    await rbacSeeds(h).setRole(moderator.id, "MODERATOR", admin.id);
    assertError(await get(`/admin/polls/${poll.id}/revisions`), 401, "UNAUTHENTICATED");
    assertError(await get(`/admin/polls/${poll.id}/revisions`, author.cookie), 403, "FORBIDDEN");
    assertError(await get(`/admin/polls/${poll.id}/revisions`, moderator.cookie), 403, "FORBIDDEN");
    assertError(await get(`/admin/polls/${randomUUID()}/revisions`, admin.cookie), 404, "NOT_FOUND");
    assertError(await get(`/admin/comments/${randomUUID()}/revisions`, admin.cookie), 404, "NOT_FOUND");

    assert.equal((await send("DELETE", `/polls/${poll.id}`, undefined, author.cookie)).statusCode, 204);
    assert.equal((await history("polls", poll.id)).length, 1);
    const res = await get(`/admin/polls/${poll.id}/revisions?cursor=bozuk`, admin.cookie);
    assertError(res, 400, "INVALID_CURSOR");
  });

  test("başarısız düzenleme sürüm yazmaz; eşzamanlı düzenlemeler sıralı ve boşluksuz sürüm üretir", async () => {
    const poll = await createPoll();
    const voter = await signUp();
    assert.equal((await send("PUT", `/polls/${poll.id}/vote`, { optionId: poll.options[0]!.id }, voter.cookie)).statusCode, 201);
    assertError(await send("PATCH", `/polls/${poll.id}`, { title: "Kilitli ankette yeni başlık" }, author.cookie), 409, "POLL_CONTENT_LOCKED");
    assert.equal((await history("polls", poll.id)).length, 1, "reddedilen düzenleme geçmişe girmez");

    const results = await Promise.all(
      // Sadece etiket: anket satırına yazılmaz, sıra yalnız açık satır kilidine dayanır.
      Array.from({ length: 6 }, (_, i) => send("PATCH", `/polls/${poll.id}`, { tagSlugs: [`etiket-${i}`] }, author.cookie)),
    );
    assert.ok(results.every((r) => r.statusCode === 200), results.map((r) => r.body).join("\n"));
    assert.deepEqual((await history("polls", poll.id)).map((r) => r.version), [7, 6, 5, 4, 3, 2, 1]);
  });

  test("geçmiş değiştirilemez ve silinemez (append-only)", async () => {
    const poll = await createPoll();
    const rev = await db.pollRevision.findFirstOrThrow({ where: { pollId: poll.id } });
    await assert.rejects(db.pollRevision.update({ where: { id: rev.id }, data: { snapshot: { title: "sahte" } } }), /KV_REVISIONS_APPEND_ONLY/);
    await assert.rejects(db.pollRevision.delete({ where: { id: rev.id } }), /KV_REVISIONS_APPEND_ONLY/);
  });
});

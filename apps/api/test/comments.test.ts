/**
 * KV-17 (#19) yorum, cevap, alternatif öneri ve yorum tepkisi senaryoları.
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL; CI'da tanımlı). Cevaplar router tarafından
 * sözleşme şemasıyla (CommentView, ReactionSummary) doğrulanır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { CommentView, ErrorBody, PollDetail } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

describe("yorumlar (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let owner: { cookie: string; id: string };
  let alice: { cookie: string; id: string };
  let bob: { cookie: string; id: string };

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "POST" | "PATCH" | "PUT" | "DELETE", url: string, body: unknown, cookie?: string, key?: string) {
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

  function assertError(res: { statusCode: number; json(): any }, status: number, code: string) {
    assert.equal(res.statusCode, status, JSON.stringify(res.json()));
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp(options: { verify?: boolean } = {}) {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `yorum_${id}@example.test`, username: `yorum_${id}`, displayName: "Yorumcu", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    if (options.verify !== false) {
      assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    }
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  async function createPoll(overrides: Record<string, unknown> = {}) {
    const body = {
      kind: "POLL",
      // Aynı başlık kuralı (KV-20): her çağrı benzersiz başlık üretir.
      title: `Bu bilgisayar bu fiyata alınır mı? ${randomUUID().slice(0, 8)}`,
      categoryId,
      durationHours: 24,
      resultsVisibility: "ALWAYS",
      options: [{ label: "Evet" }, { label: "Hayır" }],
      ...overrides,
    };
    const res = await send("POST", "/polls", body, owner.cookie, `test-${randomUUID()}`);
    assert.equal(res.statusCode, 201, res.body);
    return PollDetail.parse(res.json().data);
  }

  async function comment(pollId: string, cookie: string, body: Record<string, unknown>) {
    const res = await send("POST", `/polls/${pollId}/comments`, body, cookie);
    assert.equal(res.statusCode, 201, res.body);
    return CommentView.parse(res.json().data);
  }

  async function counts(pollId: string) {
    return (await db.poll.findUniqueOrThrow({ where: { id: pollId }, select: { commentCount: true } })).commentCount;
  }

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `yorum-${randomUUID().slice(0, 8)}`, name: "Yorum" } })).id;
    owner = await signUp();
    alice = await signUp();
    bob = await signUp();
  });
  after(async () => {
    await h?.close();
  });

  // ─── Oluşturma, cevap, derinlik ─────────────────────────────

  test("yorum ve cevap oluşur; sayaçlar güncellenir; cevaba cevap 400", async () => {
    const poll = await createPoll();
    const top = await comment(poll.id, alice.cookie, { body: "Bence fiyat yüksek." });
    assert.equal(top.kind, "COMMENT");
    assert.equal(top.parentId, null);
    assert.equal(top.viewer?.canEdit, true);
    const reply = await comment(poll.id, bob.cookie, { body: "Katılıyorum.", parentId: top.id });
    assert.equal(reply.parentId, top.id);

    assertError(await send("POST", `/polls/${poll.id}/comments`, { body: "Derin cevap", parentId: reply.id }, alice.cookie), 400, "COMMENT_DEPTH_EXCEEDED");
    assert.equal(await counts(poll.id), 2);
    const parent = await db.comment.findUniqueOrThrow({ where: { id: top.id }, select: { replyCount: true } });
    assert.equal(parent.replyCount, 1);
  });

  test("alternatif öneri cevap olamaz; başka anketin yorumuna cevap verilemez", async () => {
    const poll = await createPoll();
    const other = await createPoll();
    const top = await comment(poll.id, alice.cookie, { body: "Üst yorum" });
    assertError(await send("POST", `/polls/${poll.id}/comments`, { body: "x", kind: "ALTERNATIVE", parentId: top.id }, bob.cookie), 400, "VALIDATION_ERROR");
    const foreign = await send("POST", `/polls/${other.id}/comments`, { body: "x", parentId: top.id }, bob.cookie);
    assertError(foreign, 400, "VALIDATION_ERROR");
    assert.equal(foreign.json().error.details[0].field, "parentId");
  });

  test("misafir 401, doğrulanmamış hesap 403; Idempotency-Key tekrarı tek yorum üretir", async () => {
    const poll = await createPoll();
    assertError(await send("POST", `/polls/${poll.id}/comments`, { body: "x" }), 401, "UNAUTHENTICATED");
    const unverified = await signUp({ verify: false });
    assertError(await send("POST", `/polls/${poll.id}/comments`, { body: "x" }, unverified.cookie), 403, "EMAIL_NOT_VERIFIED");

    const key = `test-${randomUUID()}`;
    const first = await send("POST", `/polls/${poll.id}/comments`, { body: "Tek sefer" }, alice.cookie, key);
    const again = await send("POST", `/polls/${poll.id}/comments`, { body: "Tek sefer" }, alice.cookie, key);
    assert.equal(first.statusCode, 201);
    assert.equal(again.statusCode, 201);
    assert.equal(again.json().data.id, first.json().data.id);
    assertError(await send("POST", `/polls/${poll.id}/comments`, { body: "Başka metin" }, alice.cookie, key), 409, "IDEMPOTENCY_KEY_REUSED");
    assert.equal(await counts(poll.id), 1);
  });

  // ─── Yorum kapalı durumu ve moderasyon (kabul koşulu 1) ─────

  test("yorumu kapalı anket 409; moderasyon kilidi 409; acil durum anahtarı 503", async () => {
    const closed = await createPoll({ allowComments: false });
    assertError(await send("POST", `/polls/${closed.id}/comments`, { body: "x" }, alice.cookie), 409, "COMMENTS_DISABLED");

    const locked = await createPoll();
    const existing = await comment(locked.id, alice.cookie, { body: "Kilitten önce" });
    await db.poll.update({ where: { id: locked.id }, data: { status: "LOCKED" } });
    assertError(await send("POST", `/polls/${locked.id}/comments`, { body: "x" }, alice.cookie), 409, "CONTENT_LOCKED");
    assertError(await send("PATCH", `/comments/${existing.id}`, { body: "düzenle" }, alice.cookie), 409, "CONTENT_LOCKED");

    const open = await createPoll();
    h.commentsEnabled.value = false;
    try {
      assertError(await send("POST", `/polls/${open.id}/comments`, { body: "x" }, alice.cookie), 503, "FEATURE_DISABLED");
    } finally {
      h.commentsEnabled.value = true;
    }
  });

  test("anket kapandıktan sonra yorum serbest", async () => {
    const poll = await createPoll();
    assert.equal((await send("POST", `/polls/${poll.id}/close`, undefined, owner.cookie)).statusCode, 200);
    await comment(poll.id, alice.cookie, { body: "Kapandıktan sonra da yazılır." });
  });

  // ─── Sahiplik (kabul koşulu 1) ──────────────────────────────

  test("başkasının yorumu düzenlenemez/silinemez (403); sahip düzenler ve siler", async () => {
    const poll = await createPoll();
    const c = await comment(poll.id, alice.cookie, { body: "İlk hâl" });
    assertError(await send("PATCH", `/comments/${c.id}`, { body: "hack" }, bob.cookie), 403, "FORBIDDEN");
    assertError(await send("DELETE", `/comments/${c.id}`, undefined, bob.cookie), 403, "FORBIDDEN");

    const edited = await send("PATCH", `/comments/${c.id}`, { body: "Düzeltilmiş hâl" }, alice.cookie);
    assert.equal(edited.statusCode, 200, edited.body);
    const view = CommentView.parse(edited.json().data);
    assert.equal(view.body, "Düzeltilmiş hâl");
    assert.ok(view.editedAt);

    assert.equal((await send("DELETE", `/comments/${c.id}`, undefined, alice.cookie)).statusCode, 204);
    assert.equal((await send("DELETE", `/comments/${c.id}`, undefined, alice.cookie)).statusCode, 204, "tekrar silmek 204");
    assertError(await send("PATCH", `/comments/${c.id}`, { body: "geri" }, alice.cookie), 404, "NOT_FOUND");
    assert.equal(await counts(poll.id), 0);
  });

  // ─── Tepkiler (kabul koşulu 2) ──────────────────────────────

  test("beğeni tekrarları çoğalmaz: 10 eşzamanlı LIKE tek beğeni", async () => {
    const poll = await createPoll();
    const c = await comment(poll.id, alice.cookie, { body: "Beğenilecek yorum" });
    const results = await Promise.all(Array.from({ length: 10 }, () => send("PUT", `/comments/${c.id}/reaction`, { value: "LIKE" }, bob.cookie)));
    assert.ok(results.every((r) => r.statusCode === 200), results.map((r) => r.body).join("\n"));
    assert.deepEqual(results.at(-1)!.json().data, { likes: 1, dislikes: 0, viewer: "LIKE" });
    assert.equal(await db.commentReaction.count({ where: { commentId: c.id } }), 1);
  });

  test("LIKE → DISLIKE sayaçları taşır; kaldırmak sıfırlar; giriş yeterli (doğrulama gerekmez)", async () => {
    const poll = await createPoll();
    const c = await comment(poll.id, alice.cookie, { body: "Tepki yorumu" });
    const unverified = await signUp({ verify: false });
    assert.deepEqual((await send("PUT", `/comments/${c.id}/reaction`, { value: "LIKE" }, unverified.cookie)).json().data, { likes: 1, dislikes: 0, viewer: "LIKE" });
    assert.deepEqual((await send("PUT", `/comments/${c.id}/reaction`, { value: "DISLIKE" }, unverified.cookie)).json().data, { likes: 0, dislikes: 1, viewer: "DISLIKE" });
    assert.deepEqual((await send("PUT", `/comments/${c.id}/reaction`, { value: "LIKE" }, bob.cookie)).json().data, { likes: 1, dislikes: 1, viewer: "LIKE" });
    assert.deepEqual((await send("DELETE", `/comments/${c.id}/reaction`, undefined, unverified.cookie)).json().data, { likes: 1, dislikes: 0, viewer: null });
    assert.deepEqual((await send("DELETE", `/comments/${c.id}/reaction`, undefined, unverified.cookie)).json().data, { likes: 1, dislikes: 0, viewer: null }, "tekrar kaldırmak zararsız");
    assertError(await send("PUT", `/comments/${c.id}/reaction`, { value: "LIKE" }), 401, "UNAUTHENTICATED");
    assertError(await send("PUT", `/comments/${c.id}/reaction`, { value: "LOVE" }, bob.cookie), 400, "VALIDATION_ERROR");

    const list = await get(`/polls/${poll.id}/comments`, bob.cookie);
    const first = CommentView.parse(list.json().data[0]);
    assert.deepEqual(first.reactions, { likes: 1, dislikes: 0, viewer: "LIKE" });
    assert.equal(first.viewer?.reaction, "LIKE");
  });

  test("kaldırılmış yoruma tepki verilemez (404)", async () => {
    const poll = await createPoll();
    const c = await comment(poll.id, alice.cookie, { body: "Silinecek" });
    await send("DELETE", `/comments/${c.id}`, undefined, alice.cookie);
    assertError(await send("PUT", `/comments/${c.id}/reaction`, { value: "LIKE" }, bob.cookie), 404, "NOT_FOUND");
  });

  // ─── Listeleme, alternatifler, sayfalama (kabul koşulu 3) ───

  test("alternatifler ayrı listelenir; top sıralaması beğeniye göre", async () => {
    const poll = await createPoll();
    const c1 = await comment(poll.id, alice.cookie, { body: "Normal yorum" });
    const a1 = await comment(poll.id, alice.cookie, { body: "Şunu da düşün: X", kind: "ALTERNATIVE" });
    const a2 = await comment(poll.id, bob.cookie, { body: "Bence Y daha iyi", kind: "ALTERNATIVE" });
    await send("PUT", `/comments/${a1.id}/reaction`, { value: "LIKE" }, bob.cookie);
    await send("PUT", `/comments/${a1.id}/reaction`, { value: "LIKE" }, owner.cookie);

    const comments = (await get(`/polls/${poll.id}/comments`)).json().data.map((c: { id: string }) => c.id);
    assert.deepEqual(comments, [c1.id], "varsayılan tür COMMENT");
    const newest = (await get(`/polls/${poll.id}/comments?kind=ALTERNATIVE`)).json().data.map((c: { id: string }) => c.id);
    assert.deepEqual(newest, [a2.id, a1.id], "yeniden eskiye");
    const top = (await get(`/polls/${poll.id}/comments?kind=ALTERNATIVE&sort=top`)).json().data.map((c: { id: string }) => c.id);
    assert.deepEqual(top, [a1.id, a2.id], "en çok beğenilen önce");
  });

  test("cursor sayfalama tekrar ve atlama olmadan gezer; filtre değişince 400 INVALID_CURSOR", async () => {
    const poll = await createPoll();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await comment(poll.id, alice.cookie, { body: `Yorum ${i}` })).id);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await get(`/polls/${poll.id}/comments?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      assert.equal(res.statusCode, 200, res.body);
      seen.push(...res.json().data.map((c: { id: string }) => c.id));
      cursor = res.json().page.nextCursor;
      assert.equal(res.json().page.hasMore, cursor !== null);
      pages++;
    } while (cursor && pages < 10);
    assert.deepEqual(seen, [...ids].reverse());
    assert.equal(pages, 3);

    const firstPage = await get(`/polls/${poll.id}/comments?limit=2`);
    const next = firstPage.json().page.nextCursor;
    assertError(await get(`/polls/${poll.id}/comments?limit=2&sort=top&cursor=${next}`), 400, "INVALID_CURSOR");
    assertError(await get(`/polls/${poll.id}/comments?cursor=bozukcursor`), 400, "INVALID_CURSOR");
  });

  test("cevaplar eskiden yeniye ve sayfalı; silinen cevap listeden düşer", async () => {
    const poll = await createPoll();
    const top = await comment(poll.id, alice.cookie, { body: "Üst" });
    const r1 = await comment(poll.id, bob.cookie, { body: "Cevap 1", parentId: top.id });
    const r2 = await comment(poll.id, alice.cookie, { body: "Cevap 2", parentId: top.id });
    const r3 = await comment(poll.id, bob.cookie, { body: "Cevap 3", parentId: top.id });
    const p1 = await get(`/comments/${top.id}/replies?limit=2`);
    assert.deepEqual(p1.json().data.map((c: { id: string }) => c.id), [r1.id, r2.id]);
    const p2 = await get(`/comments/${top.id}/replies?limit=2&cursor=${p1.json().page.nextCursor}`);
    assert.deepEqual(p2.json().data.map((c: { id: string }) => c.id), [r3.id]);
    assert.equal(p2.json().page.nextCursor, null);

    await send("DELETE", `/comments/${r2.id}`, undefined, alice.cookie);
    const after = await get(`/comments/${top.id}/replies`);
    assert.deepEqual(after.json().data.map((c: { id: string }) => c.id), [r1.id, r3.id]);
    assert.equal((await db.comment.findUniqueOrThrow({ where: { id: top.id } })).replyCount, 2);
  });

  test("moderasyon/görünürlük: gizli yorum listelenmez; cevaplı silinen yorum tombstone; kaldırılan anket 404", async () => {
    const poll = await createPoll();
    const hidden = await comment(poll.id, alice.cookie, { body: "Gizlenecek" });
    const parent = await comment(poll.id, alice.cookie, { body: "Cevabı olan, silinecek" });
    await comment(poll.id, bob.cookie, { body: "Bir cevap", parentId: parent.id });
    const lonely = await comment(poll.id, alice.cookie, { body: "Cevapsız, silinecek" });

    await db.comment.update({ where: { id: hidden.id }, data: { status: "HIDDEN" } });
    await send("DELETE", `/comments/${parent.id}`, undefined, alice.cookie);
    await send("DELETE", `/comments/${lonely.id}`, undefined, alice.cookie);

    const list = ((await get(`/polls/${poll.id}/comments`)).json().data as unknown[]).map((c) => CommentView.parse(c));
    assert.deepEqual(list.map((c) => c.id), [parent.id]);
    const tomb = list[0]!;
    assert.equal(tomb.deleted, true);
    assert.equal(tomb.body, null);
    assert.equal(tomb.author, null);
    assert.equal(tomb.replyCount, 1);
    assert.equal((await get(`/comments/${parent.id}/replies`)).json().data.length, 1, "tombstone'un cevapları görünür");

    assertError(await get(`/comments/${hidden.id}/replies`), 404, "NOT_FOUND");
    await db.poll.update({ where: { id: poll.id }, data: { status: "REMOVED", deletedAt: new Date() } });
    assertError(await get(`/polls/${poll.id}/comments`), 404, "NOT_FOUND");
    assertError(await send("POST", `/polls/${poll.id}/comments`, { body: "x" }, alice.cookie), 404, "NOT_FOUND");
  });

  test("anket detayındaki commentCount yorum ekleme/silmeyle tutarlı", async () => {
    const poll = await createPoll();
    const a = await comment(poll.id, alice.cookie, { body: "A" });
    await comment(poll.id, bob.cookie, { body: "B" });
    await comment(poll.id, bob.cookie, { body: "A'ya cevap", parentId: a.id });
    await send("DELETE", `/comments/${a.id}`, undefined, alice.cookie);
    const detail = PollDetail.parse((await get(`/polls/${poll.id}`)).json().data);
    const active = await db.comment.count({ where: { pollId: poll.id, status: "ACTIVE" } });
    assert.equal(detail.commentCount, active);
    assert.equal(active, 2);
  });
});

/**
 * #66 anketsiz tartışma gönderileri ve gönderi beğeni/dislike'ı. Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL).
 * Kaynak: docs/V1_USER_FLOW.md ("iki içerik türü", "içerik tepkisi ile anket oyu farklıdır").
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, PollCard, PollDetail, ReactionSummary } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();
type User = { cookie: string; id: string };

describe("tartışma gönderileri ve tepkiler (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let author: User;

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
    const account = { email: `ds_${id}@example.test`, username: `ds_${id}`, displayName: "Tartışmacı", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  const discussionBody = (over: Record<string, unknown> = {}) => ({
    kind: "DISCUSSION",
    title: `Bu bütçeyle hangi arabayı almalıyım ${randomUUID().slice(0, 6)}?`,
    description: "Bütçem 1,5 milyon; aile için kullanacağım.",
    categoryId,
    ...over,
  });

  async function createDiscussion(by = author, over: Record<string, unknown> = {}) {
    const res = await send("POST", "/polls", discussionBody(over), by.cookie, `test-${randomUUID()}`);
    assert.equal(res.statusCode, 201, res.body);
    return PollDetail.parse(res.json().data);
  }

  async function createPoll(by = author) {
    const res = await send(
      "POST",
      "/polls",
      { kind: "POLL", title: `Anket ${randomUUID()}`, categoryId, durationHours: 24, resultsVisibility: "ALWAYS", options: [{ label: "A" }, { label: "B" }] },
      by.cookie,
      `test-${randomUUID()}`,
    );
    assert.equal(res.statusCode, 201, res.body);
    return PollDetail.parse(res.json().data);
  }

  const react = (id: string, value: "LIKE" | "DISLIKE", cookie: string) => send("PUT", `/polls/${id}/reaction`, { value }, cookie);
  const unreact = (id: string, cookie: string) => send("DELETE", `/polls/${id}/reaction`, undefined, cookie);
  const summary = (res: { statusCode: number; body: string; json(): any }) => {
    assert.equal(res.statusCode, 200, res.body);
    return ReactionSummary.parse(res.json().data);
  };

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `ds-${randomUUID().slice(0, 8)}`, name: "Tartışma Testi" } })).id;
    author = await signUp();
  });
  after(async () => {
    await h?.close();
  });

  // ─── Tartışma gönderisi ─────────────────────────────────────

  test("seçeneksiz ve fotoğrafsız tartışma açılır: süre, sonuç ve seçenek yok; hiç kapanmaz; oy düğmesi NOT_A_POLL", async () => {
    const d = await createDiscussion();
    assert.deepEqual(
      [d.kind, d.options, d.results, d.resultsVisibility, d.closesAt, d.closed, d.media, d.reactions],
      ["DISCUSSION", [], null, null, null, false, [], { likes: 0, dislikes: 0, viewer: null }],
    );
    assert.deepEqual([d.viewer?.isAuthor, d.viewer?.canVote, d.viewer?.voteBlockedReason], [true, false, "NOT_A_POLL"]);

    // Uzun süre sonra da açık (saat yerine açılış tarihi geri alınır: oturumlar geçerli kalsın).
    await db.poll.update({ where: { id: d.id }, data: { opensAt: new Date(h.clock.now.getTime() - 1000 * 24 * 60 * 60 * 1000) } });
    const later = PollDetail.parse((await get(`/polls/${d.id}`)).json().data);
    assert.equal(later.closed, false);

    const reader = await signUp();
    const asReader = PollDetail.parse((await get(`/polls/${d.id}`, reader.cookie)).json().data);
    assert.deepEqual([asReader.viewer?.canVote, asReader.viewer?.voteBlockedReason], [false, "NOT_A_POLL"]);
  });

  test("tartışma ankete özgü alan kabul etmez; yayın kuralları (aynı başlık) iki türde de geçerli", async () => {
    assertError(await send("POST", "/polls", discussionBody({ options: [{ label: "A" }, { label: "B" }] }), author.cookie, `test-${randomUUID()}`), 400, "VALIDATION_ERROR");
    assertError(await send("POST", "/polls", discussionBody({ durationHours: 24 }), author.cookie, `test-${randomUUID()}`), 400, "VALIDATION_ERROR");

    const title = `Süresiz tartışma başlığı ${randomUUID().slice(0, 6)}`;
    await createDiscussion(author, { title });
    // Tartışma süresizdir: kaldırılana kadar "açık" sayılır, aynı başlık tekrar açılamaz.
    assertError(await send("POST", "/polls", discussionBody({ title: title.toLocaleUpperCase("tr") }), author.cookie, `test-${randomUUID()}`), 409, "DUPLICATE_TITLE");
  });

  test("tartışmada oy, seçenek/sonuç düzenleme ve kapatma 409 NOT_A_POLL; başlık ve açıklama düzenlenir", async () => {
    const d = await createDiscussion();
    const voter = await signUp();
    const fakeOption = randomUUID();
    assertError(await send("PUT", `/polls/${d.id}/vote`, { optionId: fakeOption }, voter.cookie), 409, "NOT_A_POLL");
    // Sahibin oyu da önce NOT_A_POLL alır (sözleşmedeki hata sırası).
    assertError(await send("PUT", `/polls/${d.id}/vote`, { optionId: fakeOption }, author.cookie), 409, "NOT_A_POLL");

    assertError(await send("PATCH", `/polls/${d.id}`, { options: [{ label: "A" }, { label: "B" }] }, author.cookie), 409, "NOT_A_POLL");
    assertError(await send("PATCH", `/polls/${d.id}`, { resultsVisibility: "AFTER_VOTE" }, author.cookie), 409, "NOT_A_POLL");
    assertError(await send("POST", `/polls/${d.id}/close`, undefined, author.cookie), 409, "NOT_A_POLL");

    const edited = await send("PATCH", `/polls/${d.id}`, { title: "Güncellenmiş tartışma başlığı burada", description: null }, author.cookie);
    assert.equal(edited.statusCode, 200, edited.body);
    const after = PollDetail.parse(edited.json().data);
    assert.deepEqual([after.title, after.description, after.kind], ["Güncellenmiş tartışma başlığı burada", null, "DISCUSSION"]);
    assert.equal(await db.vote.count({ where: { pollId: d.id } }), 0);
  });

  test("tartışma feed'de ve aramada kart olarak çıkar; yorum alır; silinince görünmez", async () => {
    const marker = `Zqx${randomUUID().replace(/[0-9-]/g, "").slice(0, 6)}`;
    const d = await createDiscussion(author, { title: `Kararsız kaldığım konu ${marker} hakkında` });
    const feed = (await get(`/feed?tab=new&categoryId=${categoryId}&limit=100`)).json().data as unknown[];
    const card = feed.map((c) => PollCard.parse(c)).find((c) => c.id === d.id);
    assert.deepEqual([card?.kind, card?.results, card?.closesAt], ["DISCUSSION", null, null]);
    const found = (await get(`/search?q=${marker.toLocaleLowerCase("tr")}`)).json().data as { poll: { id: string } }[];
    assert.deepEqual(found.map((r) => r.poll.id), [d.id]);

    const commenter = await signUp();
    const comment = await send("POST", `/polls/${d.id}/comments`, { body: "Bence hibrit al." }, commenter.cookie);
    assert.equal(comment.statusCode, 201, comment.body);

    assert.equal((await send("DELETE", `/polls/${d.id}`, undefined, author.cookie)).statusCode, 204);
    assertError(await get(`/polls/${d.id}`), 404, "NOT_FOUND");
  });

  test("veritabanı da korur: tartışmaya seçenek ve oy yazılamaz, tür değişmez, tartışmada süre olamaz", async () => {
    const d = await createDiscussion();
    const voter = await signUp();
    await assert.rejects(db.pollOption.create({ data: { pollId: d.id, position: 0, label: "Gizli seçenek" } }), /KV_NOT_A_POLL/);
    const poll = await createPoll();
    await assert.rejects(
      db.vote.create({ data: { pollId: d.id, optionId: poll.options[0]!.id, userId: voter.id } }),
      /KV_NOT_A_POLL|poll_options|foreign key|violates/i,
    );
    await assert.rejects(db.poll.update({ where: { id: d.id }, data: { kind: "POLL" } }), /KV_POLL_KIND_IMMUTABLE/);
    await assert.rejects(db.poll.update({ where: { id: d.id }, data: { closesAt: new Date(Date.now() + 3_600_000) } }), /polls_kind_shape_check/);
    await assert.rejects(db.poll.update({ where: { id: poll.id }, data: { closesAt: null } }), /polls_kind_shape_check/);
  });

  // ─── Tepkiler ───────────────────────────────────────────────

  test("beğeni/dislike: tek aktif tepki, aynı değer tekrar 200, değiştirme sayaçları taşır, kaldırma idempotent", async () => {
    const d = await createDiscussion();
    const a = await signUp();
    const b = await signUp();

    assert.deepEqual(summary(await react(d.id, "LIKE", a.cookie)), { likes: 1, dislikes: 0, viewer: "LIKE" });
    assert.deepEqual(summary(await react(d.id, "LIKE", a.cookie)), { likes: 1, dislikes: 0, viewer: "LIKE" });
    assert.deepEqual(summary(await react(d.id, "DISLIKE", b.cookie)), { likes: 1, dislikes: 1, viewer: "DISLIKE" });
    assert.deepEqual(summary(await react(d.id, "DISLIKE", a.cookie)), { likes: 0, dislikes: 2, viewer: "DISLIKE" });
    assert.deepEqual(summary(await unreact(d.id, a.cookie)), { likes: 0, dislikes: 1, viewer: null });
    assert.deepEqual(summary(await unreact(d.id, a.cookie)), { likes: 0, dislikes: 1, viewer: null });

    // Detay: sayılar herkese, izleyicinin tepkisi kendisine.
    assert.deepEqual(PollDetail.parse((await get(`/polls/${d.id}`, b.cookie)).json().data).reactions, { likes: 0, dislikes: 1, viewer: "DISLIKE" });
    assert.equal(PollDetail.parse((await get(`/polls/${d.id}`, b.cookie)).json().data).viewer?.reaction, "DISLIKE");
    assert.deepEqual(PollDetail.parse((await get(`/polls/${d.id}`)).json().data).reactions, { likes: 0, dislikes: 1, viewer: null });

    // Sahibi kendi gönderisine tepki verebilir (yorum tepkisiyle aynı kural, KV-17).
    assert.deepEqual(summary(await react(d.id, "LIKE", author.cookie)), { likes: 1, dislikes: 1, viewer: "LIKE" });
  });

  test("tepki anket oyundan ayrıdır: ankette de çalışır, oy sayısını değiştirmez; kapanmış ankette verilebilir", async () => {
    const poll = await createPoll();
    const voter = await signUp();
    assert.equal((await send("PUT", `/polls/${poll.id}/vote`, { optionId: poll.options[0]!.id }, voter.cookie)).statusCode, 201);
    assert.deepEqual(summary(await react(poll.id, "DISLIKE", voter.cookie)), { likes: 0, dislikes: 1, viewer: "DISLIKE" });
    const detail = PollDetail.parse((await get(`/polls/${poll.id}`, voter.cookie)).json().data);
    assert.deepEqual([detail.viewer?.vote, detail.viewer?.reaction, detail.results?.visible && detail.results.total], [poll.options[0]!.id, "DISLIKE", 1]);

    assert.equal((await send("POST", `/polls/${poll.id}/close`, undefined, author.cookie)).statusCode, 200);
    assert.deepEqual(summary(await react(poll.id, "LIKE", voter.cookie)), { likes: 1, dislikes: 0, viewer: "LIKE" });
  });

  test("yetki ve durum: misafir 401, görünmeyen gönderi 404, kilitli gönderide yeni tepki 409 ama kaldırma serbest", async () => {
    const d = await createDiscussion();
    const user = await signUp();
    assertError(await send("PUT", `/polls/${d.id}/reaction`, { value: "LIKE" }), 401, "UNAUTHENTICATED");
    assertError(await react(randomUUID(), "LIKE", user.cookie), 404, "NOT_FOUND");
    assertError(await send("PUT", `/polls/${d.id}/reaction`, { value: "LOVE" }, user.cookie), 400, "VALIDATION_ERROR");

    summary(await react(d.id, "LIKE", user.cookie));
    await db.poll.update({ where: { id: d.id }, data: { status: "LOCKED" } });
    const other = await signUp();
    assertError(await react(d.id, "LIKE", other.cookie), 409, "CONTENT_LOCKED");
    assert.deepEqual(summary(await unreact(d.id, user.cookie)), { likes: 0, dislikes: 0, viewer: null });

    await db.poll.update({ where: { id: d.id }, data: { status: "HIDDEN" } });
    assertError(await react(d.id, "LIKE", user.cookie), 404, "NOT_FOUND");
  });

  test("eşzamanlı ve tekrar istekler: sayaç her zaman tablodaki tepki sayısına eşit", async () => {
    const d = await createDiscussion();
    const same = await signUp();
    // Aynı hesaptan 10 eşzamanlı LIKE: tek beğeni.
    await Promise.all(Array.from({ length: 10 }, () => react(d.id, "LIKE", same.cookie)));
    // 8 farklı hesap aynı anda karışık istekler (beğen, dislike'a çevir, kaldır).
    // Kayıtlar sırayla: paralel kayıt doğrulama e-postalarını karıştırır.
    const users: User[] = [];
    for (let i = 0; i < 8; i++) users.push(await signUp());
    await Promise.all(
      users.flatMap((u, i) => [react(d.id, i % 2 ? "LIKE" : "DISLIKE", u.cookie), react(d.id, "LIKE", u.cookie), i % 3 === 0 ? unreact(d.id, u.cookie) : react(d.id, "DISLIKE", u.cookie)]),
    );
    const row = await db.poll.findUniqueOrThrow({ where: { id: d.id }, select: { likeCount: true, dislikeCount: true } });
    const likes = await db.pollReaction.count({ where: { pollId: d.id, value: "LIKE" } });
    const dislikes = await db.pollReaction.count({ where: { pollId: d.id, value: "DISLIKE" } });
    assert.deepEqual([row.likeCount, row.dislikeCount], [likes, dislikes]);
    assert.equal(await db.pollReaction.count({ where: { pollId: d.id, userId: same.id } }), 1);
  });
});

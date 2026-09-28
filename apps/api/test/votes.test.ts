/**
 * KV-11 (#13) oy senaryoları. Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL; CI'da tanımlı):
 * tek aktif oy, satır kilidi, trigger'lar ve sayaç tutarlılığı bellek içinde taklit edilmez.
 * Cevaplar router tarafından sözleşme şemasıyla (VoteResult, PollDetail) doğrulanır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, PollDetail, VoteResult } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { mapDbError } from "../src/modules/polls/routes.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const HOUR = 60 * 60 * 1000;
const backend = prismaBackend();

describe("oylar (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `oy-${randomUUID().slice(0, 8)}`, name: "Oy" } })).id;
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "POST" | "PUT", url: string, body: unknown, cookie?: string, key?: string) {
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
  const vote = (pollId: string, optionId: string, cookie?: string) => send("PUT", `/polls/${pollId}/vote`, { optionId }, cookie);

  function assertError(res: { statusCode: number; json(): any }, status: number, code: string) {
    assert.equal(res.statusCode, status, JSON.stringify(res.json()));
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp(options: { verify?: boolean } = {}) {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `oy_${id}@example.test`, username: `oy_${id}`, displayName: "Oy Veren", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    if (options.verify !== false) {
      assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    }
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  async function createPoll(cookie: string, overrides: Record<string, unknown> = {}) {
    const body = {
      kind: "POLL",
      title: "Hangi telefonu almalıyım bu ay?",
      categoryId,
      durationHours: 24,
      resultsVisibility: "AFTER_VOTE",
      options: [{ label: "A" }, { label: "B" }, { label: "C" }],
      ...overrides,
    };
    const res = await send("POST", "/polls", body, cookie, `test-${randomUUID()}`);
    assert.equal(res.statusCode, 201, res.body);
    return PollDetail.parse(res.json().data);
  }

  /** Sayaçlar, geçerli oylar ve oy geçmişi birbiriyle tutarlı mı? */
  async function assertConsistent(pollId: string) {
    const poll = await db.poll.findUniqueOrThrow({ where: { id: pollId }, select: { voteCount: true } });
    const options = await db.pollOption.findMany({ where: { pollId }, select: { id: true, voteCount: true } });
    const votes = await db.vote.groupBy({ by: ["optionId"], where: { pollId, invalidatedAt: null }, _count: true });
    const byOption = new Map(votes.map((v) => [v.optionId, v._count]));
    for (const o of options) assert.equal(o.voteCount, byOption.get(o.id) ?? 0, `seçenek ${o.id} sayacı`);
    assert.equal(poll.voteCount, options.reduce((s, o) => s + o.voteCount, 0), "anket toplamı = seçenek toplamı");
    const casts = await db.voteEvent.count({ where: { pollId, type: "CAST" } });
    assert.equal(casts, await db.vote.count({ where: { pollId } }), "her oy için bir CAST olayı");
    return { total: poll.voteCount, byOption };
  }

  // ─── Temel akış ─────────────────────────────────────────────

  test("ilk oy 201; sonuç oy verene açılır; oy geçmişine CAST yazılır", async () => {
    const owner = await signUp();
    const voter = await signUp();
    const poll = await createPoll(owner.cookie);
    const [a, b, c] = poll.options.map((o) => o.id);

    const res = await vote(poll.id, a!, voter.cookie);
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(res.headers["cache-control"], "private, no-store");
    const body = VoteResult.parse(res.json().data);
    assert.equal(body.vote.optionId, a);
    assert.equal(body.vote.changeCount, 0);
    assert.deepEqual(body.results, {
      visible: true,
      total: 1,
      options: [
        { id: a, votes: 1, percent: 100 },
        { id: b, votes: 0, percent: 0 },
        { id: c, votes: 0, percent: 0 },
      ],
    });

    const events = await db.voteEvent.findMany({ where: { pollId: poll.id }, select: { type: true, userId: true, fromOptionId: true, toOptionId: true } });
    assert.deepEqual(events, [{ type: "CAST", userId: voter.id, fromOptionId: null, toOptionId: a }]);
    const detail = PollDetail.parse((await get(`/polls/${poll.id}`, voter.cookie)).json().data);
    assert.equal(detail.viewer?.vote, a);
    assert.equal(detail.contentLocked, true, "ilk geçerli oy anketi kilitler");
    await assertConsistent(poll.id);
  });

  test("aynı seçeneğe tekrar 200, yeni olay ve sayaç değişimi yok", async () => {
    const owner = await signUp();
    const voter = await signUp();
    const poll = await createPoll(owner.cookie);
    const a = poll.options[0]!.id;
    assert.equal((await vote(poll.id, a, voter.cookie)).statusCode, 201);
    const again = await vote(poll.id, a, voter.cookie);
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().data.results.total, 1);
    assert.equal(await db.voteEvent.count({ where: { pollId: poll.id } }), 1);
  });

  test("oy değişimi 200 + CHANGE; toplam değişmez; ayar kapalıyken 409", async () => {
    const owner = await signUp();
    const voter = await signUp();
    const poll = await createPoll(owner.cookie);
    const [a, b] = poll.options.map((o) => o.id);
    await vote(poll.id, a!, voter.cookie);

    const changed = await vote(poll.id, b!, voter.cookie);
    assert.equal(changed.statusCode, 200, changed.body);
    const body = VoteResult.parse(changed.json().data);
    assert.equal(body.vote.optionId, b);
    assert.equal(body.vote.changeCount, 1);
    assert.equal(body.results.visible && body.results.total, 1);
    const change = await db.voteEvent.findFirstOrThrow({ where: { pollId: poll.id, type: "CHANGE" } });
    assert.equal(change.fromOptionId, a);
    assert.equal(change.toOptionId, b);
    const { byOption } = await assertConsistent(poll.id);
    assert.equal(byOption.get(a!) ?? 0, 0);
    assert.equal(byOption.get(b!), 1);

    h.pollSettings.voteChangeAllowed = false;
    try {
      assertError(await vote(poll.id, a!, voter.cookie), 409, "VOTE_CHANGE_DISABLED");
      assert.equal((await vote(poll.id, b!, voter.cookie)).statusCode, 200, "aynı seçeneğe tekrar yine serbest");
    } finally {
      h.pollSettings.voteChangeAllowed = true;
    }
  });

  // ─── Eşzamanlılık (kabul koşulu 1) ──────────────────────────

  test("aynı hesaptan 20 eşzamanlı istek tek aktif oy üretir", async () => {
    const owner = await signUp();
    const voter = await signUp();
    const poll = await createPoll(owner.cookie);
    const ids = poll.options.map((o) => o.id);

    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => vote(poll.id, ids[i % ids.length]!, voter.cookie)));
    const statuses = responses.map((r) => r.statusCode);
    assert.equal(statuses.filter((s) => s === 201).length, 1, `tam bir 201: ${statuses.join(",")}`);
    assert.ok(statuses.every((s) => s === 201 || s === 200), statuses.join(","));
    assert.equal(await db.vote.count({ where: { pollId: poll.id } }), 1);
    const { total } = await assertConsistent(poll.id);
    assert.equal(total, 1, "toplam oy 1");
    const final = await db.vote.findFirstOrThrow({ where: { pollId: poll.id } });
    assert.equal(await db.voteEvent.count({ where: { pollId: poll.id, type: "CHANGE" } }), final.changeCount, "her değişim bir CHANGE olayı");
  });

  test("çok kullanıcılı eşzamanlı oy ve değişimler sayaçları bozmaz", async () => {
    const owner = await signUp();
    // Kayıtlar sırayla: doğrulama maili sıraya göre eşleştiriliyor (signUp → h.mails[index]).
    const voters = [];
    for (let i = 0; i < 12; i++) voters.push(await signUp());
    const poll = await createPoll(owner.cookie);
    const ids = poll.options.map((o) => o.id);

    await Promise.all(voters.map((v, i) => vote(poll.id, ids[i % 3]!, v.cookie)));
    await Promise.all(voters.flatMap((v, i) => [vote(poll.id, ids[(i + 1) % 3]!, v.cookie), vote(poll.id, ids[(i + 2) % 3]!, v.cookie)]));
    const { total } = await assertConsistent(poll.id);
    assert.equal(total, 12);
  });

  // ─── Reddedilen oylar ───────────────────────────────────────

  test("anket sahibi oy veremez (403); hiçbir satır yazılmaz; DB de reddeder", async () => {
    const owner = await signUp();
    const poll = await createPoll(owner.cookie);
    assertError(await vote(poll.id, poll.options[0]!.id, owner.cookie), 403, "SELF_VOTE_FORBIDDEN");
    assert.equal(await db.vote.count({ where: { pollId: poll.id } }), 0);
    assert.equal(await db.voteEvent.count({ where: { pollId: poll.id } }), 0);
    await assert.rejects(
      db.vote.create({ data: { pollId: poll.id, optionId: poll.options[0]!.id, userId: owner.id } }),
      (err) => mapDbError(err) === "SELF_VOTE_FORBIDDEN",
    );
  });

  test("kapanış sonrası oy reddedilir: erken kapanış ve süre dolması", async () => {
    const owner = await signUp();
    const voter = await signUp();
    const early = await createPoll(owner.cookie);
    assert.equal((await send("POST", `/polls/${early.id}/close`, undefined, owner.cookie)).statusCode, 200);
    assertError(await vote(early.id, early.options[0]!.id, voter.cookie), 409, "POLL_CLOSED");

    const expiring = await createPoll(owner.cookie, { durationHours: 1 });
    h.clock.advance(HOUR);
    assertError(await vote(expiring.id, expiring.options[0]!.id, voter.cookie), 409, "POLL_CLOSED");
    assert.equal(await db.vote.count({ where: { pollId: { in: [early.id, expiring.id] } } }), 0);
  });

  test("moderasyon kilidi 409, kaldırılmış anket 404, başka anketin seçeneği 400", async () => {
    const owner = await signUp();
    const voter = await signUp();
    const locked = await createPoll(owner.cookie);
    await db.poll.update({ where: { id: locked.id }, data: { status: "LOCKED" } });
    assertError(await vote(locked.id, locked.options[0]!.id, voter.cookie), 409, "CONTENT_LOCKED");

    const removed = await createPoll(owner.cookie);
    await db.poll.update({ where: { id: removed.id }, data: { status: "REMOVED", deletedAt: new Date() } });
    assertError(await vote(removed.id, removed.options[0]!.id, voter.cookie), 404, "NOT_FOUND");
    assertError(await vote(randomUUID(), removed.options[0]!.id, voter.cookie), 404, "NOT_FOUND");

    const a = await createPoll(owner.cookie);
    const b = await createPoll(owner.cookie);
    const foreign = await vote(a.id, b.options[0]!.id, voter.cookie);
    assertError(foreign, 400, "VALIDATION_ERROR");
    assert.deepEqual(foreign.json().error.details, [{ field: "optionId", code: "not_in_poll" }]);
  });

  test("misafir 401, e-postası doğrulanmamış 403, askıya alınmış 403", async () => {
    const owner = await signUp();
    const poll = await createPoll(owner.cookie);
    const option = poll.options[0]!.id;
    assertError(await vote(poll.id, option), 401, "UNAUTHENTICATED");
    const unverified = await signUp({ verify: false });
    assertError(await vote(poll.id, option, unverified.cookie), 403, "EMAIL_NOT_VERIFIED");
    const suspended = await signUp();
    await h.setStatus(suspended.id, "SUSPENDED");
    assertError(await vote(poll.id, option, suspended.cookie), 403, "ACCOUNT_RESTRICTED");
    assert.equal(await db.vote.count({ where: { pollId: poll.id } }), 0);
  });

  test("geçersiz sayılmış oy yeniden verilemez ve sayaçlara girmez", async () => {
    const owner = await signUp();
    const voter = await signUp();
    const poll = await createPoll(owner.cookie);
    const [a, b] = poll.options.map((o) => o.id);
    await vote(poll.id, a!, voter.cookie);
    // KV-43 gelene kadar geçersiz sayma DB'de elle yapılır (DATA_MODEL §5.4).
    await db.$transaction([
      db.vote.updateMany({ where: { pollId: poll.id, userId: voter.id }, data: { invalidatedAt: new Date(), invalidationReason: "test" } }),
      db.pollOption.update({ where: { id: a! }, data: { voteCount: { decrement: 1 } } }),
      db.poll.update({ where: { id: poll.id }, data: { voteCount: { decrement: 1 } } }),
    ]);
    assertError(await vote(poll.id, b!, voter.cookie), 409, "VOTE_INVALIDATED");
    assertError(await vote(poll.id, a!, voter.cookie), 409, "VOTE_INVALIDATED");
    const detail = PollDetail.parse((await get(`/polls/${poll.id}`, voter.cookie)).json().data);
    assert.equal(detail.viewer?.voteBlockedReason, "VOTE_INVALIDATED");
    assert.deepEqual(detail.results, { visible: false }, "geçersiz oy sonucu açmaz");
  });

  // ─── Gizlilik ve görünürlük (kabul koşulu 2 ve 3) ───────────

  test("gizli sonuç oy vermeyene ve misafire kapalı; kapanınca herkese açık", async () => {
    const owner = await signUp();
    const voter = await signUp();
    const watcher = await signUp();
    const poll = await createPoll(owner.cookie);
    await vote(poll.id, poll.options[1]!.id, voter.cookie);

    for (const cookie of [undefined, watcher.cookie]) {
      const res = await get(`/polls/${poll.id}`, cookie);
      assert.equal(res.headers["cache-control"], "private, no-store");
      assert.deepEqual(PollDetail.parse(res.json().data).results, { visible: false });
      assert.doesNotMatch(res.body, /"votes"|"total"|"percent"/, "gizli cevapta sayı yok");
    }

    await send("POST", `/polls/${poll.id}/close`, undefined, owner.cookie);
    const afterClose = PollDetail.parse((await get(`/polls/${poll.id}`)).json().data);
    assert.equal(afterClose.results?.visible, true);
    assert.equal(afterClose.results?.visible && afterClose.results.total, 1);
  });

  test("bireysel tercih public değil: başka izleyici oy verenlerin kimliğini ve seçimini görmez", async () => {
    const owner = await signUp();
    const voter = await signUp();
    const watcher = await signUp();
    const poll = await createPoll(owner.cookie, { resultsVisibility: "ALWAYS" });
    await vote(poll.id, poll.options[2]!.id, voter.cookie);

    for (const cookie of [undefined, watcher.cookie, owner.cookie]) {
      const res = await get(`/polls/${poll.id}`, cookie);
      assert.ok(!res.body.includes(voter.id), "oy verenin id'si cevapta yok");
      const detail = PollDetail.parse(res.json().data);
      assert.notEqual(detail.viewer?.vote, poll.options[2]!.id, "başkasının seçimi viewer.vote'a sızmaz");
    }
  });
});

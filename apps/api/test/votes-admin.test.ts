/**
 * KV-43 (#45) oy geçersiz sayma / geri alma (admin.votes.invalidate, admin.votes.restore). Gerçek PostgreSQL gerektirir.
 * Kurallar: DATA_MODEL §5.4. Snapshot/trend yeniden üretimi worker testinde (apps/worker/test/snapshots.test.ts).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, PollDetail, VoteCorrectionResult } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";
import { rbacSeeds } from "./support/rbac-probe.ts";

const backend = prismaBackend();
type User = { cookie: string; id: string };

describe("oy geçersiz sayma (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let author: User;
  let admin: User;
  let root: User;

  function send(method: "POST" | "PUT", url: string, body?: unknown, cookie?: string, key?: string) {
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
    const account = { email: `iv_${id}@example.test`, username: `iv_${id}`, displayName: "Oycu", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  async function createPoll() {
    const res = await send(
      "POST",
      "/polls",
      { kind: "POLL", title: `Geçersiz oy testi ${randomUUID().slice(0, 8)}`, categoryId, durationHours: 48, resultsVisibility: "ALWAYS", options: [{ label: "A" }, { label: "B" }] },
      author.cookie,
      `test-${randomUUID()}`,
    );
    assert.equal(res.statusCode, 201, res.body);
    return PollDetail.parse(res.json().data);
  }

  async function vote(pollId: string, optionId: string, user: User) {
    const res = await send("PUT", `/polls/${pollId}/vote`, { optionId }, user.cookie);
    assert.equal(res.statusCode, 201, res.body);
    return (await db.vote.findUniqueOrThrow({ where: { pollId_userId: { pollId, userId: user.id } }, select: { id: true } })).id;
  }

  const invalidate = (target: unknown, cookie = admin.cookie, reason = "Sahte hesap ağı doğrulandı") => send("POST", "/admin/votes/invalidate", { target, reason }, cookie);
  const restore = (voteIds: string[], cookie = admin.cookie, reason = "Yanlış tespit, itiraz kabul") => send("POST", "/admin/votes/restore", { voteIds, reason }, cookie);
  const result = (res: { statusCode: number; body: string; json(): any }) => {
    assert.equal(res.statusCode, 200, res.body);
    return VoteCorrectionResult.parse(res.json().data);
  };

  /** Sayaçlar: anket, seçenekler ve tablodaki geçerli oylar birbirine eşit olmalı. */
  async function counts(pollId: string) {
    const poll = await db.poll.findUniqueOrThrow({ where: { id: pollId }, select: { voteCount: true, options: { select: { voteCount: true }, orderBy: { position: "asc" } } } });
    const valid = await db.vote.count({ where: { pollId, invalidatedAt: null } });
    assert.equal(poll.voteCount, valid, "anket sayacı geçerli oy sayısına eşit");
    assert.equal(poll.options.reduce((s, o) => s + o.voteCount, 0), valid, "seçenek sayaçları geçerli oy sayısına eşit");
    return { total: poll.voteCount, options: poll.options.map((o) => o.voteCount) };
  }

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `iv-${randomUUID().slice(0, 8)}`, name: "Geçersiz Oy" } })).id;
    author = await signUp();
    root = await signUp();
    const seeds = rbacSeeds(h);
    await seeds.setRole(root.id, "SUPER_ADMIN", null);
    admin = await signUp();
    await seeds.setRole(admin.id, "ADMIN", root.id);
  });
  after(async () => {
    await h?.close();
  });

  const auditFor = (pollId: string) =>
    db.auditLog.findMany({ where: { action: "vote.invalidate", targetType: "POLL", targetId: pollId }, orderBy: [{ createdAt: "asc" }, { operation: "asc" }] });

  test("tek oy: sayaçlar ve sonuç düşer, olay aktör ve gerekçeyle yazılır, snapshot işaretlenir; tekrar çift düşüm yapmaz", async () => {
    const poll = await createPoll();
    const [a, b] = [await signUp(), await signUp()];
    const va = await vote(poll.id, poll.options[0]!.id, a);
    await vote(poll.id, poll.options[1]!.id, b);
    assert.deepEqual(await counts(poll.id), { total: 2, options: [1, 1] });

    const missing = randomUUID();
    const res = await invalidate({ type: "VOTES", voteIds: [va, missing] });
    assert.deepEqual(result(res), { changed: 1, unchanged: 0, notFound: [missing], affectedPollIds: [poll.id] });
    assert.deepEqual(await counts(poll.id), { total: 1, options: [0, 1] });

    const row = await db.vote.findUniqueOrThrow({ where: { id: va } });
    assert.deepEqual([row.invalidationReason, row.invalidatedAt?.toISOString()], ["Sahte hesap ağı doğrulandı", h.clock.now.toISOString()]);
    const events = await db.voteEvent.findMany({ where: { voteId: va }, orderBy: { occurredAt: "asc" } });
    assert.deepEqual(events.map((e) => [e.type, e.actorId, e.reason, e.fromOptionId]), [
      ["CAST", null, null, null],
      ["INVALIDATE", admin.id, "Sahte hesap ağı doğrulandı", poll.options[0]!.id],
    ]);
    const stale = await db.poll.findUniqueOrThrow({ where: { id: poll.id }, select: { snapshotsStaleSince: true } });
    assert.equal(stale.snapshotsStaleSince?.getTime(), row.createdAt.getTime(), "snapshot'lar oyun ilk verildiği andan itibaren yeniden üretilecek");

    // Audit (KV-39): aynı transaction'da, anket başına bir kayıt; istekle eşlenir, oy/seçenek kimliği içermez.
    const logs = await auditFor(poll.id);
    assert.deepEqual(
      logs.map((l) => [l.source, l.actorId, l.action, l.operation, l.targetType, l.reason, l.before, l.after, l.requestId, l.createdAt.toISOString()]),
      [["API", admin.id, "vote.invalidate", "invalidate", "POLL", "Sahte hesap ağı doğrulandı", { validVotes: 2 },
        { validVotes: 1, changedVotes: 1, accounts: 1, by: "VOTES" }, res.headers["x-request-id"], h.clock.now.toISOString()]],
    );
    assert.doesNotMatch(JSON.stringify(logs), new RegExp([va, ...poll.options.map((o) => o.id)].join("|")));

    // Tekrar istek: değişiklik yok, ikinci olay ve ikinci audit kaydı yok.
    assert.deepEqual(result(await invalidate({ type: "VOTES", voteIds: [va] })), { changed: 0, unchanged: 1, notFound: [], affectedPollIds: [] });
    assert.deepEqual(await counts(poll.id), { total: 1, options: [0, 1] });
    assert.equal(await db.voteEvent.count({ where: { voteId: va, type: "INVALIDATE" } }), 1);
    assert.equal((await auditFor(poll.id)).length, 1);

    // Kullanıcı aynı ankete yeniden oy veremez (bilinçli karar, §5.4); detayda görünür.
    assertError(await send("PUT", `/polls/${poll.id}/vote`, { optionId: poll.options[1]!.id }, a.cookie), 409, "VOTE_INVALIDATED");
    const detail = PollDetail.parse((await get(`/polls/${poll.id}`, a.cookie)).json().data);
    assert.deepEqual([detail.viewer?.voteInvalidated, detail.results?.visible && detail.results.total], [true, 1]);
  });

  test("hesap bazında: bir ankette veya bütün anketlerde; geri alma sayaçları geri getirir ve tekrar edilebilir", async () => {
    const [p1, p2] = [await createPoll(), await createPoll()];
    const [fake, honest] = [await signUp(), await signUp()];
    const f1 = await vote(p1.id, p1.options[0]!.id, fake);
    const f2 = await vote(p2.id, p2.options[0]!.id, fake);
    await vote(p1.id, p1.options[1]!.id, honest);

    assert.deepEqual(result(await invalidate({ type: "ACCOUNTS", userIds: [fake.id], pollId: p1.id })), { changed: 1, unchanged: 0, notFound: [], affectedPollIds: [p1.id] });
    assert.equal((await counts(p2.id)).total, 1, "pollId verilince diğer anket etkilenmez");
    const all = result(await invalidate({ type: "ACCOUNTS", userIds: [fake.id] }));
    assert.deepEqual([all.changed, all.unchanged, all.affectedPollIds], [1, 1, [p2.id]]);
    assert.deepEqual([(await counts(p1.id)).total, (await counts(p2.id)).total], [1, 0]);

    assert.deepEqual(result(await restore([f1, f2])), { changed: 2, unchanged: 0, notFound: [], affectedPollIds: [p1.id, p2.id].sort() });
    assert.deepEqual([(await counts(p1.id)).total, (await counts(p2.id)).total], [2, 1]);
    assert.deepEqual(result(await restore([f1])), { changed: 0, unchanged: 1, notFound: [], affectedPollIds: [] });
    const events = await db.voteEvent.findMany({ where: { voteId: f1 }, orderBy: { occurredAt: "asc" }, select: { type: true, actorId: true, toOptionId: true } });
    assert.deepEqual(events.map((e) => e.type), ["CAST", "INVALIDATE", "RESTORE"]);
    assert.deepEqual([events[2]!.actorId, events[2]!.toOptionId], [admin.id, p1.options[0]!.id]);
    const audit = async (id: string) => (await auditFor(id)).map((l) => [l.operation, l.before, l.after]);
    assert.deepEqual(await audit(p1.id), [
      ["invalidate", { validVotes: 2 }, { validVotes: 1, changedVotes: 1, accounts: 1, by: "ACCOUNTS" }],
      ["restore", { validVotes: 1 }, { validVotes: 2, changedVotes: 1, accounts: 1, by: "VOTES" }],
    ]);
    assert.deepEqual(await audit(p2.id), [
      ["invalidate", { validVotes: 1 }, { validVotes: 0, changedVotes: 1, accounts: 1, by: "ACCOUNTS" }],
      ["restore", { validVotes: 0 }, { validVotes: 1, changedVotes: 1, accounts: 1, by: "VOTES" }],
    ]);
    // Geri gelen oy yine değiştirilebilir.
    assert.equal((await send("PUT", `/polls/${p1.id}/vote`, { optionId: p1.options[1]!.id }, fake.cookie)).statusCode, 200);
  });

  test("yetki ve doğrulama: misafir 401, kullanıcı ve moderatör 403; gerekçe ve liste sınırı", async () => {
    const poll = await createPoll();
    const voter = await signUp();
    const v = await vote(poll.id, poll.options[0]!.id, voter);
    const moderator = await signUp();
    await rbacSeeds(h).setRole(moderator.id, "MODERATOR", root.id);
    const target = { type: "VOTES", voteIds: [v] };
    assertError(await send("POST", "/admin/votes/invalidate", { target, reason: "Misafir denemesi" }), 401, "UNAUTHENTICATED");
    assertError(await invalidate(target, voter.cookie), 403, "FORBIDDEN");
    assertError(await invalidate(target, moderator.cookie), 403, "FORBIDDEN");
    assertError(await restore([v], moderator.cookie), 403, "FORBIDDEN");
    assertError(await invalidate(target, admin.cookie, "x"), 400, "VALIDATION_ERROR");
    assertError(await invalidate({ type: "VOTES", voteIds: Array.from({ length: 101 }, () => randomUUID()) }), 400, "VALIDATION_ERROR");
    assertError(await invalidate({ type: "ACCOUNTS", userIds: [] }), 400, "VALIDATION_ERROR");
    assert.equal((await counts(poll.id)).total, 1, "reddedilen istek hiçbir şey değiştirmez");
  });

  test("ban tek başına geçmiş oyları geçersiz saymaz", async () => {
    const poll = await createPoll();
    const voter = await signUp();
    await vote(poll.id, poll.options[0]!.id, voter);
    await rbacSeeds(h).addSanction(voter.id, { type: "BAN", createdById: root.id, startsAt: h.clock.now });
    assert.deepEqual(await counts(poll.id), { total: 1, options: [1, 0] });
    assert.equal(await db.vote.count({ where: { userId: voter.id, invalidatedAt: { not: null } } }), 0);
  });

  test("#45 kabul (gerçek bağımlılıklar): KV-33 ban endpoint'i oyları silmez; ayrı ve gerekçeli geçersiz sayma düşer, auditlenir, geri alınır", async () => {
    const poll = await createPoll();
    const [fake, honest] = [await signUp(), await signUp()];
    const fv = await vote(poll.id, poll.options[0]!.id, fake);
    await vote(poll.id, poll.options[1]!.id, honest);

    // KV-33 (#35) gerçek yaptırım endpoint'i: BAN oturumları kapatır, oylara dokunmaz.
    const ban = await send("POST", `/admin/users/${fake.id}/sanctions`, { type: "BAN", reason: "Sahte hesap ağı" }, admin.cookie);
    assert.equal(ban.statusCode, 201, ban.body);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: fake.id }, select: { status: true } })).status, "BANNED");
    assert.deepEqual(await counts(poll.id), { total: 2, options: [1, 1] }, "ban tek başına geçmiş oyu düşmez");
    assert.equal(await db.voteEvent.count({ where: { voteId: fv, type: "INVALIDATE" } }), 0);

    // Ayrı, gerekçeli işlem: hesabın oyları düşer; tekrar istek çift düşüm yapmaz; audit ve snapshot işareti yazılır.
    assert.deepEqual(result(await invalidate({ type: "ACCOUNTS", userIds: [fake.id] })).changed, 1);
    assert.deepEqual(result(await invalidate({ type: "ACCOUNTS", userIds: [fake.id] })).changed, 0);
    assert.deepEqual(await counts(poll.id), { total: 1, options: [0, 1] });
    const logs = await auditFor(poll.id);
    assert.deepEqual(logs.map((l) => [l.operation, l.actorId, (l.after as { by: string }).by]), [["invalidate", admin.id, "ACCOUNTS"]]);
    const stale = await db.poll.findUniqueOrThrow({ where: { id: poll.id }, select: { snapshotsStaleSince: true } });
    assert.ok(stale.snapshotsStaleSince, "trend/snapshot yeniden hesabı için işaretlendi (worker testleri yeniden üretimi doğrular)");

    // Geri alma: sayaçlar döner, ikinci audit kaydı.
    assert.equal(result(await restore([fv])).changed, 1);
    assert.deepEqual(await counts(poll.id), { total: 2, options: [1, 1] });
    assert.deepEqual((await auditFor(poll.id)).map((l) => l.operation), ["invalidate", "restore"]);
  });

  test("eşzamanlı: iki yönetici aynı oyları geçersiz sayar ve aynı anda yeni oylar gelir; sayaçlar tablo ile tutarlı", async () => {
    const poll = await createPoll();
    const voters: User[] = [];
    for (let i = 0; i < 6; i++) voters.push(await signUp());
    const ids: string[] = [];
    for (const v of voters.slice(0, 4)) ids.push(await vote(poll.id, poll.options[0]!.id, v));
    const other = await signUp();
    await rbacSeeds(h).setRole(other.id, "ADMIN", root.id);

    const [r1, r2] = await Promise.all([
      invalidate({ type: "VOTES", voteIds: ids }),
      invalidate({ type: "VOTES", voteIds: ids }, other.cookie),
      send("PUT", `/polls/${poll.id}/vote`, { optionId: poll.options[1]!.id }, voters[4]!.cookie),
      send("PUT", `/polls/${poll.id}/vote`, { optionId: poll.options[0]!.id }, voters[5]!.cookie),
    ]);
    const [a, b] = [result(r1), result(r2)];
    assert.equal(a.changed + b.changed, 4, "her oy bir kez düşer");
    assert.deepEqual(await counts(poll.id), { total: 2, options: [1, 1] });
    assert.equal(await db.voteEvent.count({ where: { pollId: poll.id, type: "INVALIDATE" } }), 4);
    // Değişiklik yapan her istek bir audit kaydı yazar; toplam düşüm 4.
    const logs = await auditFor(poll.id);
    assert.equal(logs.length, [a, b].filter((r) => r.changed > 0).length);
    assert.equal(logs.reduce((sum, l) => sum + (l.after as { changedVotes: number }).changedVotes, 0), 4);
  });

  test("veritabanı: geçersiz sayma/geri alma olayı aktörsüz veya gerekçesiz yazılamaz; oy olayı aktör taşımaz", async () => {
    const poll = await createPoll();
    const voter = await signUp();
    const v = await vote(poll.id, poll.options[0]!.id, voter);
    const base = { voteId: v, pollId: poll.id, userId: voter.id };
    await assert.rejects(db.voteEvent.create({ data: { ...base, type: "INVALIDATE", fromOptionId: poll.options[0]!.id, reason: "gerekçe" } }), /vote_events_actor_check/);
    await assert.rejects(db.voteEvent.create({ data: { ...base, type: "INVALIDATE", fromOptionId: poll.options[0]!.id, actorId: admin.id } }), /vote_events_actor_check/);
    await assert.rejects(db.voteEvent.create({ data: { ...base, type: "CHANGE", fromOptionId: poll.options[0]!.id, toOptionId: poll.options[1]!.id, actorId: admin.id } }), /vote_events_actor_check/);
  });
});

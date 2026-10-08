/**
 * KV-34 (#36) bildirim tercihleri ve anket sessizi: API + uçtan uca (mutation → olay → dağıtıcı → bildirim).
 * Worker'ın dağıtıcısı ve tüketicisi, kv21-e2e.test.ts'teki gibi yalnız testte göreli yolla import edilir.
 * Tüketici varsayılan politikayla (preferencePolicy) kurulur: üretimdeki registry ile aynı.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, MANDATORY_NOTIFICATION_TYPES, NotificationPreferences, NotificationType, NotificationView, PollDetail } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { dispatchBatch, processNext, type DispatchDeps } from "../../worker/src/jobs/events/dispatch.ts";
import { productionConsumers } from "../../worker/src/jobs/events/registry.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";
import { rbacSeeds } from "./support/rbac-probe.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string };
type Res = { statusCode: number; body: string; json(): any };

const OPTIONAL = NotificationType.options.filter((t) => !MANDATORY_NOTIFICATION_TYPES.includes(t));

describe("KV-34 bildirim tercihleri ve anket sessizi (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let deps: DispatchDeps;
  let root: User;
  let admin: User;

  function send(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, cookie?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
        ...(method === "POST" ? { "idempotency-key": `kv34-${randomUUID()}` } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as Promise<Res>;
  }

  function assertError(res: Res, status: number, code: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `kv34_${id}@example.test`, username: `kv34_${id}`, displayName: "Tercih", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie((login as unknown as { headers: Record<string, string> }).headers["set-cookie"]!), id: login.json().data.id };
  }

  async function createPoll(owner: User) {
    const body = { kind: "POLL", title: `Tercih ${randomUUID().slice(0, 8)}`, categoryId, durationHours: 24, resultsVisibility: "ALWAYS", options: [{ label: "Evet" }, { label: "Hayır" }] };
    const res = await send("POST", "/polls", body, owner.cookie);
    assert.equal(res.statusCode, 201, res.body);
    return PollDetail.parse(res.json().data);
  }

  /** events.dispatch'in bir turu gibi: dağıt, vadesi gelen bütün teslimleri işle. */
  async function drain() {
    for (;;) {
      const d = await dispatchBatch(deps);
      let n = 0;
      while ((await processNext(deps)) !== "none") n++;
      if (d.events === 0 && n === 0) return;
    }
  }

  async function notificationsOf(user: User) {
    const res = await send("GET", "/notifications", undefined, user.cookie);
    assert.equal(res.statusCode, 200, res.body);
    return (res.json().data as unknown[]).map((n) => NotificationView.parse(n));
  }
  const ofType = async (user: User, type: string, pollId?: string) =>
    (await notificationsOf(user)).filter((n) => n.type === type && (pollId === undefined || n.subject.id === pollId || n.data.pollId === pollId));

  const prefs = async (user: User) => {
    const res = await send("GET", "/notifications/preferences", undefined, user.cookie);
    assert.equal(res.statusCode, 200, res.body);
    return NotificationPreferences.parse(res.json().data).types;
  };
  const setPrefs = (user: User, types: Record<string, boolean>) => send("PATCH", "/notifications/preferences", { types }, user.cookie);
  const mute = (user: User, pollId: string) => send("PUT", `/notifications/mutes/${pollId}`, undefined, user.cookie);
  const unmute = (user: User, pollId: string) => send("DELETE", `/notifications/mutes/${pollId}`, undefined, user.cookie);
  const vote = async (user: User, poll: Awaited<ReturnType<typeof createPoll>>) =>
    assert.equal((await send("PUT", `/polls/${poll.id}/vote`, { optionId: poll.options[0]!.id }, user.cookie)).statusCode, 201);

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `kv34-${randomUUID().slice(0, 8)}`, name: "KV-34" } })).id;
    deps = { prisma: db, consumers: productionConsumers, now: () => new Date(), log: () => {} };
    root = await signUp();
    admin = await signUp();
    const seeds = rbacSeeds(h);
    await seeds.setRole(root.id, "SUPER_ADMIN", null);
    await seeds.setRole(admin.id, "ADMIN", root.id);
    // Önceki testlerin dağıtılmamış olayları bu dosyanın sayımlarına karışmasın.
    await drain();
  });
  after(async () => {
    await h?.close();
  });

  // ─── API ─────────────────────────────────────────────────────

  test("tercihler: varsayılan hepsi açık, kapatılamayan tipler listede yok; aç/kapat kalıcı ve kullanıcıya özel", async () => {
    const [u, other] = [await signUp(), await signUp()];
    assert.deepEqual(await prefs(u), Object.fromEntries(OPTIONAL.map((t) => [t, true])));
    for (const t of MANDATORY_NOTIFICATION_TYPES) assert.equal(t in (await prefs(u)), false, t);

    const res = await setPrefs(u, { COMMENT_ON_POLL: false, POLL_TRENDING: false });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(NotificationPreferences.parse(res.json().data).types, { ...(await prefs(other)), COMMENT_ON_POLL: false, POLL_TRENDING: false });
    // Tekrar aynı istek ve kısmi açma.
    assert.equal((await setPrefs(u, { COMMENT_ON_POLL: false })).statusCode, 200);
    assert.equal((await setPrefs(u, { POLL_TRENDING: true })).statusCode, 200);
    const now = await prefs(u);
    assert.deepEqual([now.COMMENT_ON_POLL, now.POLL_TRENDING, now.POLL_CLOSED], [false, true, true]);
    assert.equal(Object.values(await prefs(other)).every(Boolean), true, "başka kullanıcının tercihi değişmedi");
  });

  test("tercihler: kapatılamayan tip 400 ve hiçbir değişiklik yapılmaz; bilinmeyen tip 400; oturumsuz 401", async () => {
    const u = await signUp();
    for (const t of MANDATORY_NOTIFICATION_TYPES) {
      const res = await setPrefs(u, { COMMENT_ON_POLL: false, [t]: false });
      assertError(res, 400, "VALIDATION_ERROR");
      assert.equal(res.json().error.details[0].field, `types.${t}`);
    }
    assert.equal((await prefs(u)).COMMENT_ON_POLL, true, "istek bütünüyle reddedildi");
    assertError(await setPrefs(u, { BILINMEYEN: false }), 400, "VALIDATION_ERROR");
    assertError(await send("GET", "/notifications/preferences"), 401, "UNAUTHENTICATED");
    assertError(await send("PATCH", "/notifications/preferences", { types: {} }), 401, "UNAUTHENTICATED");
    assertError(await send("PUT", `/notifications/mutes/${randomUUID()}`), 401, "UNAUTHENTICATED");
    // DB son savunma: kapatılamayan tip yazılamaz.
    await assert.rejects(db.notificationTypeOptOut.create({ data: { userId: u.id, type: "SANCTION_APPLIED" } }), /check|23514/i);
  });

  test("sessize alma: olmayan anket 404; tekrar çağrılar aynı cevabı verir; geri alma idempotent", async () => {
    const [owner, u] = [await signUp(), await signUp()];
    const poll = await createPoll(owner);
    assertError(await mute(u, randomUUID()), 404, "NOT_FOUND");
    for (let i = 0; i < 2; i++) {
      const res = await mute(u, poll.id);
      assert.equal(res.statusCode, 200, res.body);
      assert.deepEqual(res.json().data, { muted: true });
    }
    assert.equal(await db.notificationPollMute.count({ where: { userId: u.id, pollId: poll.id } }), 1);
    for (let i = 0; i < 2; i++) assert.deepEqual((await unmute(u, poll.id)).json().data, { muted: false });
    assert.equal(await db.notificationPollMute.count({ where: { userId: u.id } }), 0);
  });

  // ─── Uçtan uca ───────────────────────────────────────────────

  test("kapalı tip yeni bildirim üretmez; açılınca sonraki olay gelir; mevcut bildirim ve okundu durumu değişmez", async () => {
    const [owner, alice, bob] = [await signUp(), await signUp(), await signUp()];
    const poll = await createPoll(owner);
    assert.equal((await send("POST", `/polls/${poll.id}/comments`, { body: "İlk yorum" }, alice.cookie)).statusCode, 201);
    await drain();
    const [first] = await ofType(owner, "COMMENT_ON_POLL");
    assert.ok(first);
    const read = await send("POST", "/notifications/read", { ids: [first!.id] }, owner.cookie);
    assert.equal(read.statusCode, 200, `${read.body}\n${h.logs.filter((l) => l.includes('"level":50')).slice(-2).join("\n")}`);

    assert.equal((await setPrefs(owner, { COMMENT_ON_POLL: false })).statusCode, 200);
    assert.equal((await send("POST", `/polls/${poll.id}/comments`, { body: "Kapalıyken" }, bob.cookie)).statusCode, 201);
    await drain();
    const afterOff = await ofType(owner, "COMMENT_ON_POLL");
    assert.deepEqual(afterOff.map((n) => [n.id, n.readAt !== null]), [[first!.id, true]], "yeni bildirim yok; eskisi okundu olarak duruyor");

    assert.equal((await setPrefs(owner, { COMMENT_ON_POLL: true })).statusCode, 200);
    assert.equal((await send("POST", `/polls/${poll.id}/comments`, { body: "Açıkken" }, bob.cookie)).statusCode, 201);
    await drain();
    assert.equal((await ofType(owner, "COMMENT_ON_POLL")).length, 2);
    assert.equal((await send("GET", "/notifications/unread-count", undefined, owner.cookie)).json().data.count, 1);
  });

  test("anket sessizi: sessize alan oy veren POLL_CLOSED almaz, diğeri alır; başka anket etkilenmez; sessiz kalkınca gelir", async () => {
    const [owner, muted, loud] = [await signUp(), await signUp(), await signUp()];
    const [p1, p2, p3] = [await createPoll(owner), await createPoll(owner), await createPoll(owner)];
    for (const p of [p1, p2, p3]) for (const u of [muted, loud]) await vote(u, p);
    assert.equal((await mute(muted, p1.id)).statusCode, 200);
    assert.equal((await mute(muted, p3.id)).statusCode, 200);
    for (const p of [p1, p2]) assert.equal((await send("POST", `/polls/${p.id}/close`, undefined, owner.cookie)).statusCode, 200);
    await drain();
    assert.equal((await ofType(muted, "POLL_CLOSED", p1.id)).length, 0, "sessizdeki anket");
    assert.equal((await ofType(muted, "POLL_CLOSED", p2.id)).length, 1, "sessizde olmayan anket");
    assert.equal((await ofType(loud, "POLL_CLOSED", p1.id)).length, 1, "başka kullanıcı etkilenmez");

    assert.equal((await unmute(muted, p3.id)).statusCode, 200);
    assert.equal((await send("POST", `/polls/${p3.id}/close`, undefined, owner.cookie)).statusCode, 200);
    await drain();
    assert.equal((await ofType(muted, "POLL_CLOSED", p3.id)).length, 1, "sessiz kalkınca gelir");
  });

  test("kapatılamayan tipler: anket sessizde ve bütün tipler kapalıyken de MODERATION_APPLIED ve SANCTION_APPLIED gelir", async () => {
    const owner = await signUp();
    const poll = await createPoll(owner);
    assert.equal((await setPrefs(owner, Object.fromEntries(OPTIONAL.map((t) => [t, false])))).statusCode, 200);
    assert.equal((await mute(owner, poll.id)).statusCode, 200);

    const hide = await send("POST", `/admin/polls/${poll.id}/moderation`, { action: "HIDE", reason: "Kural ihlali testi" }, admin.cookie);
    assert.equal(hide.statusCode, 200, hide.body);
    const warn = await send("POST", `/admin/users/${owner.id}/sanctions`, { type: "WARNING", reason: "Uyarı testi" }, admin.cookie);
    assert.equal(warn.statusCode, 201, warn.body);
    await drain();
    assert.equal((await ofType(owner, "MODERATION_APPLIED", poll.id)).length, 1);
    assert.equal((await ofType(owner, "SANCTION_APPLIED")).length, 1);
  });

  test("tekrar teslim (retry) ve kapanış + karar olayları olay kimliğiyle tek bildirim üretir; arada tercih değişse de çift yok", async () => {
    const [owner, voter] = [await signUp(), await signUp()];
    const poll = await createPoll(owner);
    await vote(voter, poll);
    assert.equal((await send("POST", `/polls/${poll.id}/close`, undefined, owner.cookie)).statusCode, 200);
    const decide = await send("PUT", `/polls/${poll.id}/decision`, { chosenOptionId: poll.options[0]!.id, note: "Karar verildi" }, owner.cookie);
    assert.ok(decide.statusCode < 300, decide.body);
    await drain();
    const before = (await notificationsOf(voter)).filter((n) => n.type === "POLL_CLOSED" || n.type === "DECISION_UPDATED");
    assert.deepEqual(before.map((n) => n.type).sort(), ["DECISION_UPDATED", "POLL_CLOSED"]);

    // Teslimleri yeniden kuyruğa al (worker retry'ı gibi); arada sessize al ve geri al.
    const events = await db.domainEvent.findMany({ where: { subjectId: poll.id, type: { in: ["poll.closed", "decision.updated"] } }, select: { id: true } });
    assert.equal(events.length, 2);
    const requeue = () =>
      db.eventDelivery.updateMany({ where: { eventId: { in: events.map((e) => e.id) }, consumer: "notifications" }, data: { status: "PENDING", nextAttemptAt: new Date(0), processedAt: null } });
    await requeue();
    await drain();
    assert.equal((await mute(voter, poll.id)).statusCode, 200);
    await requeue();
    await drain();
    assert.equal((await unmute(voter, poll.id)).statusCode, 200);
    await requeue();
    await drain();
    const afterRetries = (await notificationsOf(voter)).filter((n) => n.type === "POLL_CLOSED" || n.type === "DECISION_UPDATED");
    assert.deepEqual(afterRetries.map((n) => n.id).sort(), before.map((n) => n.id).sort(), "aynı satırlar; çift bildirim yok");
  });
});

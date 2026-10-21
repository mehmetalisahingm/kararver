/**
 * #183 / KV-37 S1: admin.spamScores.list (gölge mod). Yetki (yalnız ADMIN+), ayar kapalıyken boş liste, sıralama/imleç/süzgeç,
 * eski satırların gizlenmesi ve kullanıcıya hiçbir yüzeyde puan sızmaması. Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL veya .env).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, SpamScoreView } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string; username: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };
const SIGNALS = { duplicatePosts: 1, comments24h: 12, youngBurst: 0, actionedReports: 0, hiddenContent: 0 };

describe("spam puanı yönetici listesi (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let superAdmin: User;
  let admin: User;
  let moderator: User;
  let member: User;

  before(async () => {
    h = await createHarness(backend!, { realSettings: true });
    db = h.prisma!;
    superAdmin = await signUp();
    await db.userRole.create({ data: { userId: superAdmin.id, role: "SUPER_ADMIN" } });
    admin = await signUp();
    await db.userRole.create({ data: { userId: admin.id, role: "ADMIN", grantedById: superAdmin.id } });
    moderator = await signUp();
    await db.userRole.create({ data: { userId: moderator.id, role: "MODERATOR", grantedById: superAdmin.id } });
    member = await signUp();
  });
  after(async () => {
    await h?.close();
  });

  function get(url: string, cookie?: string): Promise<Res> {
    return h.app.inject({ method: "GET", url: `/v1${url}`, headers: { origin: WEB_ORIGIN, ...(cookie ? { cookie } : {}) } }) as unknown as Promise<Res>;
  }
  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `sp_${id}@example.test`, username: `sp_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    const post = (url: string, body: unknown) =>
      h.app.inject({ method: "POST", url: `/v1${url}`, headers: { origin: WEB_ORIGIN, "content-type": "application/json" }, payload: JSON.stringify(body) }) as unknown as Promise<Res>;
    assert.equal((await post("/auth/register", account)).statusCode, 202);
    assert.equal((await post("/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await post("/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id as string, username: account.username };
  }
  async function setFlag(on: boolean) {
    const current = (await h.settings!.list()).find((e) => e.key === "spam.shadowScoring.enabled")!;
    if (current.value === on) return;
    const outcome = await h.settings!.update({ key: "spam.shadowScoring.enabled", value: on, version: current.version, reason: "Gölge mod testi için bayrak", actorId: superAdmin.id, requestId: randomUUID() });
    assert.equal(outcome.kind, "updated", JSON.stringify(outcome));
    h.settings!.invalidate();
  }
  const score = async (score: number, computedAt = h.clock.now) => {
    const user = await signUp();
    await db.spamAccountScore.create({ data: { userId: user.id, score, signals: SIGNALS, computedAt } });
    return user;
  };
  const clear = () => db.spamAccountScore.deleteMany({});

  test("ayar kapalıyken (varsayılan) ADMIN için liste boştur, satır olsa bile", async () => {
    await setFlag(false);
    await clear();
    await score(70);
    const res = await get("/admin/spam-scores", admin.cookie);
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { data: [], page: { nextCursor: null, hasMore: false } });
  });

  test("yetki: oturumsuz 401; üye ve moderatör 403; ADMIN ve SUPER_ADMIN 200", async () => {
    await setFlag(true);
    for (const [cookie, status] of [[undefined, 401], [member.cookie, 403], [moderator.cookie, 403], [admin.cookie, 200], [superAdmin.cookie, 200]] as const) {
      const res = await get("/admin/spam-scores", cookie);
      assert.equal(res.statusCode, status, `${status} beklenirdi: ${res.body}`);
      if (status !== 200) ErrorBody.parse(res.json());
    }
  });

  test("açıkken puan azalan sırayla döner, sinyaller yalnız sayaçtır; imleç sayfalar; minScore süzer", async () => {
    await setFlag(true);
    await clear();
    const low = await score(20);
    const high = await score(90);
    const mid = await score(55);
    const all = await get("/admin/spam-scores?limit=2", admin.cookie);
    assert.equal(all.statusCode, 200, all.body);
    const first = all.json();
    assert.deepEqual(first.data.map((r: { userId: string }) => r.userId), [high.id, mid.id]);
    assert.equal(first.page.hasMore, true);
    for (const row of first.data) SpamScoreView.parse(row);
    assert.deepEqual(Object.keys(first.data[0]).sort(), ["computedAt", "score", "signals", "userId", "username"]);
    const next = await get(`/admin/spam-scores?limit=2&cursor=${encodeURIComponent(first.page.nextCursor)}`, admin.cookie);
    assert.deepEqual(next.json().data.map((r: { userId: string }) => r.userId), [low.id]);
    assert.equal(next.json().page.hasMore, false);
    const filtered = await get("/admin/spam-scores?minScore=50", admin.cookie);
    assert.deepEqual(filtered.json().data.map((r: { userId: string }) => r.userId), [high.id, mid.id]);
    // Süzgeç değişince eski imleç geçersizdir.
    assertError(await get(`/admin/spam-scores?minScore=50&limit=2&cursor=${encodeURIComponent(first.page.nextCursor)}`, admin.cookie), 400, "INVALID_CURSOR");
  });

  test("90 günden eski satır ve silinmiş hesap listede görünmez", async () => {
    await setFlag(true);
    await clear();
    const stale = await score(80, new Date(h.clock.now.getTime() - 91 * 24 * 60 * 60_000));
    const gone = await score(75);
    await db.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    const fresh = await score(60);
    const res = await get("/admin/spam-scores", admin.cookie);
    const ids = res.json().data.map((r: { userId: string }) => r.userId);
    assert.deepEqual(ids, [fresh.id]);
    assert.ok(!ids.includes(stale.id) && !ids.includes(gone.id));
  });

  test("kullanıcıya hiçbir yüzeyde puan sızmaz: kendi profili, oturum ve herkese açık profil", async () => {
    await setFlag(true);
    await clear();
    const target = await score(95);
    for (const [url, cookie] of [["/me", target.cookie], [`/users/${target.username}`, member.cookie], [`/users/${target.username}`, undefined]] as const) {
      const res = await get(url, cookie);
      assert.ok(!/spam|\"score\"|signals/i.test(res.body), `${url} puan sızdırıyor: ${res.body.slice(0, 200)}`);
    }
  });

  function assertError(res: Res, status: number, code: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }
});

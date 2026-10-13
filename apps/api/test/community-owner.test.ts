/**
 * #184 / KV-54 S1 topluluk sahibi: atama/bırakma, bayrak (varsayılan kapalı), uygunluk, 3 topluluk sınırı, son sahip koruması
 * (ayrılma, DB tetikleyicileri), #172 başvuru onayında atama, BAN'da otomatik bırakma ve V1 izolasyonu (sahiplik ek yetki vermez).
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL veya .env).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { AdminCommunityOverview, AdminCommunityRow, defaultSettings, ErrorBody } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { MAX_OWNED_COMMUNITIES } from "../src/modules/communities/owner.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string; username: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };
const REASON = "Topluluğu kuran kullanıcı sahip olarak atandı";

describe("topluluk sahibi (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let boss: User;
  let admin: User;
  let moderator: User;

  before(async () => {
    h = await createHarness(backend!, { realSettings: true });
    db = h.prisma!;
    boss = await signUp();
    await db.userRole.create({ data: { userId: boss.id, role: "SUPER_ADMIN" } });
    admin = await signUp();
    await db.userRole.create({ data: { userId: admin.id, role: "ADMIN", grantedById: boss.id } });
    moderator = await signUp();
    await db.userRole.create({ data: { userId: moderator.id, role: "MODERATOR", grantedById: boss.id } });
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: unknown, cookie?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as Promise<Res>;
  }

  function assertError(res: Res, status: number, code: string, detail?: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
    if (detail) assert.equal(res.json().error.details[0]?.code, detail, res.body);
  }

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `co_${id}@example.test`, username: `co_${id}`, displayName: `Ad ${id}`, password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id, username: account.username };
  }

  /** Ayar bayrağı: gerçek ayar servisi (audit'li, sürümlü); önbellek düşürülür. */
  async function setFlag(on: boolean) {
    const current = (await h.settings!.list()).find((e) => e.key === "communities.ownershipEnabled")!;
    if (current.value === on) return;
    const outcome = await h.settings!.update({ key: "communities.ownershipEnabled", value: on, version: current.version, reason: "Sahiplik testi için bayrak", actorId: boss.id, requestId: randomUUID() });
    assert.equal(outcome.kind, "updated", JSON.stringify(outcome));
    h.settings!.invalidate();
  }

  const slug = () => `co${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  async function community(name = "Sahip testi") {
    const res = await send("POST", "/admin/communities", { slug: slug(), name }, admin.cookie);
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }
  const put = (communityId: string, userId: string, cookie = boss.cookie, reason: unknown = REASON) => send("PUT", `/admin/communities/${communityId}/owner`, { userId, reason }, cookie);
  const release = (communityId: string, cookie = boss.cookie) => send("POST", `/admin/communities/${communityId}/owner/release`, { reason: "Sahip hesabı bırakmak istedi" }, cookie);
  const releaseOwn = (communityId: string, cookie: string) => send("POST", `/communities/${communityId}/owner/release`, undefined, cookie);
  const join = (communityId: string, cookie: string) => send("PUT", `/communities/${communityId}/membership`, undefined, cookie);
  const leave = (communityId: string, cookie: string) => send("DELETE", `/communities/${communityId}/membership`, undefined, cookie);
  const overview = (communityId: string) => send("GET", `/admin/communities/${communityId}/overview`, undefined, admin.cookie);
  const ownerOf = async (communityId: string) => (await db.community.findUniqueOrThrow({ where: { id: communityId }, select: { ownerId: true } })).ownerId;
  const audits = (communityId: string, action: string, operation?: string) =>
    db.auditLog.findMany({ where: { action, targetType: "COMMUNITY", targetId: communityId, ...(operation ? { operation } : {}) }, orderBy: { createdAt: "asc" } });
  const membership = (communityId: string, userId: string) => db.communityMembership.findUnique({ where: { communityId_userId: { communityId, userId } } });
  /** Üyelik + sayaç birlikte (doğrudan eklenen üyelik sayacı eksik bırakır ve ayrılma member_count >= 0 kısıtına takılır). */
  async function addMember(communityId: string, userId: string, role: "MEMBER" | "MODERATOR" = "MEMBER") {
    await db.communityMembership.create({ data: { communityId, userId, role } });
    await db.community.update({ where: { id: communityId }, data: { memberCount: { increment: 1 } } });
  }
  async function rawUser(patch: Record<string, unknown> = {}) {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    return db.user.create({
      data: { email: `raw_${id}@example.test`, emailNormalized: `raw_${id}@example.test`, username: `raw_${id}`, usernameNormalized: `raw_${id}`, displayName: "Ham", passwordHash: "x", emailVerifiedAt: new Date(), ...patch },
    });
  }

  // ─── Bayrak: varsayılan kapalı (V1 davranışı) ───────────────

  test("bayrak varsayılan kapalı: atama 503 FEATURE_DISABLED ve hiçbir iz bırakmaz; mevcut sahiplik okunur ve bırakılabilir; açılınca atama çalışır", async () => {
    // Resmî varsayılan kapalıdır (KV-54 §2/1); test DB'si yeniden kullanılmış olabilir, bu yüzden açıkça kapatılarak başlanır.
    assert.equal(defaultSettings().values["communities.ownershipEnabled"], false);
    await setFlag(false);
    const id = await community();
    const user = await signUp();
    assertError(await put(id, user.id), 503, "FEATURE_DISABLED");
    assert.equal(await ownerOf(id), null);
    assert.equal((await audits(id, "community.owner.assign")).length, 0);

    // Bayrak kapalıyken de mevcut sahiplik görünür ve (güvenli yön) bırakılabilir.
    await addMember(id, user.id);
    await db.community.update({ where: { id }, data: { ownerId: user.id } });
    assert.equal(AdminCommunityOverview.parse((await overview(id)).json().data).owner?.id, user.id);
    assert.equal((await release(id)).statusCode, 200);
    assert.equal(await ownerOf(id), null);

    await setFlag(true);
    assert.equal((await put(id, user.id)).statusCode, 200);
    await setFlag(false);
    assertError(await put(id, (await signUp()).id), 503, "FEATURE_DISABLED");
    assert.equal(await ownerOf(id), user.id, "bayrak kapanınca mevcut sahiplik korunur");
    await setFlag(true);
  });

  // ─── Yetki ──────────────────────────────────────────────────

  test("yetki: atama ve bırakma yalnız SUPER_ADMIN (misafir 401, kullanıcı/moderatör/ADMIN 403); olmayan topluluk ve kullanıcı 404", async () => {
    await setFlag(true);
    const id = await community();
    const user = await signUp();
    for (const call of [(c: string) => put(id, user.id, c), (c: string) => release(id, c)]) {
      assertError(await call(""), 401, "UNAUTHENTICATED");
      assertError(await call(user.cookie), 403, "FORBIDDEN");
      assertError(await call(moderator.cookie), 403, "FORBIDDEN");
      assertError(await call(admin.cookie), 403, "FORBIDDEN");
    }
    assert.equal(await ownerOf(id), null);
    assertError(await put(randomUUID(), user.id), 404, "NOT_FOUND");
    assertError(await put(id, randomUUID()), 404, "NOT_FOUND");
    assertError(await release(randomUUID()), 404, "NOT_FOUND");
    assertError(await put(id, user.id, boss.cookie, "ab"), 400, "VALIDATION_ERROR");
  });

  // ─── Atama ──────────────────────────────────────────────────

  test("atama: sahip olur (audit gerekçe + request id), üye değilse MEMBER olarak eklenir (sayaç), tekrar atama değişmez (iz yok), başka kullanıcıya geçince eski sahip üye kalır", async () => {
    await setFlag(true);
    const id = await community();
    const first = await signUp();
    const second = await signUp();
    const before = (await db.community.findUniqueOrThrow({ where: { id } })).memberCount;

    const res = await put(id, first.id);
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().data.owner, { id: first.id, username: first.username, displayName: (await db.user.findUniqueOrThrow({ where: { id: first.id } })).displayName });
    assert.equal(await ownerOf(id), first.id);
    assert.equal((await membership(id, first.id))?.role, "MEMBER");
    assert.equal((await db.community.findUniqueOrThrow({ where: { id } })).memberCount, before + 1);
    const [entry, ...rest] = await audits(id, "community.owner.assign", "assign");
    assert.equal(rest.length, 0);
    assert.equal(entry!.actorId, boss.id);
    assert.equal(entry!.reason, REASON);
    assert.ok(entry!.requestId);
    assert.deepEqual(entry!.before, { ownerId: null });
    assert.deepEqual(entry!.after, { ownerId: first.id, memberAdded: true });

    assert.equal((await put(id, first.id)).statusCode, 200, "idempotent");
    assert.equal((await audits(id, "community.owner.assign")).length, 1, "değişiklik yoksa audit yok");
    assert.equal((await db.community.findUniqueOrThrow({ where: { id } })).memberCount, before + 1);

    // Mevcut moderatör rolü korunur; sahip değişince eski sahip üye kalır.
    await addMember(id, second.id, "MODERATOR");
    assert.equal((await put(id, second.id)).statusCode, 200);
    assert.equal(await ownerOf(id), second.id);
    assert.equal((await membership(id, second.id))?.role, "MODERATOR");
    assert.ok(await membership(id, first.id), "eski sahip üye kalır");
    const replaced = (await audits(id, "community.owner.assign", "assign")).at(-1)!;
    assert.deepEqual(replaced.before, { ownerId: first.id });
    assert.deepEqual(replaced.after, { ownerId: second.id, memberAdded: false });
  });

  test("uygunluk: e-postası doğrulanmamış, askıda/yasaklı/kısıtlı veya silinmiş hesap sahip olamaz (409 user_not_eligible); iz bırakmaz", async () => {
    await setFlag(true);
    const id = await community();
    const unverified = await rawUser({ emailVerifiedAt: null });
    const suspended = await rawUser({ status: "SUSPENDED" });
    const banned = await rawUser({ status: "BANNED" });
    const restricted = await rawUser({ status: "RESTRICTED" });
    const deleted = await rawUser({ deletedAt: new Date() });
    for (const u of [unverified, suspended, banned, restricted, deleted]) assertError(await put(id, u.id), 409, "CONFLICT", "user_not_eligible");
    assert.equal(await ownerOf(id), null);
    assert.equal((await audits(id, "community.owner.assign")).length, 0);
    assert.equal(await db.communityMembership.count({ where: { communityId: id } }), 0, "reddedilen aday üye yapılmaz");
  });

  test(`sınır: aynı kullanıcı en çok ${MAX_OWNED_COMMUNITIES} topluluğa sahip olur (409 owner_limit); zaten sahip olduğu topluluğa tekrar atama sayılmaz; bırakınca yeniden atanabilir`, async () => {
    await setFlag(true);
    const user = await signUp();
    const ids = [] as string[];
    for (let i = 0; i < MAX_OWNED_COMMUNITIES + 1; i++) ids.push(await community());
    for (const id of ids.slice(0, MAX_OWNED_COMMUNITIES)) assert.equal((await put(id, user.id)).statusCode, 200);
    assert.equal((await put(ids[0]!, user.id)).statusCode, 200, "mevcut sahiplik sayıya yeniden eklenmez");
    const last = ids.at(-1)!;
    assertError(await put(last, user.id), 409, "CONFLICT", "owner_limit");
    assert.equal(await ownerOf(last), null);
    assert.equal(await membership(last, user.id), null, "reddedilen atama üyelik eklemez");
    assert.equal((await release(ids[1]!)).statusCode, 200);
    assert.equal((await put(last, user.id)).statusCode, 200);
  });

  test("yarış: aynı kullanıcıya dört topluluk aynı anda atanınca sınır aşılmaz; aynı topluluğa iki kullanıcı aynı anda atanınca tek sahip kalır ve audit tutarlıdır", async () => {
    await setFlag(true);
    const user = await signUp();
    const ids = await Promise.all(Array.from({ length: MAX_OWNED_COMMUNITIES + 1 }, () => community()));
    const results = await Promise.all(ids.map((id) => put(id, user.id)));
    assert.equal(results.filter((r) => r.statusCode === 200).length, MAX_OWNED_COMMUNITIES, results.map((r) => r.statusCode).join(","));
    for (const r of results.filter((x) => x.statusCode !== 200)) assertError(r, 409, "CONFLICT", "owner_limit");
    assert.equal(await db.community.count({ where: { ownerId: user.id } }), MAX_OWNED_COMMUNITIES);

    const shared = await community();
    const [a, b] = [await signUp(), await signUp()];
    const both = await Promise.all([put(shared, a.id), put(shared, b.id)]);
    assert.deepEqual(both.map((r) => r.statusCode), [200, 200]);
    const owner = await ownerOf(shared);
    assert.ok(owner === a.id || owner === b.id);
    assert.ok(await membership(shared, owner!), "sahip üyedir");
    const assigns = await audits(shared, "community.owner.assign", "assign");
    assert.equal(assigns.length, 2);
    // Aynı saatli iki kayıt: sıra yerine zincir tutarlılığı: biri boştan atar, diğeri onun sonucunu devralır, nihai sahip sonuncunun after'ı.
    const first = assigns.find((x) => (x.before as { ownerId: string | null }).ownerId === null)!;
    const second = assigns.find((x) => x !== first)!;
    assert.equal((second.before as { ownerId: string }).ownerId, (first.after as { ownerId: string }).ownerId, "zincir kopmaz");
    assert.equal((second.after as { ownerId: string }).ownerId, owner, "nihai sahip son atamanın sonucudur");
  });

  // ─── Bırakma ve son sahip koruması ──────────────────────────

  test("yönetici bırakma: sahip kalkar (audit), tekrar bırakma değişmez; üyelik korunur", async () => {
    await setFlag(true);
    const id = await community();
    const user = await signUp();
    await put(id, user.id);
    const res = await release(id);
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().data, { owner: null });
    assert.equal(await ownerOf(id), null);
    assert.ok(await membership(id, user.id));
    const [entry, ...rest] = await audits(id, "community.owner.assign", "release");
    assert.equal(rest.length, 0);
    assert.deepEqual([entry!.before, entry!.after, entry!.reason], [{ ownerId: user.id }, { ownerId: null }, "Sahip hesabı bırakmak istedi"]);
    assert.equal((await release(id)).statusCode, 200);
    assert.equal((await audits(id, "community.owner.assign", "release")).length, 1, "sahipsiz topluluğu bırakmak iz üretmez");
  });

  test("sahibin kendi bırakması: yalnız sahip (diğerleri ve sahipsiz topluluk 403); audit ayrı eylemle, gerekçesiz; sonra topluluktan ayrılabilir", async () => {
    await setFlag(true);
    const id = await community();
    const owner = await signUp();
    const other = await signUp();
    await put(id, owner.id);
    assertError(await releaseOwn(id, ""), 401, "UNAUTHENTICATED");
    assertError(await releaseOwn(id, other.cookie), 403, "FORBIDDEN");
    assertError(await releaseOwn(id, admin.cookie), 403, "FORBIDDEN");
    assertError(await releaseOwn(randomUUID(), owner.cookie), 404, "NOT_FOUND");
    assert.equal(await ownerOf(id), owner.id);

    const res = await releaseOwn(id, owner.cookie);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(await ownerOf(id), null);
    const [entry, ...rest] = await audits(id, "community.owner.release");
    assert.equal(rest.length, 0);
    assert.equal(entry!.actorId, owner.id);
    assert.equal(entry!.reason, null);
    assertError(await releaseOwn(id, owner.cookie), 403, "FORBIDDEN");
    assert.equal((await leave(id, owner.cookie)).statusCode, 204);
    assert.equal(await membership(id, owner.id), null);
  });

  test("son sahip koruması: sahip topluluktan ayrılamaz (409 owner_must_release, üyelik ve sayaç aynı); DB tetikleyicileri doğrudan SQL'i de reddeder; üye olmayan kullanıcı sahip yapılamaz", async () => {
    await setFlag(true);
    const id = await community();
    const owner = await signUp();
    const member = await signUp();
    await put(id, owner.id);
    await addMember(id, member.id);
    const count = (await db.community.findUniqueOrThrow({ where: { id } })).memberCount;

    assertError(await leave(id, owner.cookie), 409, "CONFLICT", "owner_must_release");
    assert.ok(await membership(id, owner.id));
    assert.equal((await db.community.findUniqueOrThrow({ where: { id } })).memberCount, count);
    assert.equal((await leave(id, member.cookie)).statusCode, 204, "diğer üyeler ayrılabilir");

    // Geri dönüşsüz yol yok: DB tetikleyicisi sahibin üyeliğinin silinmesini ve üye olmayana sahiplik yazılmasını reddeder.
    await assert.rejects(db.communityMembership.delete({ where: { communityId_userId: { communityId: id, userId: owner.id } } }), /owner cannot leave/);
    const stranger = await signUp();
    await assert.rejects(db.community.update({ where: { id }, data: { ownerId: stranger.id } }), /owner must be a member/);
    assert.equal(await ownerOf(id), owner.id);
  });

  test("yarış: sahip ayrılırken aynı anda atanması: sonuçta sahip her zaman üyedir (ayrılma 409 alır ya da önce ayrılıp atama üyeliği geri ekler)", async () => {
    await setFlag(true);
    for (let i = 0; i < 4; i++) {
      const id = await community();
      const user = await signUp();
      await addMember(id, user.id);
      const [left, assigned] = await Promise.all([leave(id, user.cookie), put(id, user.id)]);
      assert.equal(assigned.statusCode, 200, assigned.body);
      assert.ok([204, 409].includes(left.statusCode), `${left.statusCode} ${left.body}`);
      const owner = await ownerOf(id);
      assert.equal(owner, user.id);
      assert.ok(await membership(id, user.id), "sahip üyedir");
    }
  });

  // ─── #172 başvuru onayı ─────────────────────────────────────

  test("başvuru onayı: bayrak açıkken başvuran sahip olur (iki audit: onay + atama); kapalıyken sahipsiz; 3 sahiplik sınırındaki başvuran sahipsiz kalır ama onay engellenmez", async () => {
    const approve = async (requester: User) => {
      const created = await send("POST", "/communities/requests", { name: "Başvuru topluluğu", slug: slug() }, requester.cookie);
      assert.ok(created.statusCode === 200 || created.statusCode === 201, created.body);
      const decided = await send("PATCH", `/admin/communities/requests/${created.json().data.id}`, { decision: "APPROVE", reason: "Uygun görüldü, onaylandı" }, admin.cookie);
      assert.equal(decided.statusCode, 200, decided.body);
      return decided.json().data.communityId as string;
    };

    await setFlag(true);
    const requester = await signUp();
    const id = await approve(requester);
    assert.equal(await ownerOf(id), requester.id);
    const [assigned] = await audits(id, "community.owner.assign", "assign");
    assert.equal((assigned!.after as any).ownerId, requester.id);
    assert.equal((assigned!.after as any).trigger, "request_approval");
    assert.equal(assigned!.actorId, admin.id);
    assert.equal(assigned!.reason, "Uygun görüldü, onaylandı");
    const approval = (await audits(id, "community.request.review", "approve"))[0]!;
    assert.equal((approval.after as any).ownerAssigned, true);
    assert.ok(await membership(id, requester.id));
    assert.equal(AdminCommunityOverview.parse((await overview(id)).json().data).owner?.id, requester.id);

    await setFlag(false);
    const other = await signUp();
    const plain = await approve(other);
    assert.equal(await ownerOf(plain), null, "bayrak kapalı: V1 davranışı, sahip atanmaz");
    assert.equal((await audits(plain, "community.owner.assign")).length, 0);
    assert.equal("ownerAssigned" in ((await audits(plain, "community.request.review", "approve"))[0]!.after as object), false, "V1 audit biçimi korunur");

    await setFlag(true);
    const heavy = await signUp();
    for (let i = 0; i < MAX_OWNED_COMMUNITIES; i++) assert.equal((await put(await community(), heavy.id)).statusCode, 200);
    const overLimit = await approve(heavy);
    assert.equal(await ownerOf(overLimit), null, "sınırdaki başvuran sahip olamaz; onay yine de geçer");
    assert.ok(await membership(overLimit, heavy.id));
  });

  // ─── BAN ────────────────────────────────────────────────────

  test("BAN: hesabın sahip olduğu topluluklar aynı transaction'da yönetici yönetimine döner (audit auto_release, yaptırım gerekçesi); üyelik ve içerik kalır; SUSPEND ve sahip olmayan hesap etkilemez", async () => {
    await setFlag(true);
    const [a, b] = [await community(), await community()];
    const owner = await signUp();
    await put(a, owner.id);
    await put(b, owner.id);
    const keeper = await signUp();
    const kept = await community();
    await put(kept, keeper.id);

    const suspend = await send("POST", `/admin/users/${owner.id}/sanctions`, { type: "SUSPEND", reason: "Geçici uzaklaştırma", endsAt: new Date(h.clock.now.getTime() + 3600_000).toISOString() }, admin.cookie);
    assert.equal(suspend.statusCode, 201, suspend.body);
    assert.equal(await db.community.count({ where: { ownerId: owner.id } }), 2, "SUSPEND sahipliği düşürmez");

    const ban = await send("POST", `/admin/users/${owner.id}/sanctions`, { type: "BAN", reason: "Tekrarlayan ihlaller nedeniyle yasaklandı" }, admin.cookie);
    assert.equal(ban.statusCode, 201, ban.body);
    assert.equal(await ownerOf(a), null);
    assert.equal(await ownerOf(b), null);
    assert.equal(await ownerOf(kept), keeper.id, "başka sahibin topluluğu etkilenmez");
    assert.ok(await membership(a, owner.id), "üyelik korunur");
    for (const id of [a, b]) {
      const [entry, ...rest] = await audits(id, "community.owner.assign", "auto_release");
      assert.equal(rest.length, 0);
      assert.equal(entry!.actorId, admin.id);
      assert.equal(entry!.reason, "Tekrarlayan ihlaller nedeniyle yasaklandı");
      assert.deepEqual([entry!.before, entry!.after], [{ ownerId: owner.id }, { ownerId: null, trigger: "ban" }]);
    }
    // Sabit saatte iki kayıt aynı zamanı taşır: tipe göre seçilir.
    const sanctionAudits = await db.auditLog.findMany({ where: { action: "user.sanction", operation: "apply", targetId: owner.id } });
    assert.equal((sanctionAudits.find((x) => (x.after as any).type === "BAN")!.after as any).communitiesReleased, 2);
    assert.equal("communitiesReleased" in (sanctionAudits.find((x) => (x.after as any).type === "SUSPEND")!.after as object), false, "SUSPEND audit'i V1 biçiminde");

    const plainUser = await signUp();
    await send("POST", `/admin/users/${plainUser.id}/sanctions`, { type: "BAN", reason: "Spam hesabı yasaklandı" }, admin.cookie);
    const sanction = (await db.auditLog.findMany({ where: { action: "user.sanction", targetId: plainUser.id } }))[0]!;
    assert.equal("communitiesReleased" in (sanction.after as object), false, "sahip olmayan hesapta alan eklenmez (V1 audit biçimi)");
  });

  // ─── V1 izolasyonu ve görünüm ───────────────────────────────

  test("sahiplik ek yetki vermez (I4/I5): sahip yönetici uçlarına, moderatör atamaya, yaptırıma ve başka topluluğa erişemez; sahibin üye listesi görünürlüğü ve katılım akışı V1 ile aynı", async () => {
    await setFlag(true);
    const id = await community();
    const other = await community();
    const owner = await signUp();
    await put(id, owner.id);
    const victim = await signUp();
    assertError(await send("PATCH", `/admin/communities/${id}`, { name: "Yeni ad", reason: "Sahip kendi topluluğunu düzenlemeye çalışıyor" }, owner.cookie), 403, "FORBIDDEN");
    assertError(await send("PUT", `/admin/communities/${id}/moderators/${victim.id}`, { reason: "Sahip moderatör atamaya çalışıyor" }, owner.cookie), 403, "FORBIDDEN");
    assertError(await send("GET", `/admin/communities`, undefined, owner.cookie), 403, "FORBIDDEN");
    assertError(await send("POST", `/admin/users/${victim.id}/sanctions`, { type: "WARNING", reason: "Sahip yaptırım uygulamaya çalışıyor" }, owner.cookie), 403, "FORBIDDEN");
    assertError(await send("PUT", `/admin/communities/${other}/owner`, { userId: owner.id, reason: REASON }, owner.cookie), 403, "FORBIDDEN");
    assertError(await releaseOwn(other, owner.cookie), 403, "FORBIDDEN");
    // Sahip olmayan kullanıcı katılıp ayrılabilir (V1).
    assert.equal((await join(id, victim.cookie)).statusCode, 200);
    assert.equal((await leave(id, victim.cookie)).statusCode, 204);
  });

  test("yönetici görünümü: liste satırında ve genel bakışta sahip (kimlik ve ad; e-posta yok), sahipsizde null", async () => {
    await setFlag(true);
    const withOwner = await community("Sahipli");
    const without = await community("Sahipsiz");
    const owner = await signUp();
    await put(withOwner, owner.id);
    const list = await send("GET", `/admin/communities?q=${encodeURIComponent("Sahip")}&limit=100`, undefined, admin.cookie);
    const rows = (list.json().data as unknown[]).map((r) => AdminCommunityRow.parse(r));
    assert.equal(rows.find((r) => r.id === withOwner)!.owner?.id, owner.id);
    assert.equal(rows.find((r) => r.id === without)!.owner, null);
    const view = (await overview(withOwner)).body;
    assert.equal(view.includes("email"), false);
    assert.equal(AdminCommunityOverview.parse(JSON.parse(view).data).owner?.username, owner.username);
    assert.equal(AdminCommunityOverview.parse((await overview(without)).json().data).owner, null);
  });
});

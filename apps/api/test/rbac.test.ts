/**
 * KV-12 (#14) ortak RBAC katmanı. Rol, yaptırım ve topluluk moderatörlüğü her istekte DB'den okunur;
 * değişiklik açık oturumda bir sonraki istekte etkilidir. Admin/moderasyon handler'ları henüz yok
 * (KV-33, KV-24/32): router'ın yetki kapısı gerçek endpoint id'lerine kaydedilen stub handler'larla
 * (probe) sınanır. Yorum ve oy kısıtı ayrıca gerçek handler'larla PostgreSQL'de uçtan uca koşar.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { actions, ErrorBody, permissionForEndpoint, PollDetail } from "@kararver/contracts";
import type { FastifyInstance } from "fastify";
import type { Route } from "../src/http/route.ts";
import { LEGACY_RESOURCE_CHECKS, needsResource } from "../src/modules/rbac/access.ts";
import {
  createHarness,
  memoryBackend,
  prismaBackend,
  sessionCookie,
  tokenFrom,
  WEB_ORIGIN,
  type BackendFactory,
  type Harness,
} from "./support/harness.ts";
import { createProbe, rbacSeeds, type Probe, type RbacSeeds } from "./support/rbac-probe.ts";

const HOUR = 60 * 60 * 1000;
const backends = [memoryBackend, prismaBackend()].filter((b): b is BackendFactory => b !== null);

type Res = { statusCode: number; json(): any; body: string };

function assertError(res: Res, status: number, code: string) {
  assert.equal(res.statusCode, status, res.body);
  ErrorBody.parse(res.json());
  assert.equal(res.json().error.code, code);
}

function send(app: FastifyInstance, method: "GET" | "POST" | "PUT", url: string, cookie?: string, body?: unknown) {
  return app.inject({
    method,
    url: `/v1${url}`,
    headers: {
      origin: WEB_ORIGIN,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signUp(h: Harness, prefix = "rb") {
  const id = randomUUID().replaceAll("-", "").slice(0, 10);
  const account = { email: `${prefix}_${id}@example.test`, username: `${prefix}_${id}`, displayName: "RBAC", password: "guclu-bir-sifre-1" };
  const mailCount = h.mails.length;
  assert.equal((await send(h.app, "POST", "/auth/register", undefined, account)).statusCode, 202);
  assert.equal((await send(h.app, "POST", "/auth/email/verify", undefined, { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
  const login = await send(h.app, "POST", "/auth/login", undefined, { email: account.email, password: account.password });
  assert.equal(login.statusCode, 200, login.body);
  return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
}

for (const factory of backends) {
  describe(`RBAC (${factory.name})`, () => {
    let h: Harness;
    let seeds: RbacSeeds;
    let probe: FastifyInstance;
    const probes: Probe[] = [];
    const newProbe = async (register: (route: Route) => void, options?: { enforceResourceChecks?: boolean }) => {
      const p = await createProbe(h, register, options);
      probes.push(p);
      return p;
    };
    /** Stub moderasyon handler'ının "DB'den okuduğu" anket → topluluk eşlemesi. */
    const pollCommunity = new Map<string, string | null>();
    let root: { cookie: string; id: string };

    before(async () => {
      h = await createHarness(factory);
      seeds = rbacSeeds(h);
      ({ app: probe } = await newProbe((route) => {
        route("admin.users.list", async () => ({ status: 200, body: { data: [] } }));
        route("admin.reports.list", async ({ moderationScope }) => ({ status: 200, body: { data: await moderationScope() } }));
        route("admin.moderation.polls", async ({ params, authorize }) => {
          const communityId = pollCommunity.get(params.id);
          assert.notEqual(communityId, undefined, "stub: bilinmeyen anket");
          await authorize({ communityId });
          return { status: 200, body: { data: { ok: true } } };
        });
        route("admin.roles.put", async ({ params, body, authorize }) => {
          await authorize({ targetUserId: params.id, targetRoles: [], newRole: body.role, activeSuperAdminCount: 1 });
          return { status: 200, body: { data: { ok: true } } };
        });
        route("comments.create", async () => ({ status: 201, body: { data: { ok: true } } }));
        route("votes.put", async () => ({ status: 200, body: { data: { ok: true } } }));
      }));
      // İlk SUPER_ADMIN (bootstrap satırı, granted_by NULL); diğer rol ve yaptırımları o verir.
      root = await signUp(h, "root");
      await seeds.setRole(root.id, "SUPER_ADMIN", null);
    });
    after(async () => {
      for (const p of probes) await p.app.close();
      await h?.close();
    });

    const usersList = (cookie?: string) => send(probe, "GET", "/admin/users", cookie);
    const moderatePoll = (pollId: string, cookie: string) => send(probe, "POST", `/admin/polls/${pollId}/moderation`, cookie, { action: "HIDE", reason: "kural ihlali" });
    const comment = (cookie: string) => send(probe, "POST", `/polls/${randomUUID()}/comments`, cookie, { body: "yorum" });
    const vote = (cookie: string) => send(probe, "PUT", `/polls/${randomUUID()}/vote`, cookie, { optionId: randomUUID() });
    const sanction = (userId: string, type: "RESTRICT_COMMENTS" | "SUSPEND", endsAt: Date | null = null) =>
      seeds.addSanction(userId, { type, createdById: root.id, startsAt: h.clock.now, endsAt });

    test("normal kullanıcı admin endpoint'ine 403, misafir 401; seviye rol sırasına göre", async () => {
      const user = await signUp(h);
      assertError(await usersList(), 401, "UNAUTHENTICATED");
      assertError(await usersList(user.cookie), 403, "FORBIDDEN");

      const moderator = await signUp(h);
      await seeds.setRole(moderator.id, "MODERATOR", root.id);
      assertError(await usersList(moderator.cookie), 403, "FORBIDDEN");

      const admin = await signUp(h);
      await seeds.setRole(admin.id, "ADMIN", root.id);
      assert.equal((await usersList(admin.cookie)).statusCode, 200);
      assert.equal((await usersList(root.cookie)).statusCode, 200);

      // super_admin seviyesi: ADMIN kapıda 403; SUPER_ADMIN geçer, handler tam kararı verir.
      const rolePut = (cookie: string) => send(probe, "PUT", `/admin/users/${user.id}/role`, cookie, { role: "MODERATOR", reason: "moderatör ataması" });
      assertError(await rolePut(admin.cookie), 403, "FORBIDDEN");
      assert.equal((await rolePut(root.cookie)).statusCode, 200);
    });

    test("topluluk moderatörü sadece atandığı toplulukta işlem yapar; başka toplulukta 403", async () => {
      const modA = await signUp(h);
      const modB = await signUp(h);
      await seeds.setRole(modA.id, "MODERATOR", root.id);
      await seeds.setRole(modB.id, "MODERATOR", root.id);
      const communityA = await seeds.addModeratedCommunity(modA.id, root.id);
      const communityB = await seeds.addModeratedCommunity(modB.id, root.id);
      const pollA = randomUUID();
      const pollB = randomUUID();
      const pollGlobal = randomUUID();
      pollCommunity.set(pollA, communityA).set(pollB, communityB).set(pollGlobal, null);

      assert.equal((await moderatePoll(pollA, modA.cookie)).statusCode, 200);
      assertError(await moderatePoll(pollB, modA.cookie), 403, "FORBIDDEN");
      assertError(await moderatePoll(pollGlobal, modA.cookie), 403, "FORBIDDEN");

      const admin = await signUp(h);
      await seeds.setRole(admin.id, "ADMIN", root.id);
      assert.equal((await moderatePoll(pollB, admin.cookie)).statusCode, 200);
      assert.equal((await moderatePoll(pollGlobal, admin.cookie)).statusCode, 200);

      // Kuyruk: moderatör yalnız kendi toplulukları, admin tümü; atanmamış moderatör 403.
      assert.deepEqual((await send(probe, "GET", "/admin/reports", modA.cookie)).json().data, { all: false, communityIds: [communityA] });
      assert.deepEqual((await send(probe, "GET", "/admin/reports", admin.cookie)).json().data, { all: true });
      const unassigned = await signUp(h);
      await seeds.setRole(unassigned.id, "MODERATOR", root.id);
      assertError(await send(probe, "GET", "/admin/reports", unassigned.cookie), 403, "FORBIDDEN");

      // Global rol alınınca üyelik MODERATOR kalsa da moderasyon kapanır (KV-04 §4.6).
      await seeds.setRole(modA.id, null, root.id);
      assertError(await moderatePoll(pollA, modA.cookie), 403, "FORBIDDEN");
    });

    test("açık oturumda rol verilince ve alınınca bir sonraki istekte etkili", async () => {
      const user = await signUp(h);
      assertError(await usersList(user.cookie), 403, "FORBIDDEN");
      await seeds.setRole(user.id, "ADMIN", root.id);
      assert.equal((await usersList(user.cookie)).statusCode, 200, "aynı cookie, yeni rol");
      await seeds.setRole(user.id, "MODERATOR", root.id);
      assertError(await usersList(user.cookie), 403, "FORBIDDEN");
      await seeds.setRole(user.id, null, root.id);
      assertError(await usersList(user.cookie), 403, "FORBIDDEN");
    });

    test("RESTRICT_COMMENTS: yorum 403 (details işlem kimliği), oy serbest; kaldırılınca yorum açılır", async () => {
      const user = await signUp(h);
      assert.equal((await comment(user.cookie)).statusCode, 201);

      const id = await sanction(user.id, "RESTRICT_COMMENTS");
      const blocked = await comment(user.cookie);
      assertError(blocked, 403, "ACCOUNT_RESTRICTED");
      assert.deepEqual(blocked.json().error.details, [{ code: permissionForEndpoint("comments.create") }]);
      assert.equal((await vote(user.cookie)).statusCode, 200, "oy kısıttan etkilenmez");

      await seeds.liftSanction(id, root.id, h.clock.now);
      assert.equal((await comment(user.cookie)).statusCode, 201, "kaldırılan yaptırım bir sonraki istekte etkisiz");
    });

    test("SUSPEND açık oturumda bir sonraki istekte etkili; yönetici de yetkisini kaybeder", async () => {
      const admin = await signUp(h);
      await seeds.setRole(admin.id, "ADMIN", root.id);
      const id = await sanction(admin.id, "SUSPEND", new Date(h.clock.now.getTime() + 24 * HOUR));

      const blocked = await vote(admin.cookie);
      assertError(blocked, 403, "ACCOUNT_RESTRICTED");
      assert.deepEqual(blocked.json().error.details, [{ code: "vote.cast" }]);
      assertError(await usersList(admin.cookie), 403, "FORBIDDEN");

      await seeds.liftSanction(id, root.id, h.clock.now);
      assert.equal((await vote(admin.cookie)).statusCode, 200);
      assert.equal((await usersList(admin.cookie)).statusCode, 200);
    });

    test("süresi dolmuş yaptırım etkisiz (kaldırılmamış olsa da)", async () => {
      const user = await signUp(h);
      await sanction(user.id, "RESTRICT_COMMENTS", new Date(h.clock.now.getTime() + HOUR));
      assertError(await comment(user.cookie), 403, "ACCOUNT_RESTRICTED");
      h.clock.advance(HOUR);
      assert.equal((await comment(user.cookie)).statusCode, 201, "endsAt = now: süre dolmuş");
    });

    test("kaynak bağlamı gereken handler ctx.authorize'ı unutursa: test/dev'de hata, production'da log", async () => {
      const admin = await signUp(h);
      await seeds.setRole(admin.id, "ADMIN", root.id);
      const register = (route: Route) =>
        route("admin.reports.resolve", async () => ({ status: 200, body: { data: { ok: true } } }));
      const resolve = (app: FastifyInstance) =>
        send(app, "POST", `/admin/reports/${randomUUID()}/resolve`, admin.cookie, { resolution: "DISMISSED", note: "geçersiz rapor" });

      const strict = await newProbe(register);
      assertError(await resolve(strict.app), 500, "INTERNAL_ERROR");
      assert.ok(strict.logs.some((l) => l.includes("ctx.authorize çağırmadan döndü")));

      const production = await newProbe(register, { enforceResourceChecks: false });
      assert.equal((await resolve(production.app)).statusCode, 200);
      const logged = production.logs.find((l) => l.includes("ctx.authorize çağırmadan döndü"));
      assert.ok(logged, "production'da sessiz izin yerine hata logu");
      assert.equal(JSON.parse(logged!).action, "report.resolve");
    });
  });
}

test("eski handler listesi yalnız kaynak bağlamı gereken endpoint'leri içerir", () => {
  for (const id of LEGACY_RESOURCE_CHECKS) {
    assert.ok(needsResource(permissionForEndpoint(id)), `${id} listede gereksiz`);
    assert.ok(!["moderator", "admin", "super_admin"].includes(actions[permissionForEndpoint(id)].level), `${id}: yönetici endpoint'i istisna olamaz`);
  }
});

const pg = prismaBackend();

describe("RBAC gerçek handler'larla (postgres)", { skip: pg ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let seeds: RbacSeeds;
  let categoryId: string;

  before(async () => {
    h = await createHarness(pg!);
    seeds = rbacSeeds(h);
    categoryId = (await h.prisma!.category.create({ data: { slug: `rbac-${randomUUID().slice(0, 8)}`, name: "RBAC" } })).id;
  });
  after(async () => {
    await h?.close();
  });

  test("RESTRICT_COMMENTS: gerçek yorum endpoint'i 403, oy 201; RESTRICT_POSTING anket düzenlemeyi kapatır", async () => {
    const root = await signUp(h, "root");
    await seeds.setRole(root.id, "SUPER_ADMIN", null);
    const owner = await signUp(h);
    const user = await signUp(h);

    const created = await h.app.inject({
      method: "POST",
      url: "/v1/polls",
      headers: { origin: WEB_ORIGIN, "content-type": "application/json", cookie: owner.cookie, "idempotency-key": `rbac-${randomUUID()}` },
      payload: JSON.stringify({
        kind: "POLL",
        title: `Hangisini seçmeliyim acaba? ${randomUUID().slice(0, 8)}`,
        categoryId,
        durationHours: 24,
        resultsVisibility: "AFTER_VOTE",
        options: [{ label: "A" }, { label: "B" }],
      }),
    });
    assert.equal(created.statusCode, 201, created.body);
    const poll = PollDetail.parse(created.json().data);

    await seeds.addSanction(user.id, { type: "RESTRICT_COMMENTS", createdById: root.id, startsAt: h.clock.now });
    const blocked = await send(h.app, "POST", `/polls/${poll.id}/comments`, user.cookie, { body: "Bence A daha iyi." });
    assertError(blocked, 403, "ACCOUNT_RESTRICTED");
    assert.deepEqual(blocked.json().error.details, [{ code: "comment.create" }]);
    const voted = await send(h.app, "PUT", `/polls/${poll.id}/vote`, user.cookie, { optionId: poll.options[0]!.id });
    assert.equal(voted.statusCode, 201, voted.body);

    // Sahibin kendi anketi: RESTRICT_POSTING düzenlemeyi kapatır, silme/kapama açık kalır (KV-04 §1.2/6).
    await seeds.addSanction(owner.id, { type: "RESTRICT_POSTING", createdById: root.id, startsAt: h.clock.now });
    const edit = await send(h.app, "POST", `/polls/${poll.id}/addenda`, owner.cookie, { body: "Ek açıklama metni." });
    assertError(edit, 403, "ACCOUNT_RESTRICTED");
    assert.deepEqual(edit.json().error.details, [{ code: "poll.addendum.create" }]);
    assert.equal((await send(h.app, "POST", `/polls/${poll.id}/comments`, owner.cookie, { body: "Yorum serbest." })).statusCode, 201);
  });
});

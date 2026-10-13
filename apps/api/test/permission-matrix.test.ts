/**
 * #187 — HTTP yetki matrisi. Satırlar contracts registry'sinden üretilir: yeni bir yönetici endpoint'i eklendiğinde
 * matrise kendiliğinden girer. Her istek gerçek uygulamaya (createHarness) gider; probe yoktur.
 *
 * Beklenen sonuç `preauthorize`'dan TÜRETİLMEZ (aksi halde test kapının kendisini tekrar eder): aşağıdaki küçük seviye
 * tablosu KV-04 sözleşmesinin (docs/KV-04_ROLES_EVENTS.md) bağımsız özetidir. Kapı gövde doğrulamasından önce çalıştığı
 * için istekler rastgele id ve boş gövdeyle gönderilir:
 * - reddedilen hücre: birebir 401 UNAUTHENTICATED / 403 FORBIDDEN, yalnız ErrorBody (data yok), private no-store,
 *   ve hiçbir audit/domain event satırı yazılmaz;
 * - izinli hücre: kapıdan geçer (401/403 değil); rastgele id ile handler 400/404/409 döner, 5xx hata sayılır.
 * Sapmalar tek listede toplanır; liste boş değilse test bütün sapmaları birlikte gösterir.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { actions, endpoints, ErrorBody, permissionForEndpoint, type Auth, type EndpointContract } from "@kararver/contracts";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createArgon2Hasher } from "../src/modules/auth/crypto.ts";
import { createPrismaPollStore } from "../src/modules/polls/prisma-store.ts";
import { createPrismaProfileStore } from "../src/modules/profiles/prisma-store.ts";
import { createHarness, PEPPER, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";
import { rbacSeeds, type RbacSeeds } from "./support/rbac-probe.ts";

const backend = prismaBackend();
const DAY = 24 * 60 * 60 * 1000;

type Actor = "guest" | "user" | "modUnassigned" | "modAssigned" | "admin" | "superAdmin" | "suspendedAdmin";
const ACTORS: readonly Actor[] = ["guest", "user", "modUnassigned", "modAssigned", "admin", "superAdmin", "suspendedAdmin"];

type Expected = { status: 401; code: "UNAUTHENTICATED" } | { status: 403; code: "FORBIDDEN" } | "pass";

/** KV-04 seviye sırası; bilinçli olarak contracts'taki rank tablosundan kopyalanmadı. */
const REQUIRED_RANK: Partial<Record<Auth, number>> = { moderator: 1, admin: 2, super_admin: 3 };
const ACTOR_RANK: Record<Exclude<Actor, "guest">, number> = {
  user: 0,
  modUnassigned: 1,
  modAssigned: 1,
  admin: 2,
  superAdmin: 3,
  suspendedAdmin: 2,
};

/**
 * Seviyesi düşürülmemesi gereken SUPER_ADMIN işlemleri. Matris bir seviye düşüşünü kendiliğinden kabul ederdi;
 * bu liste düşüşü test diff'inde görünür kılar. Yeni super_admin endpoint'i buraya eklenmeden de matrise girer.
 */
const PINNED_SUPER_ADMIN = [
  "admin.roles.put",
  "admin.settings.update",
  "admin.emergency.put",
  "admin.ops.status",
  "admin.users.sessions.list",
  "admin.users.sessions.revoke",
  "admin.users.dataExports.create",
  "admin.users.dataExports.list",
  "admin.users.dataExports.deliver",
] as const;

const UNAUTHENTICATED = { status: 401, code: "UNAUTHENTICATED" } as const;
const FORBIDDEN = { status: 403, code: "FORBIDDEN" } as const;

function expected(endpoint: EndpointContract, actor: Actor): Expected {
  if (actor === "guest") return UNAUTHENTICATED;
  const required = REQUIRED_RANK[endpoint.auth];
  if (required === undefined) throw new Error(`${endpoint.id}: personel seviyesi değil`);
  // Yetkili işlem yalnız ACTIVE hesapla yapılır.
  if (actor === "suspendedAdmin") return FORBIDDEN;
  if (ACTOR_RANK[actor] < required) return FORBIDDEN;
  // Kuyruk işlemi: hiçbir topluluğa atanmamış moderatör kapıda reddedilir.
  if (actor === "modUnassigned" && actions[permissionForEndpoint(endpoint.id)].scope === "queue") return FORBIDDEN;
  return "pass";
}

const staffEndpoints = endpoints.filter((e) => REQUIRED_RANK[e.auth] !== undefined);
const signedInEndpoints = endpoints.filter((e) => e.auth !== "public");

type Res = { statusCode: number; headers: Record<string, unknown>; body: string; json(): any };

describe("yetki matrisi (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  /**
   * Harness profil/bookmark store'unu bağlamaz (production server.ts bağlar). Bu route'lar aynı DB ve oturum
   * deposunu kullanan ikinci bir uygulamada sınanır (profiles-bookmarks.test.ts ile aynı kurulum).
   */
  let profiles: FastifyInstance;
  let profilesBackend: Awaited<ReturnType<NonNullable<typeof backend>["create"]>>;
  let seeds: RbacSeeds;
  const cookies = new Map<Actor, string>();
  let superAdminId = "";

  const registered = (app: FastifyInstance, e: EndpointContract) => app.hasRoute({ method: e.method, url: `/v1${e.path}` });
  const appFor = (e: EndpointContract) => (registered(h.app, e) ? h.app : profiles);

  const send = (endpoint: EndpointContract, cookie: string | undefined, extra: { headers?: Record<string, string>; query?: string } = {}) =>
    appFor(endpoint).inject({
      method: endpoint.method,
      url: `/v1${endpoint.path.replace(/:\w+/g, () => randomUUID())}${extra.query ?? ""}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(endpoint.request.body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...extra.headers,
      },
      payload: endpoint.request.body ? "{}" : undefined,
    });

  async function signUp(prefix: string) {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `${prefix}_${id}@example.test`, username: `${prefix}_${id}`, displayName: "Matris", password: "guclu-bir-sifre-1" };
    const post = (url: string, body: unknown) =>
      h.app.inject({ method: "POST", url: `/v1${url}`, headers: { origin: WEB_ORIGIN, "content-type": "application/json" }, payload: JSON.stringify(body) });
    const mailCount = h.mails.length;
    assert.equal((await post("/auth/register", account)).statusCode, 202);
    assert.equal((await post("/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await post("/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  /** Reddedilen cevap yalnız hata zarfıdır: veri, önbelleğe alınabilir cevap veya beklenmeyen kod yoktur. */
  function deniedProblem(res: Res, want: Exclude<Expected, "pass">): string | null {
    if (res.statusCode !== want.status) return `HTTP ${res.statusCode} (beklenen ${want.status}) ${res.body.slice(0, 160)}`;
    let body: unknown;
    try {
      body = res.json();
    } catch {
      return "gövde JSON değil";
    }
    const parsed = ErrorBody.safeParse(body);
    if (!parsed.success) return `ErrorBody dışında alan var: ${res.body.slice(0, 160)}`;
    if (parsed.data.error.code !== want.code) return `kod ${parsed.data.error.code} (beklenen ${want.code})`;
    const cache = String(res.headers["cache-control"] ?? "");
    if (!/private/.test(cache) || !/no-store/.test(cache)) return `Cache-Control "${cache}"`;
    return null;
  }

  before(async () => {
    // Gerçek ayar servisi: /admin/settings ve /admin/emergency route'ları yalnız onunla kaydedilir (production'daki gibi).
    h = await createHarness(backend!, { realSettings: true });
    profilesBackend = await backend!.create();
    profiles = buildApp({
      config: loadConfig({
        APP_ENV: "test",
        LOG_LEVEL: "silent",
        WEB_URL: WEB_ORIGIN,
        API_URL: "http://localhost:4000",
        SESSION_COOKIE_SECURE: "false",
        AUTH_TOKEN_PEPPER: PEPPER,
        MAIL_FROM: "KararVer <no-reply@localhost>",
        MEDIA_PUBLIC_BASE_URL: "http://cdn.test/media",
      }),
      authStore: profilesBackend.store,
      rbacStore: profilesBackend.rbac,
      hasher: createArgon2Hasher(),
      mailer: { send: async () => {} },
      pollStore: createPrismaPollStore(profilesBackend.prisma!),
      profileStore: createPrismaProfileStore(profilesBackend.prisma!),
      logger: false,
    });
    await profiles.ready();
    seeds = rbacSeeds(h);
    const root = await signUp("mx_root");
    await seeds.setRole(root.id, "SUPER_ADMIN", null);
    superAdminId = root.id;
    cookies.set("superAdmin", root.cookie);

    cookies.set("user", (await signUp("mx_user")).cookie);

    const modUnassigned = await signUp("mx_modu");
    await seeds.setRole(modUnassigned.id, "MODERATOR", root.id);
    cookies.set("modUnassigned", modUnassigned.cookie);

    const modAssigned = await signUp("mx_moda");
    await seeds.setRole(modAssigned.id, "MODERATOR", root.id);
    await seeds.addModeratedCommunity(modAssigned.id, root.id);
    cookies.set("modAssigned", modAssigned.cookie);

    const admin = await signUp("mx_admin");
    await seeds.setRole(admin.id, "ADMIN", root.id);
    cookies.set("admin", admin.cookie);

    const suspended = await signUp("mx_susp");
    await seeds.setRole(suspended.id, "ADMIN", root.id);
    // SUSPEND süreli olmak zorunda (sanctions_suspend_ends_check).
    await seeds.addSanction(suspended.id, { type: "SUSPEND", createdById: root.id, startsAt: h.clock.now, endsAt: new Date(h.clock.now.getTime() + DAY) });
    cookies.set("suspendedAdmin", suspended.cookie);
  });
  after(async () => {
    await profiles?.close();
    await profilesBackend?.close();
    await h?.close();
  });

  test("registry'deki her oturumlu endpoint gerçek uygulamada kayıtlı", () => {
    const missing = signedInEndpoints
      .filter((e) => !registered(h.app, e) && !registered(profiles, e))
      .map((e) => `${e.id} ${e.method} ${e.path}`);
    assert.deepEqual(missing, []);
    assert.ok(staffEndpoints.length > 0, "registry'de personel endpoint'i yok");
  });

  test("kritik SUPER_ADMIN işlemlerinin seviyesi düşürülmedi", () => {
    for (const id of PINNED_SUPER_ADMIN) {
      const endpoint = endpoints.find((e) => e.id === id);
      assert.ok(endpoint, `${id} registry'de yok`);
      assert.equal(endpoint.auth, "super_admin", id);
      assert.equal(actions[permissionForEndpoint(id)].level, "super_admin", id);
    }
  });

  test("misafir: oturum isteyen her endpoint 401, veri sızmaz", async () => {
    const problems: string[] = [];
    for (const endpoint of signedInEndpoints) {
      const problem = deniedProblem(await send(endpoint, undefined), UNAUTHENTICATED);
      if (problem) problems.push(`${endpoint.id} × guest: ${problem}`);
    }
    assert.deepEqual(problems, []);
  });

  test("reddedilen rol × personel endpoint'i: birebir 401/403, veri sızmaz, audit ve olay yazılmaz", async () => {
    const before = { audit: await h.prisma!.auditLog.count(), events: await h.prisma!.domainEvent.count() };
    const problems: string[] = [];
    let cells = 0;
    for (const endpoint of staffEndpoints) {
      for (const actor of ACTORS) {
        const want = expected(endpoint, actor);
        if (want === "pass") continue;
        cells++;
        const problem = deniedProblem(await send(endpoint, cookies.get(actor)), want);
        if (problem) problems.push(`${endpoint.id} × ${actor}: ${problem}`);
      }
    }
    assert.deepEqual(problems, []);
    assert.ok(cells > staffEndpoints.length, `yalnız ${cells} reddedilen hücre`);
    assert.deepEqual(
      { audit: await h.prisma!.auditLog.count(), events: await h.prisma!.domainEvent.count() },
      before,
      "reddedilen istek audit veya domain event yazdı",
    );
  });

  test("izinli rol × personel endpoint'i: kapıdan geçer, 5xx yok", async () => {
    const problems: string[] = [];
    for (const endpoint of staffEndpoints) {
      for (const actor of ACTORS) {
        if (expected(endpoint, actor) !== "pass") continue;
        const res = await send(endpoint, cookies.get(actor));
        if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode >= 500) {
          problems.push(`${endpoint.id} × ${actor}: HTTP ${res.statusCode} ${res.body.slice(0, 160)}`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });

  test("istemci rol beyan edemez: gövde, başlık, query ve cookie dışı token yok sayılır", async () => {
    const user = cookies.get("user")!;
    const admin = cookies.get("admin")!;
    const me = endpoints.find((e) => e.id === "me.get")!;
    const meUpdate = await h.app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: { origin: WEB_ORIGIN, "content-type": "application/json", cookie: user },
      payload: JSON.stringify({ displayName: "Matris", roles: ["SUPER_ADMIN"] }),
    });
    assert.equal(meUpdate.statusCode, 400, meUpdate.body);
    assert.equal(meUpdate.json().error.code, "VALIDATION_ERROR");
    assert.deepEqual((await send(me, user)).json().data.roles, ["USER"]);

    const claims = {
      "x-role": "SUPER_ADMIN",
      "x-roles": "SUPER_ADMIN",
      "x-user-id": superAdminId,
      "x-forwarded-user": superAdminId,
      "x-kv-role": "SUPER_ADMIN",
    };
    const query = "?role=SUPER_ADMIN&roles=SUPER_ADMIN&asUser=" + superAdminId;
    const problems: string[] = [];
    for (const endpoint of staffEndpoints) {
      const [cookie, actor] = endpoint.auth === "super_admin" ? [admin, "admin"] : [user, "user"];
      const problem = deniedProblem(await send(endpoint, cookie, { headers: claims, query }), FORBIDDEN);
      if (problem) problems.push(`${endpoint.id} × ${actor}+rol beyanı: ${problem}`);
    }
    assert.deepEqual(problems, []);

    // Oturum yalnız cookie'den: SUPER_ADMIN oturum değeri Authorization başlığında veya sahte cookie'de kimlik vermez.
    const ops = endpoints.find((e) => e.id === "admin.ops.status")!;
    const token = cookies.get("superAdmin")!.split("=")[1]!;
    assert.equal(deniedProblem(await send(ops, undefined, { headers: { authorization: `Bearer ${token}` } }), UNAUTHENTICATED), null);
    assert.equal(deniedProblem(await send(ops, `kv_session=${superAdminId}`), UNAUTHENTICATED), null);
  });
});

/**
 * #185 kritik güvenlik alarmları, dilim 2 (API): alarm onayı (admin.securityAlerts.ack) ve yönetici uçlarında reddedilen
 * isteklerin dakikalık sayacı (admin_access_denials). Alarmları worker açar; burada satırlar doğrudan yazılır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, SecurityAlertView } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";
import { rbacSeeds } from "./support/rbac-probe.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };

describe("güvenlik alarmları API (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let root: User;
  let admin: User;
  let user: User;

  function send(method: "GET" | "POST", url: string, body?: unknown, cookie?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
        ...(method === "POST" ? { "idempotency-key": `sa-${randomUUID()}` } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as Promise<Res>;
  }
  const assertError = (res: Res, status: number, code: string, detail?: string) => {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
    if (detail) assert.equal(res.json().error.details?.[0]?.code, detail);
  };
  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `sa_${id}@example.test`, username: `sa_${id}`, displayName: "Alarm", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id };
  }
  async function alert(): Promise<string> {
    const id = randomUUID();
    const at = h.clock.now;
    await db.securityAlert.create({ data: { id, rule: "role.change.burst", severity: "CRITICAL", scopeKey: admin.id, status: "OPEN", peakCount: 3, openedAt: at, lastSeenAt: at } });
    return id;
  }
  /** Sayaç cevabı beklemez; yazılana kadar kısa süre bekler. */
  async function denials(where: { endpoint: string; status: number; actorKey: string }): Promise<number> {
    const bucket = new Date(Math.floor(h.clock.now.getTime() / 60_000) * 60_000);
    for (let i = 0; i < 50; i++) {
      const row = await db.adminAccessDenial.findUnique({ where: { bucket_endpoint_status_actorKey: { bucket, ...where } } });
      if (row) return row.count;
      await new Promise((r) => setTimeout(r, 20));
    }
    return 0;
  }

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    root = await signUp();
    admin = await signUp();
    user = await signUp();
    const seeds = rbacSeeds(h);
    await seeds.setRole(root.id, "SUPER_ADMIN", null);
    await seeds.setRole(admin.id, "ADMIN", root.id);
  });
  after(async () => {
    await h?.close();
  });

  test("yalnız SUPER_ADMIN onaylar: misafir 401, kullanıcı ve ADMIN 403; audit yazılmaz", async () => {
    const id = await alert();
    const body = { reason: "Planlı rol bakımı" };
    assertError(await send("POST", `/admin/security-alerts/${id}/ack`, body), 401, "UNAUTHENTICATED");
    assertError(await send("POST", `/admin/security-alerts/${id}/ack`, body, user.cookie), 403, "FORBIDDEN");
    assertError(await send("POST", `/admin/security-alerts/${id}/ack`, body, admin.cookie), 403, "FORBIDDEN");
    assert.equal(await db.auditLog.count({ where: { action: "security.alert.ack", targetId: id } }), 0);
    assert.equal((await db.securityAlert.findUniqueOrThrow({ where: { id } })).acknowledgedAt, null);
  });

  test("onay: kim/ne zaman yazılır, alarm açık kalır, audit gerekçeli; ikinci onay 409 ve audit yazmaz; bilinmeyen 404", async () => {
    const id = await alert();
    const res = await send("POST", `/admin/security-alerts/${id}/ack`, { reason: "Planlı rol bakımı" }, root.cookie);
    assert.equal(res.statusCode, 200, res.body);
    const view = SecurityAlertView.parse(res.json().data);
    assert.deepEqual([view.id, view.status, view.acknowledgedBy?.id, view.actor?.id, view.acknowledgedAt], [id, "OPEN", root.id, admin.id, h.clock.now.toISOString()]);
    const [entry] = await db.auditLog.findMany({ where: { action: "security.alert.ack", targetId: id } });
    assert.deepEqual(
      [entry?.actorId, entry?.operation, entry?.targetType, entry?.reason, entry?.after],
      [root.id, "ack", "SECURITY_ALERT", "Planlı rol bakımı", { acknowledged: true, rule: "role.change.burst", status: "OPEN" }],
    );
    assertError(await send("POST", `/admin/security-alerts/${id}/ack`, { reason: "Tekrar" }, root.cookie), 409, "CONFLICT", "already_acknowledged");
    assert.equal(await db.auditLog.count({ where: { action: "security.alert.ack", targetId: id } }), 1);
    assertError(await send("POST", `/admin/security-alerts/${randomUUID()}/ack`, { reason: "Yok" }, root.cookie), 404, "NOT_FOUND");
    assertError(await send("POST", `/admin/security-alerts/${id}/ack`, { reason: "x" }, root.cookie), 400, "VALIDATION_ERROR");
  });

  test("reddedilen yönetici istekleri dakikalık sayaca yazılır: 403 hesapla, 401 '*'; izinli istek ve yönetici dışı uç sayılmaz", async () => {
    const before403 = await denials({ endpoint: "admin.ops.status", status: 403, actorKey: user.id });
    assertError(await send("GET", "/admin/ops", undefined, user.cookie), 403, "FORBIDDEN");
    assertError(await send("GET", "/admin/ops", undefined, user.cookie), 403, "FORBIDDEN");
    assert.equal(await denials({ endpoint: "admin.ops.status", status: 403, actorKey: user.id }), before403 + 2);

    const before401 = await denials({ endpoint: "admin.ops.status", status: 401, actorKey: "*" });
    assertError(await send("GET", "/admin/ops"), 401, "UNAUTHENTICATED");
    assert.equal(await denials({ endpoint: "admin.ops.status", status: 401, actorKey: "*" }), before401 + 1);

    // İzinli istek ve admin dışı uçtaki ret sayılmaz.
    assert.equal((await send("GET", "/admin/ops", undefined, root.cookie)).statusCode, 200);
    assert.equal(await denials({ endpoint: "admin.ops.status", status: 403, actorKey: root.id }), 0);
    assertError(await send("GET", "/me"), 401, "UNAUTHENTICATED");
    assert.equal(await db.adminAccessDenial.count({ where: { endpoint: { not: { startsWith: "admin." } } } }), 0);
  });
});

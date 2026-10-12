import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";
import { createPrismaAdminUserStore } from "../src/modules/admin-users/prisma-store.ts";

const backend = prismaBackend();
describe("admin session security (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok" }, () => {
  let h: Harness;
  before(async () => { h = await createHarness(backend!); });
  after(async () => { await h?.close(); });
  const send = (method: "GET" | "POST", path: string, cookie?: string, payload?: unknown) => h.app.inject({
    method, url: `/v1${path}`,
    headers: { origin: WEB_ORIGIN, ...(cookie ? { cookie } : {}), ...(payload === undefined ? {} : { "content-type": "application/json" }) },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
  async function account(role?: "SUPER_ADMIN" | "ADMIN" | "MODERATOR", grantedById?: string) {
    const name = `ses_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const data = { email: `${name}@example.test`, username: name, displayName: "Session test", password: "guclu-bir-sifre-1" };
    const mailIndex = h.mails.length;
    assert.equal((await send("POST", "/auth/register", undefined, data)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", undefined, { token: tokenFrom(h.mails[mailIndex]) })).statusCode, 200);
    const login = async () => {
      const res = await send("POST", "/auth/login", undefined, { email: data.email, password: data.password });
      assert.equal(res.statusCode, 200, res.body);
      return { id: res.json().data.id as string, cookie: sessionCookie(res.headers["set-cookie"] as string) };
    };
    const user = await login();
    if (role) await h.prisma!.userRole.create({ data: { userId: user.id, role, grantedById } });
    return { ...user, login };
  }

  test("super admin only; scoped cursors; revoke persists, audits and invalidates old cookies", async () => {
    const root = await account("SUPER_ADMIN");
    const user = await account();
    const second = await user.login();
    const other = await account();
    const path = `/admin/users/${user.id}/sessions`;
    await h.prisma!.session.create({ data: { userId: user.id, tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"), createdAt: new Date(h.clock.now.getTime() - 60_000), expiresAt: h.clock.now } });
    await h.prisma!.session.create({ data: { userId: user.id, tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"), createdAt: h.clock.now, expiresAt: new Date(h.clock.now.getTime() + 60_000), revokedAt: h.clock.now } });
    assert.equal((await send("GET", path)).statusCode, 401);
    assert.equal((await send("GET", "/admin/metrics")).statusCode, 401);
    assert.equal((await send("GET", "/admin/metrics?range=7d", root.cookie)).statusCode, 200);
    assert.equal((await send("GET", "/admin/metrics?range=invalid", root.cookie)).statusCode, 400);
    assert.equal((await send("POST", `/admin/users/${root.id}/sessions/revoke`, root.cookie, { reason: "Self session without step-up" })).statusCode, 403);
    for (const role of [undefined, "MODERATOR", "ADMIN"] as const) {
      const denied = role ? await account(role, root.id) : user;
      assert.equal((await send("GET", path, denied.cookie)).statusCode, 403);
      assert.equal((await send("GET", "/admin/metrics", denied.cookie)).statusCode, role === "ADMIN" ? 200 : 403);
      assert.equal((await send("POST", `${path}/revoke`, denied.cookie, { reason: "Security test" })).statusCode, 403);
    }
    const first = await send("GET", `${path}?limit=1`, root.cookie);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().page.hasMore, true);
    const cursor = encodeURIComponent(first.json().page.nextCursor);
    assert.equal((await send("GET", `/admin/users/${other.id}/sessions?cursor=${cursor}`, root.cookie)).statusCode, 400);
    const next = await send("GET", `${path}?limit=1&cursor=${cursor}`, root.cookie);
    assert.equal(next.statusCode, 200, next.body);
    assert.notEqual(next.json().data[0].id, first.json().data[0].id);

    const otherSession = await h.prisma!.session.findFirstOrThrow({ where: { userId: other.id } });
    const wrongTarget = await send("POST", `${path}/revoke`, root.cookie, { sessionId: otherSession.id, reason: "Scope verification" });
    assert.equal(wrongTarget.statusCode, 200, wrongTarget.body);
    assert.equal(wrongTarget.json().data.revokedCount, 0);
    assert.equal((await h.prisma!.session.findUniqueOrThrow({ where: { id: otherSession.id } })).revokedAt, null);

    const revoked = await send("POST", `${path}/revoke`, root.cookie, { reason: "Lost device investigation" });
    assert.equal(revoked.statusCode, 200, revoked.body);
    assert.equal(revoked.json().data.revokedCount, 2);
    assert.deepEqual((await send("GET", path, root.cookie)).json().data, []);
    const replays = await Promise.all([user.cookie, second.cookie].map(cookie => send("GET", "/me", cookie)));
    assert.deepEqual(replays.map(r => r.statusCode), [401, 401]);
    const audits = await h.prisma!.auditLog.findMany({ where: { targetId: user.id, action: "user.sessions.manage" } });
    assert.equal(audits.length, 2);
    assert.ok(audits.some(a => a.actorId === root.id && a.reason === "Lost device investigation" && (a.after as { revokedCount: number }).revokedCount === 2));
    await h.prisma!.userRole.delete({ where: { userId: root.id } });
    await assert.rejects(createPrismaAdminUserStore(h.prisma!).revokeSessions({ actorId: root.id, userId: user.id, reason: "Stale role at transaction", requestId: randomUUID(), now: h.clock.now }), { code: "FORBIDDEN" });
    assert.equal((await send("POST", `${path}/revoke`, root.cookie, { reason: "Stale admin role" })).statusCode, 403);
  });
});

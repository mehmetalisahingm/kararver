import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAdminUserRoutes } from "../src/modules/admin-users/routes.ts";
import { sessionNetwork, sessionDevice } from "../src/modules/admin-users/session-view.ts";

function setup(store: any) {
  const handlers = new Map<string, any>();
  registerAdminUserRoutes(((id: string, handler: any) => handlers.set(id, handler)) as any, { store, now: () => new Date("2026-10-09T10:00:00Z"), mediaPublicBaseUrl: "https://media.test", mailer: { send: async () => {} }, tokenPepper: "pepper", webUrl: "https://web.test" });
  return handlers;
}
test("session list excludes token material and serializes timestamps", async () => {
  const handlers = setup({ target: async () => ({ id: "u" }), listSessions: async () => [{ id: "s", createdAt: new Date("2026-10-09T09:00:00Z"), expiresAt: new Date("2026-10-10T09:00:00Z"), lastSeenAt: null, ipAddress: "192.0.2.123", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/135.0 Safari/537.36 private-device-id", tokenHash: "must-not-escape", passwordHash: "must-not-escape" }] });
  const response = await handlers.get("admin.users.sessions.list")({ params: { id: "u" }, query: { limit: 20 } });
  assert.equal(response.body.data[0].createdAt, "2026-10-09T09:00:00.000Z");
  assert.equal(response.body.data[0].tokenHash, undefined);
  assert.equal(response.body.data[0].passwordHash, undefined);
  assert.equal(response.body.data[0].ipAddress, "192.0.2.0/24");
  assert.equal(response.body.data[0].userAgent, "Chrome · Windows");
  assert.equal(response.body.data[0].status, "ACTIVE");
  assert.equal(response.body.data[0].revokedAt, null);
  assert.equal(response.body.page.hasMore, false);
});

test("session networks hide IPv4 and compressed IPv6 host identifiers", () => {
  for (const [input, expected] of [
    ["203.0.113.29", "203.0.113.0/24"], ["::ffff:192.0.2.2", "192.0.2.0/24"],
    ["2001:db8:abcd:1234::5678", "2001:db8:abcd::/48"], ["2001:db8::1", "2001:db8:0::/48"],
    ["::1", "0:0:0::/48"], ["fe80::123%eth0", "fe80:0:0::/48"],
    ["proxy-user-device", null], [null, null], ["", null],
  ]) assert.equal(sessionNetwork(input), expected);
});

test("device labels only expose known browser/OS categories", () => {
  assert.equal(sessionDevice("Mozilla iPhone CriOS/123 Safari/1"), "Chrome · iOS");
  assert.equal(sessionDevice("Windows Chrome/123 Edg/123"), "Edge · Windows");
  assert.equal(sessionDevice("Linux Android Firefox/123"), "Firefox · Android");
  assert.equal(sessionDevice("private id; email=test@example.test"), "Diğer tarayıcı · Diğer cihaz");
  assert.equal(sessionDevice("  "), null);
});
test("revoke carries actor, reason, target and optional session to store", async () => {
  let input: any;
  const handlers = setup({ revokeSessions: async (value: any) => { input = value; return 2; } });
  const response = await handlers.get("admin.users.sessions.revoke")({ params: { id: "u" }, body: { reason: "Security review" }, viewer: { id: "admin" }, request: { id: "request" } });
  assert.equal(input.actorId, "admin");
  assert.equal(input.userId, "u");
  assert.equal(input.reason, "Security review");
  assert.equal(input.sessionId, undefined);
  assert.equal(response.body.data.revokedCount, 2);
});
test("missing target returns NOT_FOUND", async () => {
  const handlers = setup({ revokeSessions: async () => null });
  await assert.rejects(handlers.get("admin.users.sessions.revoke")({ params: { id: "missing" }, body: { reason: "Security review" }, viewer: { id: "admin" }, request: { id: "request" } }), { code: "NOT_FOUND" });
});

test("status filters are passed to store, state is server-computed and cursor bound to status", async () => {
  const at = new Date("2026-10-09T10:00:00Z");
  const calls: string[] = [];
  const base = { createdAt: new Date("2026-10-09T08:00:00Z"), expiresAt: new Date("2026-10-10T09:00:00Z"), revokedAt: null, lastSeenAt: null, ipAddress: "203.0.113.19", userAgent: "Private-device-id" };
  const handlers = setup({
    target: async () => ({ id: "u" }),
    listSessions: async (_id: string, _cursor: string | null, _limit: number, _now: Date, status: string) => {
      calls.push(status);
      const row = status === "revoked" ? { ...base, id: "a", revokedAt: at } :
        status === "expired" ? { ...base, id: "b", expiresAt: at } : { ...base, id: "c" };
      return [row, { ...row, id: "d" }];
    },
  });
  const list = handlers.get("admin.users.sessions.list");
  const revoked = await list({ params: { id: "u" }, query: { status: "revoked", limit: 1 } });
  assert.equal(revoked.body.data[0].status, "REVOKED");
  assert.equal(revoked.body.data[0].revokedAt, at.toISOString());
  assert.equal(revoked.body.data[0].ipAddress, "203.0.113.0/24");
  assert.equal(revoked.body.page.hasMore, true);
  await assert.rejects(list({ params: { id: "u" }, query: { status: "active", limit: 1, cursor: revoked.body.page.nextCursor } }), { code: "INVALID_CURSOR" });
  assert.equal((await list({ params: { id: "u" }, query: { status: "expired", limit: 1 } })).body.data[0].status, "EXPIRED");
  assert.equal((await list({ params: { id: "u" }, query: { status: "active", limit: 1 } })).body.data[0].status, "ACTIVE");
  assert.deepEqual(calls, ["revoked", "expired", "active"]);
});

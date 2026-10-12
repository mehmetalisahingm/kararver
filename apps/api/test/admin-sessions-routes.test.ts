import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAdminUserRoutes } from "../src/modules/admin-users/routes.ts";
import { sessionNetwork, sessionDevice } from "../src/modules/admin-users/session-view.ts";

function setup(store: any) {
  const handlers = new Map<string, any>();
  registerAdminUserRoutes(((id: string, handler: any) => handlers.set(id, handler)) as any, { store, now: () => new Date("2026-10-09T10:00:00Z"), mediaPublicBaseUrl: "https://media.test" });
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

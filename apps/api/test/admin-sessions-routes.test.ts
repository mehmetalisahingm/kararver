import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAdminUserRoutes } from "../src/modules/admin-users/routes.ts";

function setup(store: any) {
  const handlers = new Map<string, any>();
  registerAdminUserRoutes(((id: string, handler: any) => handlers.set(id, handler)) as any, { store, now: () => new Date("2026-10-09T10:00:00Z"), mediaPublicBaseUrl: "https://media.test" });
  return handlers;
}
test("session list excludes token material and serializes timestamps", async () => {
  const handlers = setup({ target: async () => ({ id: "u" }), listSessions: async () => [{ id: "s", createdAt: new Date("2026-10-09T09:00:00Z"), expiresAt: new Date("2026-10-10T09:00:00Z"), lastSeenAt: null, ipAddress: null, userAgent: "Browser" }] });
  const response = await handlers.get("admin.users.sessions.list")({ params: { id: "u" }, query: { limit: 20 } });
  assert.equal(response.body.data[0].createdAt, "2026-10-09T09:00:00.000Z");
  assert.equal(response.body.data[0].tokenHash, undefined);
  assert.equal(response.body.page.hasMore, false);
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

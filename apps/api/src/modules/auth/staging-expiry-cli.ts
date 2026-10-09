// Operator-only #48 acceptance. No HTTP test endpoint, no global TTL change.
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { createPrismaClient } from "@kararver/db";
import { ErrorBody, Me, dataOf } from "@kararver/contracts";
import { hashToken, newToken } from "./crypto.ts";

const origin = "https://kararver-staging.vercel.app";
const { values } = parseArgs({ options: { username: { type: "string" }, apply: { type: "boolean", default: false } } });
// Explicit environment checks before connecting. Never load a local .env automatically.
assert.equal(process.env.APP_ENV, "staging", "APP_ENV must be staging");
assert.equal(process.env.WEB_URL?.replace(/\/$/, ""), origin, "Unexpected WEB_URL");
assert.match(values.username ?? "", /^umit_staging_48$/, "Only the agreed #48 test account is allowed");
assert.ok(process.env.DATABASE_URL, "DATABASE_URL required from staging environment");
assert.ok((process.env.AUTH_TOKEN_PEPPER?.length ?? 0) >= 32, "Staging pepper required");
const name = process.env.SESSION_COOKIE_NAME ?? "kv_session";
assert.match(name, /^[A-Za-z0-9_-]+$/);
const db = createPrismaClient();
let sessionId: string | undefined;
try {
  const user = await db.user.findUnique({ where: { usernameNormalized: values.username! }, select: { id: true, status: true, deletedAt: true, role: { select: { role: true } } } });
  assert.ok(user && !user.deletedAt && user.status === "ACTIVE", "Active existing test user required");
  assert.ok(!user.role || user.role.role === "USER", "Elevated test accounts are refused");
  console.log(JSON.stringify({ event: "expiry.plan", origin, ttlSeconds: 20, apply: values.apply }));
  if (values.apply) {
    // Create ONLY an isolated session; account creation/login have separate acceptance evidence.
    const token = newToken();
    const cookie = `${name}=${token}`;
    const [{ at }] = await db.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS at`;
    const expiresAt = new Date(at.getTime() + 20_000);
    const row = await db.session.create({ data: { userId: user.id, tokenHash: hashToken(token, process.env.AUTH_TOKEN_PEPPER!), expiresAt, lastSeenAt: at, userAgent: "KV-48 isolated expiry acceptance" }, select: { id: true } });
    sessionId = row.id;
    const inspect = async () => {
      const [state] = await db.$queryRaw<{ expired: boolean; revoked: boolean; expiresAt: Date; at: Date }[]>`SELECT expires_at <= clock_timestamp() AS expired, revoked_at IS NOT NULL AS revoked, expires_at AS "expiresAt", clock_timestamp() AS at FROM sessions WHERE id = ${row.id}::uuid`;
      assert.ok(state, "Test session disappeared");
      return state;
    };
    const request = async (phase: string) => {
      const response = await fetch(`${origin}/api/v1/me`, { headers: { Cookie: cookie, Origin: origin }, redirect: "manual", signal: AbortSignal.timeout(10_000) });
      const body = await response.json();
      const me = dataOf(Me).safeParse(body);
      const error = ErrorBody.safeParse(body);
      console.log(JSON.stringify({ event: phase, status: response.status, requestId: response.headers.get("x-request-id"), cacheControl: response.headers.get("cache-control"), cookieCleared: response.headers.getSetCookie().some(c => c.startsWith(`${name}=`) && /Max-Age=0(?:;|$)/.test(c)) }));
      return { response, userId: me.success ? me.data.data.id : null, errorCode: error.success ? error.data.error.code : null };
    };
    const before = await request("expiry.before");
    assert.equal(before.response.status, 200);
    assert.equal(before.userId, user.id, "Proxy must resolve the intended test account");
    const initial = await inspect();
    assert.equal(initial.expired, false);
    assert.equal(initial.revoked, false);
    console.log(JSON.stringify({ event: "expiry.db.before", sessionId, ...initial }));
    // Clock is NOT modified. Wait for the actual DB expiry, with a bounded clock check.
    for (let i = 0; i < 30 && !(await inspect()).expired; i++) await sleep(1000);
    const expired = await inspect();
    assert.equal(expired.expired, true);
    assert.equal(expired.revoked, false, "Must expire naturally, not via logout/revocation");
    console.log(JSON.stringify({ event: "expiry.db.after", sessionId, ...expired }));
    const after = await request("expiry.after.same-cookie");
    assert.equal(after.response.status, 401);
    assert.equal(after.errorCode, "UNAUTHENTICATED");
    assert.ok(after.response.headers.getSetCookie().some(c => c.startsWith(`${name}=`) && /Max-Age=0(?:;|$)/.test(c)));
    console.log(JSON.stringify({ event: "expiry.acceptance", result: "PASS" }));
  }
} catch {
  // Do not dump fetch/Prisma errors: connection strings or response data may contain secrets.
  console.error("Expiry acceptance FAILED; inspect the last sanitized phase. No acceptance claimed.");
  process.exitCode = 1;
} finally {
  try {
    // Preserve the expired row as evidence; revoke only this generated session on all exits.
    if (sessionId) await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  } catch {
    console.error("Test-session cleanup failed; operator must check the reported sessionId.");
    process.exitCode = 1;
  } finally { await db.$disconnect(); }
}

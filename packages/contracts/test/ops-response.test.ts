import assert from "node:assert/strict";
import { test } from "node:test";
import { examples } from "../fixtures/examples.ts";
import { getEndpoint, OpsStatus } from "../src/index.ts";

function response() {
  const fixture = examples.find((item) => item.endpoint === "admin.ops.status" && item.status === 200);
  assert.ok(fixture);
  return structuredClone(fixture.body) as { data: { security: Record<string, unknown> } };
}

test("older ops responses retain existing measurements and mark new signals unavailable", () => {
  const body = response();
  const byRule = structuredClone(body.data.security.byRule);
  delete body.data.security.lockedLogins;
  delete body.data.security.adminActions24h;
  assert.ok(getEndpoint("admin.ops.status").responses[200]!.safeParse(body).success);
  const parsed = OpsStatus.parse(body.data);
  assert.deepEqual(parsed.security.byRule, byRule);
  assert.equal(parsed.security.lockedLogins, null);
  assert.equal(parsed.security.adminActions24h, null);
});

test("current ops responses preserve supplied security signals", () => {
  const body = response();
  const parsed = OpsStatus.parse(body.data);
  assert.deepEqual(parsed.security.lockedLogins, body.data.security.lockedLogins);
  assert.deepEqual(parsed.security.adminActions24h, body.data.security.adminActions24h);
});

test("compatibility does not accept invalid measurements or unexpected personal fields", () => {
  const body = response();
  body.data.security.lockedLogins = { emails: -1, ips: 0 };
  assert.equal(OpsStatus.safeParse(body.data).success, false);
  body.data.security.lockedLogins = { emails: 1, ips: 0, email: "private@example.test" };
  assert.equal(OpsStatus.safeParse(body.data).success, false);
});

// SA #180 — real PostgreSQL MFA enrollment, replay and session-bound step-up.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";
import { decodeBase32, hotp } from "../src/modules/security/totp.ts";
import { createMfaEnrollment, recoverTotpSecret } from "../src/modules/security/encryption.ts";

const backend = prismaBackend();
const suite = backend ? describe : describe.skip;

suite("SA #180 MFA PostgreSQL enrollment, replay and step-up", () => {
  let h: Harness, cookie: string;
  let userId: string, recoveryCodes: string[];
  const password = "ornek-guclu-parola-1234";

  async function request(method: "GET" | "POST", path: string, body?: unknown, session?: string) {
    return h.app.inject({
      method,
      url: "/v1" + path,
      headers: {
        origin: WEB_ORIGIN,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(session ? { cookie: session } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const codeFor = (secret: string) => hotp(decodeBase32(secret), Math.floor(h.clock.now.getTime() / 30000));

  before(async () => {
    h = await createHarness(backend!);
    const id = randomUUID().replaceAll("-", "").slice(0, 12);
    const email = "mfa_" + id + "@example.test";
    const account = { email, username: "mfa_" + id, displayName: "MFA Test", password };
    assert.equal((await request("POST", "/auth/register", account)).statusCode, 202);
    const verification = tokenFrom(h.mails.at(-1)!);
    assert.equal((await request("POST", "/auth/email/verify", { token: verification })).statusCode, 200);
    const login = await request("POST", "/auth/login", { email, password });
    assert.equal(login.statusCode, 200, login.body);
    userId = login.json().data.id;
    cookie = sessionCookie(login.headers["set-cookie"] as string);
  });
  after(async () => { await h?.close(); });

  test("MFA requires session, correct password and a confirmed OTP", async () => {
    assert.equal((await request("GET", "/me/mfa")).statusCode, 401);
    const initial = await request("GET", "/me/mfa", undefined, cookie);
    assert.equal(initial.statusCode, 200, initial.body);
    assert.deepEqual(initial.json().data, { enabled: false, stepUpExpiresAt: null });

    assert.equal((await request("POST", "/me/mfa/setup", { password: "wrong-password-1234" }, cookie)).statusCode, 403);
    const start = await request("POST", "/me/mfa/setup", { password }, cookie);
    assert.equal(start.statusCode, 200, start.body);
    const { secret, uri } = start.json().data;
    assert.equal(decodeBase32(secret).length, 20);
    assert.ok(uri.startsWith("otpauth://totp/"));
    assert.equal((await request("POST", "/me/mfa/confirm", { code: "not-a-code" }, cookie)).statusCode, 400);
    const valid = codeFor(secret);
    const confirmed = await request("POST", "/me/mfa/confirm", { code: valid }, cookie);
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(confirmed.json().data.enabled, true);
    recoveryCodes = confirmed.json().data.recoveryCodes;
    assert.equal(recoveryCodes.length, 10);
    assert.equal(new Set(recoveryCodes).size, 10);
    const persisted = await h.prisma!.mfaRecoveryCode.findMany({ where: { userId } });
    assert.equal(persisted.length, 10);
    assert.equal(JSON.stringify(persisted).includes(recoveryCodes[0]!), false);
    const audit = await h.prisma!.auditLog.findMany({ where: { actorId: userId, action: "account.mfa" } });
    assert.ok(audit.some(entry => entry.operation === "enable"));
    assert.equal(JSON.stringify(audit).includes(secret), false);
    assert.equal(JSON.stringify(audit).includes(recoveryCodes[0]!), false);

    // The OTP which enabled MFA cannot also grant step-up (same time window).
    assert.equal((await request("POST", "/me/mfa/step-up", { code: valid }, cookie)).statusCode, 403);
    h.clock.advance(30000);
    const firstStepUp = await request("POST", "/me/mfa/step-up", { code: codeFor(secret) }, cookie);
    assert.equal(firstStepUp.statusCode, 200, firstStepUp.body);
    assert.ok(new Date(firstStepUp.json().data.stepUpExpiresAt).getTime() > h.clock.now.getTime());
    const status = await request("GET", "/me/mfa", undefined, cookie);
    assert.equal(status.json().data.enabled, true);
    assert.ok(status.json().data.stepUpExpiresAt);

    h.clock.advance(30000);
    const concurrent = await Promise.all([
      request("POST", "/me/mfa/step-up", { code: codeFor(secret) }, cookie),
      request("POST", "/me/mfa/step-up", { code: codeFor(secret) }, cookie),
    ]);
    assert.deepEqual(concurrent.map(x => x.statusCode).sort(), [200, 403]);

    h.clock.advance(301000);
    assert.equal((await request("GET", "/me/mfa", undefined, cookie)).json().data.stepUpExpiresAt, null);
  });

  test("recovery requires password, is one-use under concurrency, shares lockout and never exposes stored codes", async () => {
    const input = { password, code: recoveryCodes[0]! };
    assert.equal((await request("POST", "/me/mfa/recover", { ...input, password: "wrong-password-1234" }, cookie)).statusCode, 403);
    const concurrent = await Promise.all([
      request("POST", "/me/mfa/recover", input, cookie),
      request("POST", "/me/mfa/recover", input, cookie),
    ]);
    assert.deepEqual(concurrent.map(r => r.statusCode).sort(), [200, 403]);
    assert.equal((await request("POST", "/me/mfa/recover", input, cookie)).statusCode, 403);
    // Two failures above plus three invalid codes trigger the account-bound lock.
    for (let i = 0; i < 3; i++)
      assert.equal((await request("POST", "/me/mfa/recover", { password, code: "0".repeat(32) }, cookie)).statusCode, 403);
    assert.equal((await request("POST", "/me/mfa/recover", { password, code: recoveryCodes[1]! }, cookie)).statusCode, 403);
    h.clock.advance(15 * 60_000 + 1);
    assert.equal((await request("POST", "/me/mfa/recover", { password, code: recoveryCodes[1]! }, cookie)).statusCode, 200);
    const state = (await request("GET", "/me/mfa", undefined, cookie)).json().data;
    assert.ok(state.stepUpExpiresAt);
    assert.equal("recoveryCodes" in state, false);
    const audit = await h.prisma!.auditLog.findMany({ where: { actorId: userId, action: "account.mfa" } });
    assert.ok(audit.some(entry => entry.operation === "recover"));
    assert.ok(audit.some(entry => entry.operation === "lock"));
    assert.equal(recoveryCodes.some(code => JSON.stringify(audit).includes(code)), false);
    await h.prisma!.session.updateMany({ where: { userId }, data: { revokedAt: h.clock.now } });
    assert.equal((await request("POST", "/me/mfa/recover", { password, code: recoveryCodes[2]! }, cookie)).statusCode, 401);
  });

  test("encrypted keys are account-bound and never contain plaintext", () => {
    const enrollment = createMfaEnrollment("owner@example.test", randomUUID(), "x".repeat(64));
    assert.equal(enrollment.ciphertext.includes(Buffer.from(enrollment.secret)), false);
    const id = randomUUID();
    assert.throws(() => recoverTotpSecret(enrollment.ciphertext, id, "x".repeat(64)));
  });
});

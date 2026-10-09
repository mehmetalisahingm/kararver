import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuthenticator } from "../src/modules/auth/session.ts";
import type { AuthStore, UserRecord } from "../src/modules/auth/store.ts";

test("verification bypass is opt-in and leaves the stored verification date unchanged", async () => {
  const user = { id: "user", status: "ACTIVE", emailVerifiedAt: null, deletedAt: null } as UserRecord;
  const store = {
    findSession: async () => ({ id: "session", userId: "user", revokedAt: null, expiresAt: new Date("2030-01-01"), lastSeenAt: new Date("2026-01-01") }),
    findUserById: async () => user,
    touchSession: async () => {},
  } as unknown as AuthStore;
  for (const required of [undefined, true, false]) {
    const auth = createAuthenticator(store, { cookieName: "session", cookieDomain: null, secure: true, ttlMs: 1000, pepper: "test-pepper", emailVerificationRequired: required }, () => new Date("2026-01-01"));
    const result = await auth.resolve({ headers: { cookie: "session=test-token" } } as any, { header() {} } as any);
    assert.equal(result?.emailVerified, required === false);
    assert.equal(result?.user.emailVerifiedAt, null);
  }
});

/**
 * #289: product-choice 18+ registration declaration at the API trust boundary.
 * The memory harness explicitly opts into the real policy; legacy auth tests
 * retain their previous fixture contract until migrated.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createHarness, memoryBackend, WEB_ORIGIN } from "./support/harness.ts";

test("18+ registration blocks missing, false and malformed attestations before account creation", async () => {
  const h = await createHarness(memoryBackend, { adultDeclarationRequired: true });
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const account = {
    email: `adult_${nonce}@example.test`,
    username: `adult_${nonce}`,
    displayName: "Policy Tester",
    password: "strong-test-password-18",
  };
  const post = (body: unknown) => h.app.inject({
    method: "POST",
    url: "/v1/auth/register",
    headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
  try {
    for (const value of [undefined, false, "true"]) {
      const payload = { ...account, ...(value === undefined ? {} : { adultConfirmed: value }) };
      const response = await post(payload);
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().error.code, "VALIDATION_ERROR");
      assert.equal(h.mails.length, 0, "rejected declarations must not trigger outgoing mail");
      assert.equal(await h.store.findUserByEmail(account.email), null, "rejected requests must never create a user");
    }

    const accepted = await post({ ...account, adultConfirmed: true });
    assert.equal(accepted.statusCode, 202, accepted.body);
    assert.deepEqual(accepted.json(), { data: { status: "VERIFICATION_SENT" } });
    assert.equal(h.mails.length, 1);
    assert.ok(await h.store.findUserByEmail(account.email));

    const repeat = await post({ ...account, adultConfirmed: true });
    assert.equal(repeat.statusCode, 202, "existing email response stays indistinguishable: " + repeat.body);
  } finally {
    await h.close();
  }
});

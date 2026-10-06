import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// Guards must reject before a database connection or session write is possible.
for (const scenario of [
  { env: "production", url: "https://kararver-staging.vercel.app", username: "umit_staging_48", reason: "APP_ENV must be staging" },
  { env: "staging", url: "https://wrong.example", username: "umit_staging_48", reason: "Unexpected WEB_URL" },
  { env: "staging", url: "https://kararver-staging.vercel.app", username: "another_user", reason: "Only the agreed #48 test account" },
]) test(`expiry CLI refuses ${scenario.reason}`, () => {
  const result = spawnSync(process.execPath, ["src/modules/auth/staging-expiry-cli.ts", "--username", scenario.username, "--apply"], {
    cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 15000,
    env: { ...process.env, APP_ENV: scenario.env, WEB_URL: scenario.url, DATABASE_URL: "", AUTH_TOKEN_PEPPER: "" },
  });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(scenario.reason));
  assert.ok(!result.stdout.includes("expiry.plan"));
});

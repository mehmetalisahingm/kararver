// #375: local backup metadata must never be included in a git commit accidentally.
// Uses hypothetical paths; does not read, create or upload any backup/credentials.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function ignored(filename) {
  const result = spawnSync("git", ["check-ignore", "-q", "--", filename], {
    cwd: root, encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.ok(result.status === 0 || result.status === 1, "git check-ignore unavailable");
  return result.status === 0;
}

test("database backups, keys and adjacent manifests remain ignored", () => {
  for (const name of [
    "exports/kararver-20261123.dump",
    "exports/kararver-20261123.dump.enc",
    "exports/kararver-20261123.dump.manifest.json",
    "exports/kararver-20261123.dump.enc.manifest.json",
    "exports/restore-key.pem",
  ]) assert.equal(ignored(name), true, name + " must be ignored");
});

test("ordinary code and legal source documents remain trackable", () => {
  for (const name of [
    "package.json",
    "scripts/security-acceptance.mjs",
    "docs/LEGAL_285_OWNER_DECISIONS.md",
  ]) assert.equal(ignored(name), false, name + " must remain trackable");
});

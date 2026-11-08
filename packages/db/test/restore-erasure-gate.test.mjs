import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  validateJournal,
  assertIsolatedRestoreTarget,
  checkNoResurrection,
  MAX_JOURNAL_STALENESS_MS,
} from "../ops/restore-erasure-gate.mjs";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pem = publicKey.export({ format: "pem", type: "spki" });
const now = Date.parse("2026-11-08T10:16:00.000Z");
const iso = ms => new Date(ms).toISOString();
const userId = "00000000-0000-4000-8000-000000000001";
const build = (data, signingKey = privateKey) => {
  const raw = Buffer.from(JSON.stringify(data));
  return [raw, sign(null, raw, signingKey)];
};
const journal = (extra = {}) => ({
  version: 1,
  kind: "kararver-independent-erasure-journal",
  sealedThrough: iso(now - 30_000),
  erasedUserIds: [userId],
  ...extra,
});

test("accepts only a signed independent fresh journal spanning the backup time", () => {
  const [raw, signature] = build(journal());
  const proof = validateJournal(raw, signature, pem, iso(now - 86_400_000), now);
  assert.deepEqual(proof.subjectIds, [userId]);
  assert.equal(proof.sealedThrough, now - 30_000);
});

test("wrong signer, invalid/unsigned content, missing entries, duplicates and extra fields are rejected", () => {
  const [raw, signature] = build(journal());
  const other = generateKeyPairSync("ed25519");
  assert.throws(() => validateJournal(raw, signature, other.publicKey.export({ type: "spki", format: "pem" }), iso(now - 10_000), now), /journal_signature_invalid/);
  assert.throws(() => validateJournal(Buffer.from(JSON.stringify(journal())), Buffer.alloc(64), pem, iso(now - 10_000), now), /journal_signature_invalid/);
  const [dup, dSig] = build(journal({ erasedUserIds: [userId, userId] }));
  assert.throws(() => validateJournal(dup, dSig, pem, iso(now - 10_000), now), /journal_subjects_invalid/);
  const [bad, bSig] = build(journal({ secret: "should-be-rejected" }));
  assert.throws(() => validateJournal(bad, bSig, pem, iso(now - 10_000), now), /journal_unknown_fields/);
  const [missing, mSig] = build({ kind: "kararver-independent-erasure-journal", version: 1, sealedThrough: iso(now) });
  assert.throws(() => validateJournal(missing, mSig, pem, iso(now - 10_000), now), /journal_schema_invalid/);
});

test("stale journal, one older than the restored snapshot or future-dated proof fails closed", () => {
  const [old, oldSig] = build(journal({ sealedThrough: iso(now - MAX_JOURNAL_STALENESS_MS - 1) }));
  assert.throws(() => validateJournal(old, oldSig, pem, iso(now - 86400000), now), /journal_not_fresh_for_restore/);
  const [newest, newestSig] = build(journal({ sealedThrough: iso(now - 10_000) }));
  assert.throws(() => validateJournal(newest, newestSig, pem, iso(now - 1000), now), /journal_not_fresh_for_restore/);
  const [future, futureSig] = build(journal({ sealedThrough: iso(now + 61000) }));
  assert.throws(() => validateJournal(future, futureSig, pem, iso(now - 86000), now), /journal_not_fresh_for_restore/);
});

test("restore gate never accepts live/remote/non-quarantined database URLs", () => {
  const live = "postgresql://example@127.0.0.1:5432/kararver";
  assert.doesNotThrow(() => assertIsolatedRestoreTarget("postgresql://example@127.0.0.1:5432/kararver_restore_check", live));
  for (const url of [
    live,
    "postgresql://example@db.internal:5432/kararver_restore_check",
    "postgresql://example@127.0.0.1:5432/kararver",
    "postgresql://example@127.0.0.1:5432/kararver_restore_check?host=evil",
  ]) assert.throws(() => assertIsolatedRestoreTarget(url, live));
});

test("any restored account row (including tombstones), authored poll/comment, vote, session, token or media blocks", async () => {
  const makeDb = affected => {
    const seen = [];
    const count = table => async opts => {
      seen.push([table, opts.where]);
      return table === affected ? 1 : 0;
    };
    return {
      seen,
      user: { count: count("user") },
      poll: { count: count("poll") },
      comment: { count: count("comment") },
      vote: { count: count("vote") },
      session: { count: count("session") },
      authToken: { count: count("authToken") },
      mediaAsset: { count: count("mediaAsset") },
    };
  };
  for (const table of ["user","poll","comment","vote","session","authToken","mediaAsset"]) {
    const db = makeDb(table);
    const r = await checkNoResurrection(db, [userId]);
    assert.equal(r.safe, false, table);
    assert.equal(db.seen.length, 7);
    assert.equal(db.seen[0][1].id.in[0], userId);
  }
  assert.equal((await checkNoResurrection(makeDb("none"), [userId])).safe, true);
});

test("CLI refuses promotion proof without signed journal and writes no secrets", () => {
  const cli = resolve(fileURLToPath(new URL("../ops/restore-erasure-gate.mjs", import.meta.url)));
  const result = spawnSync(process.execPath, [cli], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /NO_GO/);
  assert.doesNotMatch(result.stdout, /postgresql:|password|token/i);
});

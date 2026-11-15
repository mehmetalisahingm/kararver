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
  assert.throws(() => validateJournal(raw, signature, other.publicKey.export({ type: "spki", format: "pem" }), iso(now - 86_400_000), now), /journal_signature_invalid/);
  assert.throws(() => validateJournal(Buffer.from(JSON.stringify(journal())), Buffer.alloc(64), pem, iso(now - 86_400_000), now), /journal_signature_invalid/);
  const [dup, dSig] = build(journal({ erasedUserIds: [userId, userId] }));
  assert.throws(() => validateJournal(dup, dSig, pem, iso(now - 86_400_000), now), /journal_subjects_invalid/);
  const [bad, bSig] = build(journal({ secret: "should-be-rejected" }));
  assert.throws(() => validateJournal(bad, bSig, pem, iso(now - 86_400_000), now), /journal_unknown_fields/);
  const [missing, mSig] = build({ kind: "kararver-independent-erasure-journal", version: 1, sealedThrough: iso(now) });
  assert.throws(() => validateJournal(missing, mSig, pem, iso(now - 86_400_000), now), /journal_schema_invalid/);
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

// In-memory Prisma stand-in: each table is a row list; count() applies the
// subset of where-filters the gate uses (in / null / not / OR).
function fakeDb(tables) {
  const match = (row, where) => Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return cond.some(w => match(row, w));
    if (cond === null) return row[key] === null;
    if (typeof cond === "object" && "in" in cond) return cond.in.includes(row[key]);
    if (typeof cond === "object" && "not" in cond) return row[key] !== cond.not;
    return row[key] === cond;
  });
  const db = {};
  for (const name of ["user", "poll", "comment", "vote", "session", "authToken", "mediaAsset", "userMfaCredential", "dataExport", "domainEvent"]) {
    db[name] = { count: async ({ where }) => (tables[name] ?? []).filter(r => match(r, where)).length };
  }
  return db;
}
const at = new Date("2026-11-08T09:00:00.000Z");
// Exactly what today's account-erasure flow leaves behind.
const tombstone = () => ({
  user: [{ id: userId, deletedAt: at }],
  poll: [{ authorId: userId, deletedAt: at, status: "REMOVED" }],
  comment: [{ authorId: userId, deletedAt: at, status: "REMOVED" }],
  mediaAsset: [{ uploaderId: userId, publicObjectKey: null, status: "REJECTED" }],
  dataExport: [{ userId, status: "EXPIRED" }],
  // #372: erasure does not touch domain_events today.
  domainEvent: [{ actorId: userId, type: "comment.created" }],
});

test("erasure tombstones are retained data (still NO-GO) but are NOT reported as resurrection", async () => {
  const r = await checkNoResurrection(fakeDb(tombstone()), [userId]);
  assert.equal(r.safe, false, "strict #321 target: tombstones still block");
  assert.equal(r.noResurrection, true);
  assert.ok(Object.values(r.resurrected).every(v => v === 0));
  assert.equal(r.retained.restoredUsers, 1);
  assert.equal(r.retained.authoredPolls, 1);
  assert.equal(r.retained.mediaAssets, 1);
  assert.equal(r.retained.actorEvents, 1, "#372: events under a journaled actor are retained data");
});

test("#389 review: events where the erased person is the USER subject (sanction, role) are counted too", async () => {
  const other = "00000000-0000-4000-8000-000000000009";
  const r = await checkNoResurrection(fakeDb({ domainEvent: [
    { actorId: other, subjectType: "USER", subjectId: userId, type: "user.sanctioned" },
    { actorId: other, subjectType: "POLL", subjectId: userId, type: "poll.removed" }, // same UUID text, different subject type
    { actorId: other, subjectType: "USER", subjectId: other, type: "user.role.changed" },
  ] }), [userId]);
  assert.equal(r.retained.actorEvents, 1);
  assert.equal(r.safe, false);
});

test("#389 review: every counter is reported under its own name (no positional shift)", async () => {
  const t = tombstone();
  t.session = [{ userId }];
  const r = await checkNoResurrection(fakeDb(t), [userId]);
  assert.deepEqual(r.retained, { restoredUsers: 1, authoredPolls: 1, authoredComments: 1, linkedVotes: 0, sessions: 1, authTokens: 0, mediaAssets: 1, actorEvents: 1 });
  assert.deepEqual(r.resurrected, { liveUsers: 0, liveAuthoredPolls: 0, liveAuthoredComments: 0, linkedVotes: 0, sessions: 1, authTokens: 0, mfaCredentials: 0, publishedMedia: 0, readyExports: 0 });
});

test("#372 events alone (no other row) still block promotion as retained data", async () => {
  const r = await checkNoResurrection(fakeDb({ domainEvent: [{ actorId: userId, type: "comment.created" }] }), [userId]);
  assert.equal(r.noResurrection, true);
  assert.equal(r.safe, false);
  assert.equal(r.retained.actorEvents, 1);
});

test("any pre-erasure state under a journaled ID is resurrection", async () => {
  const cases = {
    liveUsers: t => { t.user[0].deletedAt = null; },
    liveAuthoredPolls: t => { t.poll[0].status = "ACTIVE"; },
    liveAuthoredComments: t => { t.comment[0].deletedAt = null; },
    linkedVotes: t => { t.vote = [{ userId }]; },
    sessions: t => { t.session = [{ userId }]; },
    authTokens: t => { t.authToken = [{ userId }]; },
    mfaCredentials: t => { t.userMfaCredential = [{ userId }]; },
    publishedMedia: t => { t.mediaAsset[0].publicObjectKey = "public/x.webp"; },
    readyExports: t => { t.dataExport[0].status = "READY"; },
  };
  for (const [key, mutate] of Object.entries(cases)) {
    const t = tombstone();
    mutate(t);
    const r = await checkNoResurrection(fakeDb(t), [userId]);
    assert.equal(r.noResurrection, false, key);
    assert.equal(r.safe, false, key);
    assert.equal(r.resurrected[key], 1, key);
  }
});

test("unrelated users never count; only a fully absent subject passes", async () => {
  const other = "00000000-0000-4000-8000-000000000002";
  const t = { user: [{ id: other, deletedAt: null }], session: [{ userId: other }] };
  const r = await checkNoResurrection(fakeDb(t), [userId]);
  assert.equal(r.safe, true);
  assert.equal(r.noResurrection, true);
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

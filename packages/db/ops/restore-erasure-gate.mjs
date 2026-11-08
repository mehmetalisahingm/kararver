/**
 * #181/#285/#311 — read-only privacy gate for a QUARANTINED, isolated restore.
 *
 * An ordinary pg_restore + manifest equality can resurrect a user deleted
 * AFTER the snapshot was taken. This checker compares the restored database to
 * a separately held, signed authoritative erasure journal. The journal and
 * its signing key MUST live outside backups and the public repository.
 *
 * A PASS is NOT authorization to expose the restored database: journal
 * completeness, key custody, media/CDN/backup cleanup and legal exceptions
 * still need separately recorded operational/human acceptance.
 */
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

export const MAX_JOURNAL_STALENESS_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) throw new Error("invalid_timestamp");
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error("invalid_timestamp");
  return ms;
}

/** Pure validation; do not emit journal content or user IDs to logs. */
export function validateJournal(bytes, signature, publicKeyPem, backupCreatedAt, now = Date.now()) {
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("journal_key_not_ed25519");
  if (!Buffer.isBuffer(signature) || signature.length !== 64 || !verify(null, bytes, key, signature)) {
    throw new Error("journal_signature_invalid");
  }
  const data = JSON.parse(bytes.toString("utf8"));
  if (data?.version !== 1 || data?.kind !== "kararver-independent-erasure-journal" || !Array.isArray(data.erasedUserIds)) {
    throw new Error("journal_schema_invalid");
  }
  if (Object.keys(data).sort().join(",") !== ["erasedUserIds","kind","sealedThrough","version"].sort().join(",")) {
    throw new Error("journal_unknown_fields");
  }
  const sealed = asTime(data.sealedThrough);
  const snapshot = asTime(backupCreatedAt);
  if (snapshot > now + 60_000 || sealed > now + 60_000 || sealed < snapshot ||
      now - sealed > MAX_JOURNAL_STALENESS_MS) throw new Error("journal_not_fresh_for_restore");
  if (data.erasedUserIds.length > 100_000 || data.erasedUserIds.some(id => typeof id !== "string" || !UUID.test(id)) ||
      new Set(data.erasedUserIds).size !== data.erasedUserIds.length) {
    throw new Error("journal_subjects_invalid");
  }
  return { sealedThrough: sealed, subjectIds: data.erasedUserIds };
}

export function assertIsolatedRestoreTarget(target, live) {
  if (!target) throw new Error("missing_quarantined_restore_url");
  const restored = new URL(target);
  if (!["postgresql:", "postgres:"].includes(restored.protocol)) throw new Error("not_postgres");
  if (!["localhost","127.0.0.1","[::1]"].includes(restored.hostname)) throw new Error("restore_not_local_isolated");
  if (restored.search || restored.hash) throw new Error("restore_url_query_not_allowed");
  const name = decodeURIComponent(restored.pathname.slice(1));
  if (!/(?:restore|_test|quarantine)/i.test(name)) throw new Error("restore_db_not_quarantined");
  if (live) {
    const production = new URL(live);
    if (restored.host === production.host && restored.pathname === production.pathname) throw new Error("restore_points_to_live_db");
  }
}

/**
 * Check the complete signed set, bounded query size, with NO writes. Current
 * strict requirement: no surviving user/content/session/media row under ANY
 * of the journaled IDs. Historic legal operation records are assessed
 * separately; a tombstoned user is still retained data, not an anonymous stat.
 */
export async function checkNoResurrection(db, subjectIds) {
  const counts = { restoredUsers: 0, authoredPolls: 0, authoredComments: 0, linkedVotes: 0, sessions: 0, authTokens: 0, mediaAssets: 0 };
  for (let i = 0; i < subjectIds.length; i += 250) {
    const chunk = subjectIds.slice(i, i + 250);
    const whereId = { in: chunk };
    const found = await Promise.all([
      db.user.count({ where: { id: whereId } }),
      db.poll.count({ where: { authorId: whereId } }),
      db.comment.count({ where: { authorId: whereId } }),
      db.vote.count({ where: { userId: whereId } }),
      db.session.count({ where: { userId: whereId } }),
      db.authToken.count({ where: { userId: whereId } }),
      db.mediaAsset.count({ where: { uploaderId: whereId } }),
    ]);
    Object.keys(counts).forEach((key, j) => { counts[key] += found[j]; });
  }
  return { safe: Object.values(counts).every(v => v === 0), counts };
}

function report(errorCode, values) {
  // Never print backup paths, ledger subjects, emails, connection strings or signing material.
  process.stdout.write(JSON.stringify({ gate: "restore-erasure", result: errorCode, ...values }) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  try {
    const { values } = parseArgs({ options: {
      ledger: { type: "string" },
      signature: { type: "string" },
      manifest: { type: "string" },
    } });
    if (!values.ledger || !values.signature || !values.manifest || !process.env.ERASURE_JOURNAL_PUBLIC_KEY_PEM) {
      throw new Error("independent_signed_journal_required");
    }
    assertIsolatedRestoreTarget(process.env.RESTORE_DATABASE_URL, process.env.DATABASE_URL);
    const { createPrismaClient } = await import("../src/index.ts");
    const manifest = JSON.parse(await readFile(values.manifest, "utf8"));
    if (manifest.kind !== "kararver-db-backup" || manifest.version !== 1) throw new Error("backup_manifest_invalid");
    const subject = validateJournal(
      await readFile(values.ledger), await readFile(values.signature),
      process.env.ERASURE_JOURNAL_PUBLIC_KEY_PEM, manifest.createdAt,
    );
    const db = createPrismaClient(process.env.RESTORE_DATABASE_URL);
    try {
      const outcome = await checkNoResurrection(db, subject.subjectIds);
      report(outcome.safe ? "READ_ONLY_VERIFIED_PENDING_HUMAN_GO" : "BLOCKED_RESURRECTED_DATA", { checkedSubjects: subject.subjectIds.length, ...outcome.counts });
      if (!outcome.safe) process.exitCode = 2;
    } finally {
      await db.$disconnect();
    }
  } catch (error) {
    report("NO_GO", { reason: error instanceof Error && /^(?:journal_|restore_|backup_|missing_|independent_|not_postgres)/.test(error.message) ? error.message : "validation_failed" });
    process.exitCode = 2;
  }
}

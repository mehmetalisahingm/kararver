/**
 * KararVer account erasure policy readiness inspection — read-only source audit.
 *
 * This is NOT runtime verification, anonymization certification, or a data-deletion
 * command. The policy owner chose: erase account + authored polls + comments;
 * retain only genuinely non-identifying aggregate statistics, aside from narrowly
 * justified mandatory legal records. A source-level detector can report blockers,
 * but can never independently authorize public release.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const ERASURE_GATES = Object.freeze([
  { id: "content-polls", owner: "Mert + Faruk", detail: "Authored polls are still soft-deleted, not physically removed from all DB relations." },
  { id: "content-comments", owner: "Mert + Faruk", detail: "Authored comments are still soft-deleted, not physically removed from all DB relations." },
  { id: "aggregate-privacy", owner: "Faruk + Utku", detail: "Per-vote timestamps and event histories survive in anonymous_vote_groups and may permit singling out or linkage." },
  { id: "storage-verified", owner: "Faruk + Mert", detail: "Success response occurs before asynchronous object-storage cleanup has been verified." },
  { id: "backup-replay", owner: "Faruk", detail: "Restored backups must replay confirmed erasures before any re-exposure; automated restore proof absent." },
  { id: "legal-exceptions", owner: "Mert + Faruk + hukuk", detail: "Retention of audit, reports, sanctions and erasure operation proofs needs purpose, access and retention decisions." },
]);

export function inspectErasureSources(sources) {
  const blockers = [];
  const content = sources.content ?? "";
  const erasureStore = sources.store ?? "";
  const cleanup = sources.cleanup ?? "";
  const backup = sources.backup ?? "";
  const legal = sources.legal ?? "";
  // This gate intentionally treats unknown source changes as BLOCKED. It is a
  // conservative signal for reviewers, never a substitute for live DB tests.
  const tests = [
    /tx\.poll\.updateMany\(\{\s*where:\s*\{\s*authorId:\s*userId/.test(content),
    /tx\.comment\.updateMany\(\{\s*where:\s*\{\s*authorId:\s*userId/.test(content),
    /anonymous_vote_groups\([\s\S]*?created_at[\s\S]*?history/.test(content) && /occurred_at/.test(content),
    /storageCleanedAt:\s*null/.test(cleanup) && /kind:\s*"anonymized"/.test(erasureStore),
    !/RESTORE_ERASURE_REPLAY_VERIFIED/.test(backup),
    !/LEGAL_ERASURE_RETENTION_APPROVED/.test(legal),
  ];
  for (let i = 0; i < ERASURE_GATES.length; i++) {
    // Positive matching above means a known blocker; unknown changes still
    // require human proof, so this script never emits "fully compliant".
    if (tests[i]) blockers.push(ERASURE_GATES[i]);
  }
  return { readyForPublicGo: false, blockers, manuallyVerified: false };
}

function readSafe(name) {
  return readFileSync(resolve(fileURLToPath(new URL("..", import.meta.url)), name), "utf8");
}

export function scanCurrentRepository() {
  return inspectErasureSources({
    content: readSafe("apps/api/src/modules/account-erasure/content.ts"),
    store: readSafe("apps/api/src/modules/account-erasure/prisma-store.ts"),
    cleanup: readSafe("apps/worker/src/jobs/account-erasure/cleanup.ts"),
    backup: readSafe("packages/db/ops/restore.ts"),
    legal: readSafe("docs/KV-33_ADMIN_USERS.md"),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = scanCurrentRepository();
  process.stdout.write(JSON.stringify({
    policy: "account + authored polls and comments erased; only genuinely anonymous aggregate statistics retained, subject to narrowly justified legal exceptions",
    status: "NO-GO: independent legal and real staging acceptance required",
    blockers: result.blockers,
    automatedSourceOnly: true,
  }, null, 2) + "\n");
  // Intended for a *manual release-gate* invocation; CI can run in report
  // mode while feature remains disabled and the larger backend fix is reviewed.
  if (process.argv.includes("--enforce")) process.exitCode = 2;
}

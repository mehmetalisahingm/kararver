// Operator-only: one owned neutral fixture, real DB/S3 and isolated worker timeout.
// Does not change the shared model, users, settings or public bucket policy.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { createPrismaClient } from "@kararver/db";
import { loadWorkerConfig } from "../src/config.ts";
import { processMedia, publicKey } from "../src/jobs/media/job.ts";
import { ModerationTimeoutError } from "../src/jobs/media/moderator.ts";
import { createPrismaMediaJobStore } from "../src/jobs/media/store.ts";
import { createS3WorkerStorage } from "../src/jobs/media/storage.ts";
import { createS3MediaStorage } from "../../api/src/modules/media/storage.ts";
import { createPrismaMediaStore } from "../../api/src/modules/media/prisma-store.ts";

const WEB = "https://kararver-staging.vercel.app";
const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } } });
assert.equal(process.env.APP_ENV, "staging", "Only staging is allowed");
assert.equal(process.env.WEB_URL?.replace(/\/$/, ""), WEB, "Canonical staging required");
assert.equal(process.env.MEDIA_PUBLIC_BASE_URL?.replace(/\/$/, ""), `${WEB}/api/media-public`, "Approved-media proxy required");
console.log(JSON.stringify({ event: "media.acceptance.plan", apply: values.apply, mode: "ISOLATED_WORKER_TIMEOUT_REAL_DB_S3" }));

if (values.apply) {
  const config = loadWorkerConfig();
  const db = createPrismaClient(config.databaseUrl);
  const storage = createS3WorkerStorage(config.storage);
  const apiStorage = createS3MediaStorage(config.storage);
  const store = createPrismaMediaStore(db);
  let mediaId: string | undefined, actorId: string | undefined;
  const requestId = randomUUID();
  const report = (phase: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ event: `media.acceptance.${phase}`, requestId, ...data }));
  const guest = async (id: string) => fetch(`${WEB}/api/media-public/${publicKey(id)}`, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
  try {
    const user = await db.user.findUnique({ where: { usernameNormalized: "umit_staging_48" }, select: { id: true, status: true, deletedAt: true, role: { select: { role: true } } } });
    assert.ok(user && !user.deletedAt && user.status === "ACTIVE" && (!user.role || user.role.role === "USER"), "Existing normal test account required");
    const actor = await db.user.findFirst({ where: { emailNormalized: "superadmin@test.test", status: "ACTIVE", deletedAt: null, role: { role: "SUPER_ADMIN" } }, select: { id: true } });
    assert.ok(actor, "Existing operator required"); actorId = actor.id;
    // Random non-personal RGB pattern avoids matching a previous tiny fixture's dHash.
    const original = await sharp(randomBytes(32 * 32 * 3), { raw: { width: 32, height: 32, channels: 3 } }).png().toBuffer();
    const row = await db.mediaAsset.create({ data: { uploaderId: user.id, purpose: "POLL", originalObjectKey: `uploads/qa46-${requestId}/original` }, select: { id: true, originalObjectKey: true } });
    mediaId = row.id;
    await storage.writePrivate(row.originalObjectKey, original, "image/png");
    const result = await processMedia(row.id, { store: createPrismaMediaJobStore(db), storage,
      moderator: { async classify() { throw new ModerationTimeoutError("isolated acceptance fixture"); }, async close() {} },
      now: () => new Date(), maxBytes: async () => 1024 * 1024, log: () => {} });
    const quarantined = await db.mediaAsset.findUniqueOrThrow({ where: { id: row.id }, select: { status: true, processingError: true, processedObjectKey: true, publicObjectKey: true } });
    assert.equal(result, "QUARANTINED"); assert.equal(quarantined.processingError, "MODERATION_TIMEOUT");
    assert.ok(quarantined.processedObjectKey); assert.equal(quarantined.publicObjectKey, null);
    const hidden = await guest(row.id); assert.equal(hidden.status, 404); await hidden.arrayBuffer();
    report("timeout-quarantined", { status: result, error: quarantined.processingError, publicStatus: 404 });
    // Internal operator decision + audit, not proof of the authenticated admin HTTP flow.
    await apiStorage.publishFromPrivate(quarantined.processedObjectKey!, publicKey(row.id));
    const approved = await store.applyDecision({ id: row.id, actorId, decision: "APPROVE", reason: `#46 own neutral proxy acceptance ${requestId}`, requestId, now: new Date() });
    assert.equal(approved.kind, "applied");
    const visible = await guest(row.id); assert.equal(visible.status, 200);
    assert.match(visible.headers.get("content-type") ?? "", /^image\/webp/);
    assert.match(visible.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(visible.headers.get("location"), null);
    const bytes = Buffer.from(await visible.arrayBuffer());
    assert.ok(bytes.subarray(0, 4).equals(Buffer.from("RIFF")) && bytes.subarray(8, 12).equals(Buffer.from("WEBP")));
    report("approved-guest", { status: visible.status, type: "image/webp", noStore: true, bytes: bytes.length });
  } catch {
    console.error("Media acceptance FAILED; see the last sanitized phase. No complete acceptance claimed."); process.exitCode = 1;
  } finally {
    try {
      if (mediaId && actorId) {
        await apiStorage.deletePublic(publicKey(mediaId));
        // A storage failure before processing can leave only our own PENDING fixture behind.
        await db.mediaAsset.updateMany({ where: { id: mediaId, status: "PENDING" }, data: { status: "REJECTED", processingError: "ACCEPTANCE_FAILED" } });
        const cleanup = await store.applyDecision({ id: mediaId, actorId, decision: "REJECT", reason: `#46 acceptance cleanup ${requestId}`, requestId, now: new Date() });
        assert.ok(cleanup.kind === "applied" || cleanup.kind === "unchanged");
        await apiStorage.deletePublic(publicKey(mediaId));
        const removed = await guest(mediaId); assert.equal(removed.status, 404); await removed.arrayBuffer();
        report("cleanup", { status: "REJECTED", publicStatus: 404 });
      }
    } catch { console.error("Owned media fixture cleanup failed; inspect acceptance requestId in moderation audit."); process.exitCode = 1; }
    finally { await db.$disconnect(); }
    if (!process.exitCode) report("result", { result: "PASS", limits: "isolated injected timeout and internal moderation decision; not real model, browser upload CORS or admin HTTP acceptance" });
  }
}

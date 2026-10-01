/**
 * media.process uçtan uca (KV-16, #18). Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL; CI'da tanımlı):
 * DB CHECK'leri (public anahtar sadece APPROVED'da) ve "sadece PENDING'e yaz" koşulu gerçekten sınanır.
 * Storage ve moderatör sahtedir; görsel işleme gerçek sharp ile yapılır.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createPrismaClient, type PrismaClient } from "@kararver/db";
import sharp from "sharp";
import { MAX_ATTEMPTS, processMedia, type MediaJobDeps } from "../src/jobs/media/job.ts";
import { ModerationFailedError, ModerationTimeoutError, type Moderator } from "../src/jobs/media/moderator.ts";
import type { Detection } from "../src/jobs/media/policy.ts";
import { ObjectTooLargeError, type WorkerStorage } from "../src/jobs/media/storage.ts";
import { createPrismaMediaJobStore } from "../src/jobs/media/store.ts";

const url = process.env.TEST_DATABASE_URL;

function fakeStorage() {
  const priv = new Map<string, Buffer>();
  const pub = new Map<string, Buffer>();
  const calls = { deletedPublic: [] as string[] };
  let failWritePrivate = 0;
  const storage: WorkerStorage = {
    async readPrivate(key, maxBytes) {
      const data = priv.get(key);
      if (!data) return null;
      if (data.length > maxBytes) throw new ObjectTooLargeError("büyük");
      return data;
    },
    async writePrivate(key, data) {
      if (failWritePrivate > 0) {
        failWritePrivate--;
        throw new Error("geçici S3 hatası");
      }
      priv.set(key, data);
    },
    async writePublic(key, data) {
      pub.set(key, data);
    },
    async deletePublic(key) {
      calls.deletedPublic.push(key);
      pub.delete(key);
    },
  };
  return { storage, priv, pub, calls, failNextPrivateWrites: (n: number) => void (failWritePrivate = n) };
}

function fakeModerator(behaviour: () => Promise<Detection[]>): Moderator {
  return { classify: behaviour, close: async () => {} };
}

describe("media.process (postgres)", { skip: url ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let db: PrismaClient;
  let uploaderId: string;

  before(async () => {
    const dbDir = path.resolve(import.meta.dirname, "../../../packages/db");
    const prismaCli = createRequire(path.join(dbDir, "package.json")).resolve("prisma/build/index.js");
    const migrate = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: dbDir,
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
    });
    assert.equal(migrate.status, 0, `prisma migrate deploy başarısız:\n${migrate.stdout}\n${migrate.stderr}`);
    db = createPrismaClient(url);
    const handle = `worker_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    uploaderId = (
      await db.user.create({
        data: {
          email: `${handle}@example.test`,
          emailNormalized: `${handle}@example.test`,
          username: handle,
          usernameNormalized: handle,
          displayName: "Worker",
          passwordHash: "x",
        },
      })
    ).id;
  });
  after(async () => {
    await db?.$disconnect();
  });

  const photo = () =>
    sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 30, g: 90, b: 160 } } })
      .withExif({ IFD0: { Artist: "Gizli Kişi" } })
      .jpeg()
      .toBuffer();

  async function pendingMedia(original: Buffer | null, s: ReturnType<typeof fakeStorage>) {
    const key = `uploads/${randomUUID()}/original`;
    if (original) s.priv.set(key, original);
    const media = await db.mediaAsset.create({ data: { uploaderId, purpose: "POLL", originalObjectKey: key } });
    return media.id;
  }

  function deps(s: ReturnType<typeof fakeStorage>, moderator: Moderator, overrides: Partial<MediaJobDeps> = {}): MediaJobDeps {
    return {
      store: createPrismaMediaJobStore(db),
      storage: s.storage,
      moderator,
      now: () => new Date("2026-10-01T09:00:00.000Z"),
      maxBytes: async () => 8 * 1024 * 1024,
      log: () => {},
      ...overrides,
    };
  }

  const row = (id: string) => db.mediaAsset.findUniqueOrThrow({ where: { id } });

  test("düşük risk: EXIF'siz webp public bucket'a yazılır, kayıt APPROVED ve meta veriler dolar", async () => {
    const s = fakeStorage();
    const original = await photo();
    const id = await pendingMedia(original, s);
    const result = await processMedia(id, deps(s, fakeModerator(async () => [{ class: "FACE_FEMALE", score: 0.95 }])));

    assert.equal(result, "APPROVED");
    const r = await row(id);
    assert.equal(r.status, "APPROVED");
    assert.equal(r.publicObjectKey, `m/${id}.webp`);
    assert.equal(r.processedObjectKey, `processed/${id}.webp`);
    assert.deepEqual([r.width, r.height], [2048, 1365]);
    assert.equal(r.originalMimeType, "image/jpeg");
    assert.equal(r.originalSizeBytes, original.length);
    assert.equal(r.contentSha256, createHash("sha256").update(original).digest("hex"));
    assert.equal(r.riskLevel, "LOW");
    assert.equal(r.riskScore, 0);
    assert.deepEqual(r.moderationLabels, [{ class: "FACE_FEMALE", score: 0.95 }]);
    assert.equal(r.moderationModel, "nudenet-3.4.2-320n");
    assert.equal(r.processingAttempts, 1);
    assert.equal(r.processingError, null);

    const published = s.pub.get(`m/${id}.webp`)!;
    assert.deepEqual(published, s.priv.get(`processed/${id}.webp`));
    const meta = await sharp(published).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.exif, undefined);
    assert.ok(!published.includes(Buffer.from("Gizli Kişi")));
    assert.equal(r.processedSizeBytes, published.length);
  });

  test("yüksek ve orta risk karantinaya alınır, public kopya oluşmaz", async () => {
    for (const [score, level] of [
      [0.9, "HIGH"],
      [0.5, "MEDIUM"],
    ] as const) {
      const s = fakeStorage();
      const id = await pendingMedia(await photo(), s);
      const result = await processMedia(id, deps(s, fakeModerator(async () => [{ class: "FEMALE_BREAST_EXPOSED", score }])));
      assert.equal(result, "QUARANTINED");
      const r = await row(id);
      assert.deepEqual([r.status, r.riskLevel, r.riskScore, r.publicObjectKey], ["QUARANTINED", level, score, null]);
      assert.ok(r.processedObjectKey, "moderatör işlenmiş kopyayı inceleyebilir");
      assert.equal(s.pub.size, 0);
    }
  });

  test("moderasyon zaman aşımı ve model hatası fail-closed: karantina, risk yazılmaz", async () => {
    const s = fakeStorage();
    const timeout = await pendingMedia(await photo(), s);
    await processMedia(timeout, deps(s, fakeModerator(async () => { throw new ModerationTimeoutError("8 sn"); })));
    let r = await row(timeout);
    assert.deepEqual([r.status, r.processingError, r.riskLevel, r.publicObjectKey], ["QUARANTINED", "MODERATION_TIMEOUT", null, null]);

    const broken = await pendingMedia(await photo(), s);
    await processMedia(broken, deps(s, fakeModerator(async () => { throw new ModerationFailedError("çöktü"); })));
    r = await row(broken);
    assert.deepEqual([r.status, r.processingError], ["QUARANTINED", "MODEL_ERROR"]);
    assert.equal(s.pub.size, 0);
  });

  test("görsel olmayan, eksik ve fazla büyük dosya reddedilir; moderatöre gönderilmez", async () => {
    const s = fakeStorage();
    let called = 0;
    const moderator = fakeModerator(async () => {
      called++;
      return [];
    });

    const html = await pendingMedia(Buffer.from("<html><script>alert(1)</script></html>"), s);
    assert.equal(await processMedia(html, deps(s, moderator)), "REJECTED");
    assert.deepEqual([(await row(html)).processingError, (await row(html)).processedObjectKey], ["INVALID_IMAGE", null]);

    const missing = await pendingMedia(null, s);
    await processMedia(missing, deps(s, moderator));
    assert.equal((await row(missing)).processingError, "MISSING_ORIGINAL");

    const big = await pendingMedia(await photo(), s);
    await processMedia(big, deps(s, moderator, { maxBytes: async () => 1000 }));
    assert.equal((await row(big)).processingError, "TOO_LARGE");

    assert.equal(called, 0);
    assert.equal(s.pub.size, 0);
  });

  test("işlenmiş veya olmayan görsel atlanır (tekrar çalışan iş zararsız)", async () => {
    const s = fakeStorage();
    const id = await pendingMedia(await photo(), s);
    const d = deps(s, fakeModerator(async () => []));
    assert.equal(await processMedia(id, d), "APPROVED");
    assert.equal(await processMedia(id, d), "SKIPPED");
    assert.equal((await row(id)).processingAttempts, 1);
    assert.equal(await processMedia(randomUUID(), d), "SKIPPED");
  });

  test("geçici hata yeniden denenir; son denemede de olursa görsel karantinaya düşer", async () => {
    const s = fakeStorage();
    const id = await pendingMedia(await photo(), s);
    const d = deps(s, fakeModerator(async () => []));

    s.failNextPrivateWrites(MAX_ATTEMPTS);
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      await assert.rejects(processMedia(id, d), /geçici S3 hatası/);
      assert.deepEqual([(await row(id)).status, (await row(id)).processingAttempts], ["PENDING", attempt]);
    }
    assert.equal(await processMedia(id, d), "QUARANTINED");
    const r = await row(id);
    assert.deepEqual([r.status, r.processingError, r.processingAttempts, r.publicObjectKey], ["QUARANTINED", "PROCESSING_FAILED", MAX_ATTEMPTS, null]);
  });

  test("işlem sırasında başka bir karar yazılırsa yayına alınan kopya geri çekilir", async () => {
    const s = fakeStorage();
    const id = await pendingMedia(await photo(), s);
    const moderator = fakeModerator(async () => {
      // Moderatör bu arada görseli elle reddetti.
      await db.mediaAsset.update({ where: { id }, data: { status: "REJECTED", processingError: "MANUAL" } });
      return [];
    });
    assert.equal(await processMedia(id, deps(s, moderator)), "SKIPPED");
    assert.deepEqual(s.calls.deletedPublic, [`m/${id}.webp`]);
    assert.equal(s.pub.size, 0);
    const r = await row(id);
    assert.deepEqual([r.status, r.publicObjectKey], ["REJECTED", null]);
  });
});

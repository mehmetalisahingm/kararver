/**
 * #375 izole restore tatbikatı (uçtan uca, yalnız sentetik veri).
 *
 * Tek zincir: migration'lı kaynak → pg_dump yedeği + manifest → zarf şifreleme (KVBK1) → çözme → yalnız "restore"
 * adlı yerel hedefe restore → manifest doğrulaması → migration kapısı → restore-erasure kapısı → KV-48 7. adım
 * (yedekten sonra silinen hesabın yeniden anonimleştirilmesi) → kapı tekrar.
 *
 * Negatifler: yanlış anahtar, kesik ve değiştirilmiş şifreli dosya (düz metin bırakılmaz), dolu hedefe restore,
 * eksik migration (eski şema), canlı DB'yi gösteren veya karantina adı taşımayan restore hedefi.
 *
 * Yalnız TEST_DATABASE_URL'nin yanındaki "<test>_drill_src" / "<test>_drill_restore" veritabanlarına dokunur.
 * Production, staging, gerçek yedek veya anahtar kullanılmaz; anahtar çifti testte üretilir ve bellekte kalır.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";
import { createPrismaClient, type PrismaClient } from "@kararver/db";
import { backup } from "@kararver/db/ops/backup";
import { migrationGate } from "../../../packages/db/ops/migration-gate.ts";
import { pgTool, withDatabase } from "../../../packages/db/ops/pg-tools.ts";
import { restore } from "../../../packages/db/ops/restore.ts";
import { decryptFile, encryptFile } from "../../worker/src/jobs/backup/envelope.ts";
import { createPrismaAccountErasureStore } from "../src/modules/account-erasure/prisma-store.ts";

type GateOutcome = { safe: boolean; noResurrection: boolean; resurrected: Record<string, number>; retained: Record<string, number> };
type GateModule = {
  checkNoResurrection(db: PrismaClient, ids: string[]): Promise<GateOutcome>;
  assertIsolatedRestoreTarget(target: string | undefined, live: string | undefined): void;
};

const dbPackage = path.resolve(import.meta.dirname, "../../../packages/db");
// JS modülü (bildirim dosyası yok); yol değişkenle verilir.
const gatePath = pathToFileURL(path.join(dbPackage, "ops/restore-erasure-gate.mjs")).href;

function baseUrl(): string | null {
  return process.env.TEST_DATABASE_URL ?? null;
}
function toolMajor(): number | null {
  const r = spawnSync(pgTool("pg_dump"), ["--version"], { encoding: "utf8" });
  const m = r.stdout?.match(/(\d+)\.\d+/);
  return r.status === 0 && m ? Number(m[1]) : null;
}
const base = baseUrl();
const major = base ? toolMajor() : null;
const skip = base === null ? "TEST_DATABASE_URL yok (CI'da çalışır)"
  : major === null ? "pg_dump bulunamadı (PG_BIN)"
  : major < 17 ? `pg_dump ${major} sunucudan eski (17 gerekir)` : false;

describe("izole restore tatbikatı: yedek → şifre → restore → kapılar → silme tekrarı (postgres)", { skip }, () => {
  const baseName = base ? decodeURIComponent(new URL(base).pathname.slice(1)) : "";
  const srcUrl = base ? withDatabase(base, `${baseName}_drill_src`) : "";
  const restoreUrl = base ? withDatabase(base, `${baseName}_drill_restore`) : "";
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const other = generateKeyPairSync("rsa", { modulusLength: 3072, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  let admin: PrismaClient;
  let src: PrismaClient;
  let dir: string;
  let gate: GateModule;

  const drop = (url: string) => admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${decodeURIComponent(new URL(url).pathname.slice(1))}" WITH (FORCE)`);

  before(async () => {
    assert.ok(baseName.endsWith("_test"), "tatbikat yalnız _test veritabanının yanında çalışır");
    gate = (await import(gatePath)) as GateModule;
    admin = createPrismaClient(withDatabase(base!, "postgres"));
    for (const u of [srcUrl, restoreUrl]) await drop(u);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${baseName}_drill_src"`);
    const prismaCli = createRequire(path.join(dbPackage, "package.json")).resolve("prisma/build/index.js");
    const r = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: dbPackage, env: { ...process.env, DATABASE_URL: srcUrl }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    src = createPrismaClient(srcUrl);
    dir = await mkdtemp(path.join(os.tmpdir(), "kv375-"));
  });

  after(async () => {
    await src?.$disconnect();
    if (admin) {
      for (const u of [srcUrl, restoreUrl]) await drop(u);
      await admin.$disconnect();
    }
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const short = () => randomUUID().replaceAll("-", "").slice(0, 10);
  async function user(db: PrismaClient) {
    const h = `drill_${short()}`;
    return (await db.user.create({ data: { email: `${h}@example.test`, emailNormalized: `${h}@example.test`, username: h, usernameNormalized: h, displayName: "Tatbikat", passwordHash: "x" } })).id;
  }

  test("şifreli yedek izole kopyaya döner; yedekten sonraki silme kapıda yakalanır ve tekrar uygulanınca kapanır", async () => {
    // ── Kaynak: sentetik içerik. "subject" yedekten SONRA silinecek, "control" hiç silinmeyecek.
    const author = await user(src);
    const subject = await user(src);
    const control = await user(src);
    const category = await src.category.create({ data: { slug: `drill-${short()}`, name: "Tatbikat" } });
    const poll = await src.poll.create({
      data: { publicId: short().slice(0, 12), slug: "tatbikat", authorId: subject, categoryId: category.id, title: "Tatbikat anketi",
        closesAt: new Date("2031-01-01T00:00:00Z"), options: { create: [{ position: 0, label: "Evet" }, { position: 1, label: "Hayır" }] } },
      select: { id: true },
    });
    await src.comment.create({ data: { pollId: poll.id, authorId: subject, body: "Tatbikat yorumu" } });
    await src.session.create({ data: { userId: subject, tokenHash: "a".repeat(64), expiresAt: new Date("2031-01-01T00:00:00Z") } });
    await src.comment.create({ data: { pollId: poll.id, authorId: control, body: "Kontrol yorumu" } });
    void author;

    // ── 1. Yedek + manifest; 2. zarf şifreleme. Düz döküm şifrelemeden sonra silinir (sunucuda yalnız .enc kalır).
    const { file: dump, manifest } = await backup(srcUrl, dir);
    assert.ok(manifest.invariants.every((i) => i.violations === 0), JSON.stringify(manifest.invariants));
    const enc = path.join(dir, "drill.dump.enc");
    await encryptFile(dump, enc, publicKey);
    await rm(dump);
    assert.notEqual((await readFile(enc)).subarray(0, 6).toString("ascii"), "PGDMP\n");

    // ── Yedekten SONRA canlı tarafta silme: subject anonimleştirilir (silme günlüğü yalnız kimlik taşır).
    const store = createPrismaAccountErasureStore(src);
    const erased = await store.anonymize({ userId: subject, actorId: subject, self: true, requestId: randomUUID(), reason: "tatbikat", confirmUsername: "", now: new Date() });
    assert.equal(erased.kind, "anonymized");
    const journal = [subject];

    // ── Negatif: yanlış anahtar, kesik ve değiştirilmiş dosya; hiçbirinde hedef adla düz metin bırakılmaz.
    // Çözülen döküm, manifestin (`<döküm>.manifest.json`) yanına özgün adıyla döner; restore manifesti oradan okur.
    const out = dump;
    await assert.rejects(decryptFile(enc, out, other.privateKey));
    const cut = path.join(dir, "cut.dump.enc");
    await writeFile(cut, await readFile(enc));
    await truncate(cut, (await readFile(cut)).length - 40);
    await assert.rejects(decryptFile(cut, out, privateKey));
    const flipped = path.join(dir, "flipped.dump.enc");
    const bytes = await readFile(enc);
    bytes[bytes.length - 100] ^= 0xff;
    await writeFile(flipped, bytes);
    await assert.rejects(decryptFile(flipped, out, privateKey), "GCM etiketi değişikliği yakalar");
    await assert.rejects(access(out), "doğrulanmamış düz metin hedef adla görünmez");
    assert.deepEqual((await readdir(dir)).filter((f) => f.startsWith(".kv-decrypt-")), [], "geçici çözme klasörü kalmaz");

    // ── Negatif: restore hedefi yalnız yerel ve karantina adlı olabilir; canlı DB'yi gösteremez.
    assert.throws(() => gate.assertIsolatedRestoreTarget(srcUrl, srcUrl), /restore_db_not_quarantined|restore_points_to_live_db/);
    assert.throws(() => gate.assertIsolatedRestoreTarget(restoreUrl.replace(/@[^/]+\//, "@db.example.test:5432/"), srcUrl), /restore_not_local_isolated/);
    assert.throws(() => gate.assertIsolatedRestoreTarget(undefined, srcUrl), /missing_quarantined_restore_url/);
    gate.assertIsolatedRestoreTarget(restoreUrl, srcUrl);

    // ── 3. Çöz → boş izole hedefe restore → manifestle birebir.
    await decryptFile(enc, out, privateKey);
    const report = await restore(out, restoreUrl);
    assert.deepEqual(report.diffs, []);
    assert.ok(report.ok, JSON.stringify(report));
    await assert.rejects(restore(out, restoreUrl), /boş değil/, "dolu hedefe ikinci restore reddedilir");

    // ── 4. Migration kapısı: restore edilen şema repodaki migration'larla aynı.
    const migrations = await migrationGate(restoreUrl);
    assert.ok(migrations.ok, JSON.stringify(migrations));
    assert.deepEqual(migrations.pending, []);

    const restored = createPrismaClient(restoreUrl);
    try {
      // ── 5. Kapı: yedek silmeden önceydi → subject kişisel verisiyle geri geldi (exit 2 durumu).
      const first = await gate.checkNoResurrection(restored, journal);
      assert.equal(first.noResurrection, false);
      assert.equal(first.resurrected.liveUsers, 1);
      assert.equal(first.resurrected.sessions, 1);
      assert.ok(first.resurrected.liveAuthoredComments >= 1);
      const back = await restored.user.findUniqueOrThrow({ where: { id: subject }, select: { email: true, deletedAt: true } });
      assert.equal(back.deletedAt, null);
      assert.match(back.email, /^drill_/, "restore edilen kopya silinmiş kişinin e-postasını taşıyor: trafiğe açılamaz");

      // ── 6. KV-48 7. adım: günlükteki kimlikler restore edilen kopyada yeniden anonimleştirilir.
      const replay = await createPrismaAccountErasureStore(restored).anonymize({ userId: subject, actorId: subject, self: true, requestId: randomUUID(), reason: "restore sonrası yeniden uygulama (KV-48)", confirmUsername: "", now: new Date() });
      assert.equal(replay.kind, "anonymized");
      const again = await createPrismaAccountErasureStore(restored).anonymize({ userId: subject, actorId: subject, self: true, requestId: randomUUID(), reason: "tekrar", confirmUsername: "", now: new Date() });
      assert.equal(again.kind, "unchanged", "tekrar uygulama idempotent");

      // ── 7. Kapı tekrar: dirilen veri yok; kalan yalnız #321'in bilinçli tombstone'ları (exit 3, hâlâ NO-GO).
      const second = await gate.checkNoResurrection(restored, journal);
      assert.equal(second.noResurrection, true, JSON.stringify(second.resurrected));
      assert.equal(second.safe, false);
      assert.equal(second.retained.restoredUsers, 1);
      const tomb = await restored.user.findUniqueOrThrow({ where: { id: subject }, select: { email: true, deletedAt: true } });
      assert.ok(tomb.deletedAt);
      assert.match(tomb.email, /@anonim\.invalid$/);

      // Silinmeyen kişi etkilenmez.
      assert.equal(await restored.comment.count({ where: { authorId: control, deletedAt: null } }), 1);
      assert.equal((await gate.checkNoResurrection(restored, [control])).noResurrection, false, "kontrol: günlükte olmayan kimlik canlı");

      // ── Negatif: eski şema (bir migration eksik) → migration kapısı kapanır, eksik adı raporlar.
      const [last] = await restored.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 1`;
      await restored.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = ${last!.migration_name}`;
      const stale = await migrationGate(restoreUrl);
      assert.equal(stale.ok, false);
      assert.deepEqual(stale.pending, [last!.migration_name]);
    } finally {
      await restored.$disconnect();
    }
  });
});

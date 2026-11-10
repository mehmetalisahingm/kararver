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
 * Hedefler bağlantıdan ÖNCE doğrulanır (yerel host, sorgusuz URL, "_test" taban adı, güvenli identifier) ve
 * çalışmaya özel adlar alır: "<test>_drill_<run>_src" / "<test>_drill_<run>_restore". Yalnız bu çalışmanın
 * oluşturduğu veritabanları silinir; önceden var olan bir ad asla düşürülmez.
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
const IDENT = /^[a-z][a-z0-9_]{0,62}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Bağlantıdan ve her türlü DROP/CREATE'ten ÖNCE çalışır; hata = hiç bağlantı yok.
 * Uzak host, host yönlendiren sorgu parametreleri (?host=, ?options=), _test olmayan taban ve SQL'e
 * güvenle gömülemeyen adlar reddedilir. Adlar çalışmaya özeldir.
 */
function planDrill(rawUrl: string, runId: string) {
  const url = new URL(rawUrl);
  if (!["postgresql:", "postgres:"].includes(url.protocol)) throw new Error("drill_not_postgres");
  if (!LOCAL_HOSTS.has(url.hostname)) throw new Error("drill_not_local");
  if (url.search || url.hash) throw new Error("drill_url_query_not_allowed");
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!IDENT.test(name) || !name.endsWith("_test")) throw new Error("drill_base_not_test");
  if (!/^[0-9a-f]{8}$/.test(runId)) throw new Error("drill_run_id_invalid");
  const src = `${name}_drill_${runId}_src`;
  const restore = `${name}_drill_${runId}_restore`;
  if (![src, restore].every((n) => IDENT.test(n))) throw new Error("drill_name_invalid");
  return { adminUrl: withDatabase(rawUrl, "postgres"), src, restore, srcUrl: withDatabase(rawUrl, src), restoreUrl: withDatabase(rawUrl, restore) };
}

/** Doğrulama geçmeden bağlantı fabrikası hiç çağrılmaz. */
function openDrill<T>(rawUrl: string, runId: string, connect: (adminUrl: string) => T) {
  const plan = planDrill(rawUrl, runId);
  return { plan, admin: connect(plan.adminUrl) };
}

describe("tatbikat hedef koruması (bağlantısız)", () => {
  const ok = "postgresql://u:p@127.0.0.1:5432/kararver_ci_test";
  test("uzak, yönlendirilmiş, _test olmayan veya kaçışsız hedefte bağlantı fabrikası hiç çağrılmaz", () => {
    let connects = 0;
    const connect = () => { connects++; return null; };
    const bad: [string, RegExp][] = [
      ["postgresql://u:p@db.example.test:5432/kararver_test", /drill_not_local/],
      ["postgresql://u:p@10.0.0.5:5432/kararver_test", /drill_not_local/],
      ["postgresql://u:p@127.0.0.1:5432/kararver_test?host=db.example.test", /drill_url_query_not_allowed/],
      ["postgresql://u:p@127.0.0.1:5432/kararver_test?options=-c%20search_path%3Dx", /drill_url_query_not_allowed/],
      ["postgresql://u:p@127.0.0.1:5432/kararver", /drill_base_not_test/],
      ["postgresql://u:p@127.0.0.1:5432/kararver_test%22%3B%20DROP%20DATABASE%20x%3B%20--_test", /drill_base_not_test/],
      ["mysql://u:p@127.0.0.1:5432/kararver_test", /drill_not_postgres/],
    ];
    for (const [url, err] of bad) assert.throws(() => openDrill(url, "0123abcd", connect), err, url);
    assert.throws(() => openDrill(ok, "x; DROP", connect), /drill_run_id_invalid/);
    assert.equal(connects, 0, "reddedilen hiçbir hedefe bağlanılmadı");
    const { plan } = openDrill(ok, "0123abcd", connect);
    assert.equal(connects, 1);
    assert.equal(plan.src, "kararver_ci_test_drill_0123abcd_src");
    assert.equal(plan.restore, "kararver_ci_test_drill_0123abcd_restore");
  });
});

const base = baseUrl();
const major = base ? toolMajor() : null;
const skip = base === null ? "TEST_DATABASE_URL yok (CI'da çalışır)"
  : major === null ? "pg_dump bulunamadı (PG_BIN)"
  : major < 17 ? `pg_dump ${major} sunucudan eski (17 gerekir)` : false;

describe("izole restore tatbikatı: yedek → şifre → restore → kapılar → silme tekrarı (postgres)", { skip }, () => {
  const runId = randomUUID().replaceAll("-", "").slice(0, 8);
  let srcUrl = "";
  let restoreUrl = "";
  let plan: ReturnType<typeof planDrill>;
  /** Yalnız bu çalışmanın oluşturduğu veritabanları; cleanup başka hiçbir adı düşürmez. */
  const owned = new Set<string>();
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const other = generateKeyPairSync("rsa", { modulusLength: 3072, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  let admin: PrismaClient;
  let src: PrismaClient;
  let dir: string;
  let gate: GateModule;

  const exists = async (name: string) =>
    (await admin.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_database WHERE datname = ${name}`)[0]!.n > 0;
  /** Önceden var olan adı sahiplenmez: CREATE başarısızsa iz bırakmadan reddeder. */
  async function createOwned(name: string) {
    assert.ok(IDENT.test(name));
    if (await exists(name)) throw new Error("drill_target_exists");
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    owned.add(name);
  }

  before(async () => {
    // Doğrulama ilk bağlantıdan önce; reddedilirse hiçbir şey açılmaz/silinmez.
    ({ plan, admin } = openDrill(base!, runId, (url) => createPrismaClient(url)));
    ({ srcUrl, restoreUrl } = plan);
    gate = (await import(gatePath)) as GateModule;
    assert.equal(await exists(plan.restore), false, "çalışmaya özel restore hedefi önceden yok");
    await createOwned(plan.src);
    const prismaCli = createRequire(path.join(dbPackage, "package.json")).resolve("prisma/build/index.js");
    const r = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: dbPackage, env: { ...process.env, DATABASE_URL: srcUrl }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    src = createPrismaClient(srcUrl);
    dir = await mkdtemp(path.join(os.tmpdir(), "kv375-"));
  });

  after(async () => {
    await src?.$disconnect();
    if (admin) {
      for (const name of owned) if (IDENT.test(name)) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
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
    owned.add(plan.restore);
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

  test("önceden var olan hedef adı sahiplenilmez ve cleanup onu düşürmez", async () => {
    const foreign = `${plan.src.replace(/_src$/, "")}_foreign_restore`;
    assert.ok(IDENT.test(foreign));
    await admin.$executeRawUnsafe(`CREATE DATABASE "${foreign}"`);
    try {
      await assert.rejects(createOwned(foreign), /drill_target_exists/);
      assert.equal(owned.has(foreign), false);
      assert.equal(await exists(foreign), true, "var olan veritabanı silinmedi");
    } finally {
      // Bu test kendi oluşturduğu yabancı veritabanını kendisi kaldırır; tatbikat cleanup'ı ona dokunmaz.
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${foreign}" WITH (FORCE)`);
    }
  });
});

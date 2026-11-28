/**
 * #301 — açılış migration kapısı (ops/migration-gate.ts) ve başlatıcının fail-closed davranışı.
 * - Birim: karar kuralları (bekleyen, yarım kalmış, bilinmeyen/rollback).
 * - PostgreSQL (TEST_DATABASE_URL yoksa atlanır): "<test>_gate" veritabanında boş şema, tam migration, eksik ve yarım
 *   migration durumları; başlatıcı (scripts/start-api-with-worker.mjs) kapı geçmezse API/worker'ı hiç başlatmaz.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { evaluateGate, expectedMigrations, migrationGate } from "../ops/migration-gate.ts";
import { withDatabase } from "../ops/pg-tools.ts";
import { createPrismaClient, type PrismaClient } from "../src/index.ts";

const packageDir = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageDir, "../..");

describe("migration kapısı kararı", () => {
  const expected = ["20260101000000_a", "20260102000000_b"];
  const done = (name: string) => ({ name, finished: true, rolledBack: false });

  test("hepsi uygulanmış → başlayabilir", () => {
    const r = evaluateGate(expected, expected.map(done));
    assert.deepEqual([r.ok, r.pending, r.failed, r.unknown], [true, [], [], []]);
  });
  test("bekleyen migration → başlamaz", () => {
    const r = evaluateGate(expected, [done(expected[0]!)]);
    assert.deepEqual([r.ok, r.pending], [false, ["20260102000000_b"]]);
  });
  test("yarım kalmış migration → başlamaz; geri alınmış (rolled back) satır yarım sayılmaz", () => {
    const failed = { name: expected[1]!, finished: false, rolledBack: false };
    assert.deepEqual(evaluateGate(expected, [done(expected[0]!), failed]).failed, ["20260102000000_b"]);
    const resolved = { name: expected[1]!, finished: false, rolledBack: true };
    const r = evaluateGate(expected, [done(expected[0]!), resolved, done(expected[1]!)]);
    assert.equal(r.ok, true, "resolve --rolled-back + yeniden uygulama");
  });
  test("bu sürümde olmayan uygulanmış migration (rollback) → başlar, bilinmeyen olarak raporlanır", () => {
    const r = evaluateGate(expected, [...expected.map(done), done("20260103000000_c")]);
    assert.deepEqual([r.ok, r.unknown], [true, ["20260103000000_c"]]);
  });
  test("repodaki migration listesi: yalnız zaman damgalı klasörler, sıralı", async () => {
    const list = await expectedMigrations();
    assert.ok(list.length >= 53);
    assert.deepEqual(list, [...list].sort());
    assert.ok(list.every((m) => /^\d{14}_/.test(m)));
  });
});

const base = process.env.TEST_DATABASE_URL ?? null;

describe("migration kapısı ve başlatıcı (postgres)", { skip: base === null ? "TEST_DATABASE_URL yok (CI'da çalışır)" : false }, () => {
  const baseName = base ? decodeURIComponent(new URL(base).pathname.slice(1)) : "";
  const url = base ? withDatabase(base, `${baseName}_gate`) : "";
  let admin: PrismaClient;
  let db: PrismaClient;

  const migrate = () => {
    const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
    const r = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: packageDir, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  };
  const launch = () =>
    spawnSync(process.execPath, [path.join(repoRoot, "scripts/start-api-with-worker.mjs")], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
      timeout: 90_000,
    });

  before(async () => {
    assert.ok(baseName.endsWith("_test"), "test yalnız _test veritabanının yanında çalışır");
    admin = createPrismaClient(withDatabase(base!, "postgres"));
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${baseName}_gate" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${baseName}_gate"`);
  });
  after(async () => {
    await db?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${baseName}_gate" WITH (FORCE)`);
      await admin.$disconnect();
    }
  });

  test("boş veritabanı: kapı geçmez ve başlatıcı API/worker'ı hiç başlatmaz", async () => {
    const r = await migrationGate(url);
    assert.equal(r.ok, false);
    assert.equal(r.applied, 0);
    assert.equal(r.pending.length, r.expected);
    const run = launch();
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /UYGULANMAMIŞ migration/);
    assert.match(run.stderr, /api and worker NOT started/);
    assert.doesNotMatch(run.stderr, /starting api|starting worker/);
  });

  test("bütün migration'lar uygulanınca kapı geçer; kapı hiçbir şey yazmaz", async () => {
    migrate();
    db = createPrismaClient(url);
    const before = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM _prisma_migrations`);
    const r = await migrationGate(url);
    assert.deepEqual([r.ok, r.pending, r.failed], [true, [], []]);
    assert.equal(r.applied, r.expected);
    assert.deepEqual(await db.$queryRawUnsafe(`SELECT count(*) AS n FROM _prisma_migrations`), before);
  });

  test("son migration eksik (yeni sürüm, migration uygulanmamış) → başlamaz", async () => {
    const [last] = await db.$queryRawUnsafe<{ id: string; migration_name: string }[]>(
      `SELECT id, migration_name FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 1`,
    );
    await db.$executeRawUnsafe(`UPDATE _prisma_migrations SET migration_name = migration_name || '_hidden' WHERE id = $1`, last!.id);
    try {
      const r = await migrationGate(url);
      assert.deepEqual([r.ok, r.pending], [false, [last!.migration_name]]);
      assert.deepEqual(r.unknown, [`${last!.migration_name}_hidden`]);
      const run = launch();
      assert.equal(run.status, 1);
      assert.doesNotMatch(run.stderr, /starting api/);
    } finally {
      await db.$executeRawUnsafe(`UPDATE _prisma_migrations SET migration_name = $1 WHERE id = $2`, last!.migration_name, last!.id);
    }
  });

  test("yarım kalmış migration → başlamaz; veritabanına ulaşılamazsa → başlamaz", async () => {
    await db.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count) VALUES (gen_random_uuid()::text, 'x', '20991231000000_yarim', now(), 0)`,
    );
    try {
      const r = await migrationGate(url);
      assert.deepEqual([r.ok, r.failed], [false, ["20991231000000_yarim"]]);
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM _prisma_migrations WHERE migration_name = '20991231000000_yarim'`);
    }
    const unreachable = new URL(url);
    unreachable.port = "1";
    await assert.rejects(migrationGate(unreachable.toString(), { timeoutMs: 5_000 }));
  });
});

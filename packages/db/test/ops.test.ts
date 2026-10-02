/**
 * KV-48 (#50) yedek/restore araçları.
 * - Birim: yıkıcı migration denetimi, durum karşılaştırması, bağlantı ortamı.
 * - Uçtan uca (PostgreSQL + pg_dump/pg_restore 17 gerekir; yoksa atlanır): migration'lı bir kaynak DB'yi eşzamanlı
 *   yazım altında yedekler, boş hedefe geri yükler ve manifestle birebir doğrular. Kaynak ve hedef, test
 *   veritabanının adından türetilen "<test>_opssrc" / "<test>_opsdst" veritabanlarıdır; her koşuda silinip açılır.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { backup } from "../ops/backup.ts";
import { approval, checkMigrations, CUTOFF, findDestructive, transactional } from "../ops/check-migrations.ts";
import { pgEnv, pgTool, redact, withDatabase } from "../ops/pg-tools.ts";
import { restore } from "../ops/restore.ts";
import { checkInvariants, collectState, compareState, type DbState } from "../ops/state.ts";
import { createPrismaClient, type PrismaClient } from "../src/index.ts";

const packageDir = path.resolve(import.meta.dirname, "..");

describe("yıkıcı migration denetimi", () => {
  test("veri silen ve eski sürümü kıran ifadeleri satırıyla bulur", () => {
    const sql = [
      'ALTER TABLE "polls" DROP COLUMN "legacy";',
      'ALTER TABLE "votes" ALTER COLUMN "change_count" SET DATA TYPE BIGINT;',
      'ALTER TABLE "users" ALTER COLUMN "bio" SET NOT NULL;',
      'ALTER TABLE "polls" RENAME COLUMN "title" TO "question";',
      'ALTER TABLE "polls" ADD COLUMN "region" VARCHAR(10) NOT NULL;',
      "DELETE FROM sessions;",
      'DROP TABLE "comment_likes";',
    ].join("\n");
    assert.deepEqual(
      findDestructive(sql).map((f) => [f.line, f.rule]),
      [
        [1, "DROP COLUMN"],
        [2, "ALTER COLUMN ... TYPE"],
        [3, "SET NOT NULL"],
        [4, "RENAME"],
        [5, "ADD COLUMN NOT NULL (varsayılansız)"],
        [6, "DELETE FROM"],
        [7, "DROP TABLE"],
      ],
    );
  });

  test("güvenli ifadeler, yorumlar ve fonksiyon gövdeleri bulgu değildir", () => {
    const sql = `
-- DROP TABLE eskiden buradaydı
ALTER TABLE "polls" ADD COLUMN "region" VARCHAR(10) NOT NULL DEFAULT 'TR', ADD COLUMN "note" TEXT;
ALTER TABLE "polls" ALTER COLUMN "closes_at" DROP NOT NULL;
CREATE INDEX "x" ON "polls"("region");
/* TRUNCATE yok */
CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM sessions WHERE false;
  RAISE EXCEPTION 'RENAME';
END $$;
CREATE TRIGGER t BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION f();`;
    assert.deepEqual(findDestructive(sql), []);
  });

  test("onay satırı gerekçe ister", () => {
    assert.equal(approval("-- kv:destructive eski kolon PR #120'den beri okunmuyor\nDROP ..."), "eski kolon PR #120'den beri okunmuyor");
    assert.equal(approval("-- kv:destructive kısa"), null);
    assert.equal(approval("DROP TABLE x; -- kv:destructive yorum satır başında değil"), null);
  });

  test("CUTOFF sonrası migration'lar ve onay akışı", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kv48-mig-"));
    try {
      const mk = async (name: string, sql: string) => {
        await mkdir(path.join(dir, name));
        await writeFile(path.join(dir, name, "migration.sql"), sql);
      };
      await mk(`${CUTOFF}_eski`, "DROP TABLE a;");
      await mk("20991231000000_onaysiz", "ALTER TABLE b DROP COLUMN c;");
      await mk("20991231000001_onayli", "-- kv:destructive c kolonu iki sürümdür okunmuyor\nALTER TABLE b DROP COLUMN c;");
      await mk("20991231000002_temiz", "-- açıklama\nBEGIN;\nCREATE TABLE d (id int);\nCOMMIT;\n");
      await mk("20991231000003_sarilmamis", "CREATE TABLE e (id int);");
      const report = await checkMigrations(dir);
      assert.deepEqual(
        report.map((r) => [r.migration, r.findings.length > 0, r.approvedBy !== null]),
        [
          ["20991231000000_onaysiz", true, false],
          ["20991231000001_onayli", true, true],
          ["20991231000003_sarilmamis", false, false],
        ],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("repodaki yeni migration'larda onaysız yıkıcı değişiklik yok", async () => {
    const report = await checkMigrations(path.join(packageDir, "prisma/migrations"));
    assert.deepEqual(report.filter((r) => r.findings.length > 0 && !r.approvedBy).map((r) => r.migration), []);
  });

  test("transaction sarmalı: BEGIN/COMMIT veya gerekçeli istisna", () => {
    assert.equal(transactional("-- KV-99\nBEGIN;\nCREATE TABLE a (id int);\nCOMMIT;\n"), true);
    assert.equal(transactional("CREATE TABLE a (id int);"), false);
    assert.equal(transactional("BEGIN;\nCREATE TABLE a (id int);"), false);
    assert.equal(transactional("-- kv:no-transaction CREATE INDEX CONCURRENTLY transaction içinde çalışmaz\nCREATE INDEX CONCURRENTLY x ON a(id);"), true);
  });
});

describe("durum karşılaştırması ve bağlantı", () => {
  const base: DbState = {
    migrations: ["a", "b"],
    rows: { polls: 3, votes: 10 },
    catalog: { triggers: ["votes.t enabled=O"], constraints: ["c"], indexes: ["i"], functions: ["f() md5=1"], extensions: ["unaccent@1.1"] },
  };

  test("aynı özet fark üretmez; eksik/fazla/değişmiş her parça raporlanır", () => {
    assert.deepEqual(compareState(base, structuredClone(base)), []);
    const changed: DbState = {
      migrations: ["a"],
      rows: { polls: 3, votes: 9, extra: 0 },
      catalog: { ...base.catalog, triggers: ["votes.t enabled=D"], functions: ["f() md5=2"] },
    };
    assert.deepEqual(compareState(base, changed), [
      "migration: eksik b",
      "satır: votes beklenen 10, bulunan 9",
      "satır: extra beklenen tablo yok, bulunan 0",
      "triggers: eksik votes.t enabled=O",
      "triggers: fazla votes.t enabled=D",
      "functions: eksik f() md5=1",
      "functions: fazla f() md5=2",
    ]);
  });

  test("parola ortam değişkeniyle geçer, loglarda gizlenir", () => {
    const url = "postgresql://kararver:p%40ss%3Aw@db.example:6543/kararver?sslmode=require";
    assert.deepEqual(pgEnv(url), {
      PGHOST: "db.example",
      PGPORT: "6543",
      PGDATABASE: "kararver",
      PGUSER: "kararver",
      PGPASSWORD: "p@ss:w",
      PGSSLMODE: "require",
    });
    assert.equal(redact(url), "postgresql://kararver:***@db.example:6543/kararver?sslmode=require");
    assert.equal(new URL(withDatabase(url, "postgres")).pathname, "/postgres");
  });
});

// ─── Uçtan uca ────────────────────────────────────────────────

function testUrl(): string | null {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(path.resolve(packageDir, "../../.env"));
    } catch {}
  }
  if (!process.env.DATABASE_URL) return null;
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `${url.pathname.replace(/^\//, "")}_test`;
  return url.toString();
}

function toolMajor(): number | null {
  const r = spawnSync(pgTool("pg_dump"), ["--version"], { encoding: "utf8" });
  const m = r.stdout?.match(/(\d+)\.\d+/);
  return r.status === 0 && m ? Number(m[1]) : null;
}

const base = testUrl();
const major = toolMajor();
const skip =
  base === null
    ? "TEST_DATABASE_URL yok (CI'da çalışır)"
    : major === null
      ? "pg_dump bulunamadı (PG_BIN ile PostgreSQL 17 istemci araçları verilebilir)"
      : major < 17
        ? `pg_dump ${major} sunucudan eski (17 gerekir)`
        : false;

describe("yedek → boş hedefe restore → doğrulama (postgres)", { skip }, () => {
  const baseName = base ? decodeURIComponent(new URL(base).pathname.slice(1)) : "";
  const srcUrl = base ? withDatabase(base, `${baseName}_opssrc`) : "";
  const dstUrl = base ? withDatabase(base, `${baseName}_opsdst`) : "";
  const dst2Url = base ? withDatabase(base, `${baseName}_opsdst2`) : "";
  let admin: PrismaClient;
  let src: PrismaClient;
  let dir: string;

  async function drop(url: string) {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${decodeURIComponent(new URL(url).pathname.slice(1))}" WITH (FORCE)`);
  }

  before(async () => {
    assert.ok(baseName.endsWith("_test"), "uçtan uca test yalnız _test veritabanının yanında çalışır");
    admin = createPrismaClient(withDatabase(base!, "postgres"));
    for (const u of [srcUrl, dstUrl, dst2Url]) await drop(u);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${baseName}_opssrc"`);
    const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
    const r = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: packageDir,
      env: { ...process.env, DATABASE_URL: srcUrl },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    src = createPrismaClient(srcUrl);
    dir = await mkdtemp(path.join(os.tmpdir(), "kv48-"));
  });

  after(async () => {
    await src?.$disconnect();
    if (admin) {
      for (const u of [srcUrl, dstUrl, dst2Url]) await drop(u);
      await admin.$disconnect();
    }
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const id = () => randomUUID();
  const short = () => randomUUID().replaceAll("-", "").slice(0, 10);

  async function user(): Promise<string> {
    const u = id();
    const h = `u_${short()}`;
    await src.$executeRaw`
      INSERT INTO users (id, email, email_normalized, username, username_normalized, display_name, password_hash, updated_at)
      VALUES (${u}::uuid, ${h + "@test.local"}, ${h + "@test.local"}, ${h}, ${h}, ${h}, 'x', now())`;
    return u;
  }

  async function vote(pollId: string, optionId: string, userId: string) {
    const voteId = id();
    await src.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO votes (id, poll_id, option_id, user_id, updated_at)
        VALUES (${voteId}::uuid, ${pollId}::uuid, ${optionId}::uuid, ${userId}::uuid, now())`;
      await tx.$executeRaw`INSERT INTO vote_events (id, vote_id, poll_id, user_id, type, to_option_id)
        VALUES (${id()}::uuid, ${voteId}::uuid, ${pollId}::uuid, ${userId}::uuid, 'CAST', ${optionId}::uuid)`;
      await tx.$executeRaw`UPDATE poll_options SET vote_count = vote_count + 1 WHERE id = ${optionId}::uuid`;
      await tx.$executeRaw`UPDATE polls SET vote_count = vote_count + 1 WHERE id = ${pollId}::uuid`;
    });
  }

  test("eşzamanlı oy yazımı altında alınan yedek manifestle birebir geri gelir; yanlış hedefler reddedilir", async () => {
    const categoryId = id();
    await src.$executeRaw`INSERT INTO categories (id, slug, name, updated_at) VALUES (${categoryId}::uuid, 'kv48', 'KV-48', now())`;
    const author = await user();
    const pollId = id();
    await src.$executeRaw`
      INSERT INTO polls (id, public_id, slug, author_id, category_id, title, description, opens_at, closes_at, updated_at)
      VALUES (${pollId}::uuid, ${short()}, 'kv48', ${author}::uuid, ${categoryId}::uuid, 'Yedek testi?', 'açıklama',
              now() - interval '1 hour', now() + interval '1 day', now())`;
    const options = [id(), id()];
    for (const [i, o] of options.entries()) {
      await src.$executeRaw`INSERT INTO poll_options (id, poll_id, position, label) VALUES (${o}::uuid, ${pollId}::uuid, ${i}, ${"S" + i})`;
    }
    for (let i = 0; i < 5; i++) await vote(pollId, options[i % 2]!, await user());

    // Yedek sürerken yeni oylar yazılır: manifest ile döküm aynı snapshot'tan olmalı.
    let writing = true;
    let written = 0;
    const writer = (async () => {
      while (writing) {
        await vote(pollId, options[written % 2]!, await user());
        written++;
      }
    })();
    const { file, manifest } = await backup(srcUrl, dir).finally(() => (writing = false));
    await writer;
    assert.ok(written > 0, "yedek sırasında yazım oldu");
    assert.ok(manifest.invariants.length >= 5 && manifest.invariants.every((i) => i.violations === 0), JSON.stringify(manifest.invariants));
    assert.ok(manifest.state.rows.votes! >= 5);
    assert.ok(manifest.state.catalog.triggers.some((t) => t.startsWith("vote_events.vote_events_append_only")));
    assert.doesNotMatch(JSON.stringify(manifest), /kararver_local/, "manifestte parola yok");

    const report = await restore(file, dstUrl, { jobs: 2 });
    assert.deepEqual(report.diffs, []);
    assert.ok(report.ok, JSON.stringify(report));
    const dst = createPrismaClient(dstUrl);
    try {
      const [{ n }] = await dst.$queryRaw<{ n: number }[]>`SELECT vote_count AS n FROM polls WHERE id = ${pollId}::uuid`;
      assert.equal(n, manifest.state.rows.votes, "sayaç, yedeğin anındaki oy sayısı");

      // Dolu hedefe ikinci restore reddedilir.
      await assert.rejects(restore(file, dstUrl), /boş değil/);

      // Restore edilmiş veride bozulma ve kapatılmış trigger yakalanır.
      await dst.$executeRaw`UPDATE poll_options SET vote_count = vote_count + 7 WHERE id = ${options[0]}::uuid`;
      await dst.$executeRawUnsafe(`ALTER TABLE vote_events DISABLE TRIGGER vote_events_append_only`);
      const inv = Object.fromEntries((await checkInvariants(dst)).map((i) => [i.name, i.violations]));
      assert.equal(inv["poll_options.vote_count = seçeneğin geçerli oy sayısı"], 1);
      assert.equal(inv["trigger'ların hepsi etkin"], 1);
      assert.ok(compareState(manifest.state, await collectState(dst)).some((d) => d.startsWith("triggers: fazla vote_events.vote_events_append_only enabled=D")));
    } finally {
      await dst.$disconnect();
    }

    // Bozuk dosya restore edilmez; hedef oluşturulmaz.
    const bytes = await readFile(file);
    bytes[bytes.length - 10] ^= 0xff;
    await writeFile(file, bytes);
    await assert.rejects(restore(file, dst2Url), /sha256/);
    const [{ n }] = await admin.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_database WHERE datname = ${baseName + "_opsdst2"}`;
    assert.equal(n, 0);
  });
});

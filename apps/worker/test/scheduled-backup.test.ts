// KV-48 / #51 zamanlanmış yedek: zarf şifreleme, yükleme/kayıt sırası ve gerçek pg_dump ile uçtan uca.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import type { Manifest } from "@kararver/db/ops/backup";
import { decryptFile, encryptFile } from "../src/jobs/backup/envelope.ts";
import { runScheduledBackup, type ScheduledBackupDeps } from "../src/jobs/backup/scheduled.ts";
import { migratedClient, testDatabaseUrl } from "./support/db.ts";

const keys = (bits = 3072) =>
  generateKeyPairSync("rsa", { modulusLength: bits, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const { publicKey, privateKey } = keys();
const sha256 = async (file: string) => createHash("sha256").update(await readFile(file)).digest("hex");

let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "kv-backup-test-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("yedek zarf şifrelemesi", () => {
  test("şifrele → çöz birebir aynı; şifreli dosyada düz metin yok", async () => {
    const plain = path.join(dir, "a.dump");
    // pg_dump custom biçimi "PGDMP" ile başlar; şifreli dosyada görünmemeli.
    await writeFile(plain, Buffer.concat([Buffer.from("PGDMP"), randomBytes(512 * 1024), Buffer.from("kisisel@example.test")]));
    await encryptFile(plain, `${plain}.enc`, publicKey);
    const enc = await readFile(`${plain}.enc`);
    assert.ok(enc.subarray(0, 6).equals(Buffer.from("KVBK1\n")));
    assert.ok(!enc.includes(Buffer.from("PGDMP")) && !enc.includes(Buffer.from("kisisel@example.test")));
    await decryptFile(`${plain}.enc`, `${plain}.out`, privateKey);
    assert.equal(await sha256(`${plain}.out`), await sha256(plain));
  });

  test("değiştirilmiş ya da kesik dosya, yanlış anahtar ve zayıf anahtar reddedilir", async () => {
    const plain = path.join(dir, "b.dump");
    await writeFile(plain, randomBytes(64 * 1024));
    await encryptFile(plain, `${plain}.enc`, publicKey);
    const enc = await readFile(`${plain}.enc`);
    const tampered = Buffer.from(enc);
    tampered[tampered.length - 100]! ^= 0xff;
    await writeFile(`${plain}.bad`, tampered);
    await assert.rejects(decryptFile(`${plain}.bad`, `${plain}.bad.out`, privateKey));
    await writeFile(`${plain}.cut`, enc.subarray(0, 40));
    await assert.rejects(decryptFile(`${plain}.cut`, `${plain}.cut.out`, privateKey), /kesik|geçersiz/);
    await assert.rejects(decryptFile(`${plain}.enc`, `${plain}.wrong.out`, keys().privateKey));
    await assert.rejects(encryptFile(plain, `${plain}.weak`, keys(2048).publicKey), /en az 3072/);
    await assert.rejects(decryptFile(plain, `${plain}.raw.out`, privateKey), /şifreli yedek değil/);
  });
});

describe("zamanlanmış yedek işi", () => {
  const manifestFor = (file: string, sha: string, size: number): Manifest =>
    ({ createdAt: "2026-10-16T00:30:00.000Z", sha256: sha, sizeBytes: size, dumpMs: 10, serverVersion: "17.10", file: path.basename(file) }) as Manifest;

  function deps(overrides: Partial<ScheduledBackupDeps> = {}) {
    const uploads: { key: string; type: string; copy: string }[] = [];
    const records: { destination: string; sha: string }[] = [];
    const logs: string[] = [];
    const d: ScheduledBackupDeps = {
      databaseUrl: "postgresql://kv:gizli-parola@db.internal:5432/kararver",
      publicKeyPem: publicKey,
      destination: "r2",
      prefix: "db/test",
      now: () => new Date("2026-10-16T00:30:00.000Z"),
      log: (level, message, fields) => void logs.push(JSON.stringify({ level, message, ...fields })),
      backup: async (_url, out) => {
        const file = path.join(out, "kararver-kararver-20261016T003000Z.dump");
        await writeFile(file, Buffer.concat([Buffer.from("PGDMP"), randomBytes(4096)]));
        await writeFile(`${file}.manifest.json`, "{}");
        const sha = await sha256(file);
        return { file, manifest: manifestFor(file, sha, 4101) };
      },
      upload: async (key, file, type) => {
        const copy = path.join(dir, `up-${uploads.length}-${path.basename(file)}`);
        await copyFile(file, copy);
        uploads.push({ key, type, copy });
      },
      record: async (_url, manifest, destination) => void records.push({ destination, sha: manifest.sha256 }),
      ...overrides,
    };
    return { d, uploads, records, logs };
  }

  test("şifreli döküm ve manifest tarihli anahtarla yüklenir, sonra kayıt yazılır; yerel dosyalar silinir", async () => {
    const { d, uploads, records, logs } = deps();
    const result = await runScheduledBackup(d);
    assert.deepEqual(
      uploads.map((u) => [u.key, u.type]),
      [
        ["db/test/2026/10/16/kararver-kararver-20261016T003000Z.dump.enc", "application/octet-stream"],
        ["db/test/2026/10/16/kararver-kararver-20261016T003000Z.dump.manifest.json", "application/json"],
      ],
    );
    assert.deepEqual(records, [{ destination: "r2", sha: result.manifest.sha256 }]);
    // Yüklenen şifreli döküm, özel anahtarla manifestteki sha256'ya çözülür.
    await decryptFile(uploads[0]!.copy, path.join(dir, "job.out"), privateKey);
    assert.equal(await sha256(path.join(dir, "job.out")), result.manifest.sha256);
    assert.ok(!(await readFile(uploads[0]!.copy)).includes(Buffer.from("PGDMP")), "yüklenen dosya şifreli");
    // Log'da bağlantı adresi ya da parola yok.
    assert.ok(!logs.join("\n").includes("gizli-parola") && !logs.join("\n").includes("db.internal"));
    assert.ok(!(await readdir(tmpdir())).some((n) => n.startsWith("kv-backup-") && existsSync(path.join(tmpdir(), n, "kararver-kararver-20261016T003000Z.dump"))));
  });

  test("yükleme başarısızsa kayıt yazılmaz ve hata yükselir", async () => {
    const { d, records } = deps({ upload: async () => { throw new Error("yedek yüklenemedi (AccessDenied, HTTP 403)"); } });
    await assert.rejects(runScheduledBackup(d), /HTTP 403/);
    assert.deepEqual(records, []);
  });

  test("hedef etiketi ve önek doğrulanır (adres ya da üst klasör kabul edilmez)", async () => {
    await assert.rejects(runScheduledBackup(deps({ destination: "s3://bucket" }).d), /hedefi etiketi/);
    await assert.rejects(runScheduledBackup(deps({ prefix: "db/../x" }).d), /öneki/);
    await assert.rejects(runScheduledBackup(deps({ prefix: "/db" }).d), /öneki/);
  });
});

const url = testDatabaseUrl();
const pgDumpMajor = (() => {
  const exe = process.env.PG_BIN ? path.join(process.env.PG_BIN, process.platform === "win32" ? "pg_dump.exe" : "pg_dump") : "pg_dump";
  const r = spawnSync(exe, ["--version"], { encoding: "utf8" });
  const m = r.stdout?.match(/(\d+)\.\d+/);
  return r.status === 0 && m ? Number(m[1]) : null;
})();
const skip = !url ? "TEST_DATABASE_URL yok (CI'da çalışır)" : pgDumpMajor === null ? "pg_dump bulunamadı (PG_BIN)" : pgDumpMajor < 17 ? `pg_dump ${pgDumpMajor} eski` : false;

describe("zamanlanmış yedek uçtan uca (postgres + pg_dump)", { skip }, () => {
  let db: PrismaClient;
  before(() => {
    db = migratedClient(url!);
  });
  after(async () => {
    await db?.$disconnect();
  });

  test("gerçek döküm şifrelenip yüklenir, ops_backup_runs kaydı yazılır; çözülen döküm manifestle aynı", async () => {
    const uploads: { key: string; copy: string }[] = [];
    const before = await db.opsBackupRun.count();
    const result = await runScheduledBackup({
      databaseUrl: url!,
      publicKeyPem: publicKey,
      destination: "r2",
      prefix: "db/test",
      now: () => new Date(),
      log: () => {},
      upload: async (key, file) => {
        const copy = path.join(dir, `e2e-${uploads.length}`);
        await copyFile(file, copy);
        uploads.push({ key, copy });
      },
    });
    assert.equal(uploads.length, 2);
    await decryptFile(uploads[0]!.copy, path.join(dir, "e2e.dump"), privateKey);
    assert.equal(await sha256(path.join(dir, "e2e.dump")), result.manifest.sha256);
    assert.ok((await readFile(path.join(dir, "e2e.dump"))).subarray(0, 5).equals(Buffer.from("PGDMP")), "çözülen dosya pg_dump custom biçimi");
    const manifest = JSON.parse(await readFile(uploads[1]!.copy, "utf8")) as Manifest;
    assert.equal(manifest.sha256, result.manifest.sha256);
    assert.equal(await db.opsBackupRun.count(), before + 1);
    const row = await db.opsBackupRun.findFirstOrThrow({ where: { sha256: result.manifest.sha256 } });
    assert.equal(row.destination, "r2");
    await db.opsBackupRun.delete({ where: { id: row.id } });
  });
});

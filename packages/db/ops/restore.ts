// KV-48 (#50) — temiz ortama restore ve doğrulama:
//   RESTORE_DATABASE_URL=postgresql://.../kararver_restore pnpm --filter @kararver/db db:restore --file <yedek.dump>
//
// Güvenlik: hedef DATABASE_URL'den ayrı bir değişkendir (yanlışlıkla canlı DB'ye yazılmasın) ve BOŞ olmalıdır.
// Hedef veritabanı yoksa oluşturulur; varsa public şemada tek bir tablo/nesne bile bulunursa restore reddedilir.
// Var olan bir veritabanının üzerine yazma (--clean) bilerek yok: geri dönüş her zaman yeni, boş bir veritabanına
// yapılır, uygulama doğrulamadan sonra ona yönlendirilir (docs/KV-48_BACKUP_RESTORE.md).
//
// Adımlar: manifest ve sha256 kontrolü → pg_restore → durum özeti manifestle birebir karşılaştırılır (migration,
// satır sayıları, trigger/CHECK/index/fonksiyon) → tutarlılık kontrolleri. Fark veya ihlal varsa çıkış kodu 1.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createPrismaClient } from "../src/index.ts";
import { type Manifest, sha256File } from "./backup.ts";
import { databaseName, redact, run, withDatabase } from "./pg-tools.ts";
import { checkInvariants, collectState, compareState, type Invariant } from "./state.ts";

export type RestoreReport = {
  target: string;
  restoreMs: number;
  verifyMs: number;
  diffs: string[];
  invariants: Invariant[];
  ok: boolean;
};

const IDENT = /^[A-Za-z0-9_]{1,63}$/;

/** Hedef yoksa oluşturur; varsa boş olduğunu doğrular. */
async function prepareTarget(target: string): Promise<void> {
  const name = databaseName(target);
  if (!IDENT.test(name)) throw new Error(`hedef veritabanı adı yalnız harf, rakam ve _ içermeli: ${name}`);
  const admin = createPrismaClient(withDatabase(target, "postgres"));
  try {
    const [{ n }] = await admin.$queryRawUnsafe<{ n: number }[]>("SELECT count(*)::int AS n FROM pg_database WHERE datname = $1", name);
    if (n === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      return;
    }
  } finally {
    await admin.$disconnect();
  }
  const db = createPrismaClient(target);
  try {
    const [{ n }] = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'public'`,
    );
    if (n > 0) throw new Error(`hedef veritabanı boş değil (${name}: public şemada ${n} nesne); restore yalnız boş veritabanına yapılır`);
  } finally {
    await db.$disconnect();
  }
}

export async function restore(file: string, target: string, opts: { jobs?: number } = {}): Promise<RestoreReport> {
  const manifest = JSON.parse(await readFile(`${file}.manifest.json`, "utf8")) as Manifest;
  if (manifest.kind !== "kararver-db-backup" || manifest.version !== 1) throw new Error("manifest tanınmadı");
  const sha = await sha256File(file);
  if (sha !== manifest.sha256) throw new Error(`yedek dosyası bozuk: sha256 manifestle uyuşmuyor (${path.basename(file)})`);

  await prepareTarget(target);

  const jobs = opts.jobs ?? 4;
  const started = performance.now();
  // jobs=1: tek transaction (yarıda kalırsa hedef boş kalır). jobs>1: paralel ve daha hızlı; yarıda kalırsa hedef
  // silinip yeniden denenir (hedef zaten yeni bir veritabanıdır).
  const mode = jobs > 1 ? [`--jobs=${jobs}`] : ["--single-transaction"];
  await run("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", ...mode, `--dbname=${databaseName(target)}`, file], target);
  const restoreMs = Math.round(performance.now() - started);

  const verifyStarted = performance.now();
  const db = createPrismaClient(target);
  try {
    // Restore sonrası planlayıcı istatistikleri yoktur; ilk sorgular yavaş olmasın.
    await db.$executeRawUnsafe("ANALYZE");
    const diffs = compareState(manifest.state, await collectState(db));
    const invariants = await checkInvariants(db);
    const verifyMs = Math.round(performance.now() - verifyStarted);
    const ok = diffs.length === 0 && invariants.every((i) => i.violations === 0);
    return { target: redact(target), restoreMs, verifyMs, diffs, invariants, ok };
  } finally {
    await db.$disconnect();
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { file: { type: "string" }, jobs: { type: "string", default: "4" } } });
  const target = process.env.RESTORE_DATABASE_URL;
  if (!values.file) throw new Error("--file <yedek.dump> gerekli");
  if (!target) throw new Error("RESTORE_DATABASE_URL tanımlı değil (hedef, DATABASE_URL'den ayrı ve boş bir veritabanı olmalı)");
  if (process.env.DATABASE_URL && databaseName(process.env.DATABASE_URL) === databaseName(target) && new URL(process.env.DATABASE_URL).host === new URL(target).host) {
    throw new Error("RESTORE_DATABASE_URL, DATABASE_URL ile aynı veritabanı olamaz");
  }
  const report = await restore(path.resolve(values.file), target, { jobs: Number(values.jobs) });
  console.log(`restore: ${report.target}  pg_restore ${report.restoreMs} ms, doğrulama ${report.verifyMs} ms`);
  for (const d of report.diffs) console.error(`  ✖ ${d}`);
  for (const i of report.invariants) console.log(`  ${i.violations === 0 ? "✔" : "✖"} ${i.name}${i.violations ? `: ${i.violations} ihlal` : ""}`);
  console.log(report.ok ? "SONUÇ: yedek eksiksiz ve tutarlı geri yüklendi" : "SONUÇ: restore doğrulanamadı");
  process.exitCode = report.ok ? 0 : 1;
}

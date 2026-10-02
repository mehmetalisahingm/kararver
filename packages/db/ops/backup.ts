// KV-48 (#50) — mantıksal yedek: pnpm --filter @kararver/db db:backup [--out <klasör>]
//
// DATABASE_URL'deki veritabanını pg_dump custom formatında yedekler ve yanına bir manifest yazar:
// migration listesi, tablo satır sayıları, şema kataloğu (trigger/CHECK/index/fonksiyon), tutarlılık kontrolleri,
// dosyanın sha256'sı, süre ve boyut. Restore (restore.ts) yedeği bu manifestle karşılaştırarak doğrular.
//
// Tutarlılık: dökümle manifest aynı ana aittir. REPEATABLE READ transaction'ında snapshot dışa aktarılır
// (pg_export_snapshot) ve pg_dump --snapshot ile aynı snapshot'tan okur; sayımlar da o transaction'da yapılır.
// Canlı trafik altında alınan yedekte de manifest ile döküm birebir uyuşur. Yedek okuma kilidi dışında yazmayı bloklamaz.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createPrismaClient, Prisma } from "../src/index.ts";
import { databaseName, redact, run } from "./pg-tools.ts";
import { checkInvariants, collectState, type DbState, type Invariant } from "./state.ts";

export type Manifest = {
  kind: "kararver-db-backup";
  version: 1;
  createdAt: string;
  source: string;
  database: string;
  serverVersion: string;
  file: string;
  sizeBytes: number;
  sha256: string;
  dumpMs: number;
  state: DbState;
  invariants: Invariant[];
};

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function backup(connectionString: string, outDir: string, now = new Date()): Promise<{ file: string; manifest: Manifest }> {
  await mkdir(outDir, { recursive: true });
  const db = databaseName(connectionString);
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const file = path.resolve(outDir, `kararver-${db}-${stamp}.dump`);
  const prisma = createPrismaClient(connectionString);
  try {
    const started = performance.now();
    const { state, invariants, serverVersion } = await prisma.$transaction(
      async (tx) => {
        const [{ snapshot }] = await tx.$queryRawUnsafe<{ snapshot: string }[]>("SELECT pg_export_snapshot() AS snapshot");
        // pg_dump snapshot'ı açılışta alır; transaction döküm bitene kadar açık kalır.
        const dump = run(
          "pg_dump",
          ["--format=custom", "--no-owner", "--no-privileges", `--snapshot=${snapshot}`, `--file=${file}`],
          connectionString,
        );
        // Sayımlar dökümle paralel ve aynı snapshot'tan.
        const [st, inv, [{ v }]] = await Promise.all([
          collectState(tx),
          checkInvariants(tx),
          tx.$queryRawUnsafe<{ v: string }[]>("SELECT current_setting('server_version') AS v"),
        ]).catch(async (err) => {
          await dump.catch(() => undefined);
          throw err;
        });
        await dump;
        return { state: st, invariants: inv, serverVersion: v };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 30_000, timeout: 6 * 60 * 60 * 1000 },
    );
    const dumpMs = Math.round(performance.now() - started);
    const manifest: Manifest = {
      kind: "kararver-db-backup",
      version: 1,
      createdAt: now.toISOString(),
      source: redact(connectionString),
      database: db,
      serverVersion,
      file: path.basename(file),
      sizeBytes: (await stat(file)).size,
      sha256: await sha256File(file),
      dumpMs,
      state,
      invariants,
    };
    await writeFile(`${file}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
    return { file, manifest };
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: "string", default: path.resolve(import.meta.dirname, "../backups") } } });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  const { file, manifest } = await backup(url, values.out!);
  const rows = Object.values(manifest.state.rows).reduce((a, b) => a + b, 0);
  console.log(`yedek: ${file}`);
  console.log(
    `  ${manifest.state.migrations.length} migration, ${Object.keys(manifest.state.rows).length} tablo, ${rows} satır, ` +
      `${(manifest.sizeBytes / 1024 / 1024).toFixed(1)} MB, ${manifest.dumpMs} ms, sha256 ${manifest.sha256.slice(0, 16)}…`,
  );
  const bad = manifest.invariants.filter((i) => i.violations > 0);
  for (const i of bad) console.warn(`  ⚠ tutarlılık: ${i.name}: ${i.violations} ihlal (yedek yine de alındı)`);
}

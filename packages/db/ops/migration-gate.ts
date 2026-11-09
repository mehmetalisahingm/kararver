// #301 — açılış migration kapısı: uygulama yanlış şemayla başlamaz. MIGRATION ÇALIŞTIRMAZ, yalnız okur.
//
//   DATABASE_URL=… node packages/db/ops/migration-gate.ts      # çıkış 0 = başlayabilir, 1 = başlamamalı
//
// scripts/start-api-with-worker.mjs API ve worker'ı açmadan önce bunu çalıştırır. Render Free'de deploy öncesi komut
// yoktur; yeni sürüm kapıdan geçemezse süreç başlamaz, sağlık kontrolü geçmez ve önceki sürüm yayında kalır.
// Migration'lar yalnız kontrollü adımda uygulanır (docs/KV-49_OPERATIONS.md "Migration kapısı"); API ve worker
// hiçbir zaman kendiliğinden `migrate deploy` çalıştırmaz.
//
// Kurallar (Prisma `_prisma_migrations`):
// - Yarım kalmış migration (finished_at ve rolled_back_at boş) → BAŞLAMA. Önce `migrate resolve` ile karar verilir.
// - Bu sürümün içerdiği ama uygulanmamış migration → BAŞLAMA (kod yeni şemayı bekliyor).
// - Veritabanında olup bu sürümde olmayan migration → BAŞLA, uyar: uygulama geri alınmış (rollback) olabilir; expand/contract
//   kuralı eski sürümün yeni şemayla çalışmasını garanti eder (KV-48).
// - Veritabanına ulaşılamazsa → BAŞLAMA (yanlış şemayla açılma riskini sağlık kontrolüne bırakmaz).
import { readdir } from "node:fs/promises";
import path from "node:path";
import { createPrismaClient } from "../src/index.ts";

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../prisma/migrations");

export type MigrationRow = { name: string; finished: boolean; rolledBack: boolean };
export type GateResult = { ok: boolean; expected: number; applied: number; pending: string[]; failed: string[]; unknown: string[] };

/** Saf karar: bu sürümün migration'ları ile veritabanı kayıtları. */
export function evaluateGate(expected: string[], rows: MigrationRow[]): GateResult {
  const applied = new Set(rows.filter((r) => r.finished && !r.rolledBack).map((r) => r.name));
  const failed = [...new Set(rows.filter((r) => !r.finished && !r.rolledBack).map((r) => r.name))].sort();
  const pending = expected.filter((m) => !applied.has(m));
  const known = new Set(expected);
  const unknown = [...applied].filter((m) => !known.has(m)).sort();
  return { ok: failed.length === 0 && pending.length === 0, expected: expected.length, applied: applied.size, pending, failed, unknown };
}

export async function expectedMigrations(dir = MIGRATIONS_DIR): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory() && /^\d{14}_/.test(e.name)).map((e) => e.name).sort();
}

export async function migrationGate(databaseUrl: string, { dir = MIGRATIONS_DIR, timeoutMs = 15_000 } = {}): Promise<GateResult> {
  const expected = await expectedMigrations(dir);
  const prisma = createPrismaClient(databaseUrl);
  let timer: NodeJS.Timeout | undefined;
  try {
    const query = (async () => {
      const [{ present }] = await prisma.$queryRawUnsafe<{ present: boolean }[]>(
        `SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`,
      );
      if (!present) return [] as MigrationRow[];
      return prisma.$queryRawUnsafe<MigrationRow[]>(
        `SELECT migration_name AS name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS "rolledBack" FROM _prisma_migrations`,
      );
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`veritabanı ${timeoutMs} ms içinde yanıt vermedi`)), timeoutMs);
    });
    return evaluateGate(expected, await Promise.race([query, timeout]));
  } finally {
    clearTimeout(timer);
    await prisma.$disconnect().catch(() => {});
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migration-gate] DATABASE_URL yok: başlatılmıyor");
    process.exit(1);
  }
  try {
    const r = await migrationGate(url);
    const head = `[migration-gate] beklenen ${r.expected}, uygulanmış ${r.applied}`;
    if (r.unknown.length) console.error(`${head} · UYARI: bu sürümde olmayan ${r.unknown.length} migration uygulanmış (rollback?): ${r.unknown.join(", ")}`);
    if (r.ok) {
      console.error(`${head} · şema uyumlu, başlatılabilir`);
    } else {
      if (r.failed.length) console.error(`${head} · YARIM KALMIŞ migration: ${r.failed.join(", ")} → önce \`prisma migrate resolve\` ile karar ver`);
      if (r.pending.length) console.error(`${head} · UYGULANMAMIŞ migration: ${r.pending.join(", ")} → önce kontrollü migration adımı`);
      console.error("[migration-gate] API ve worker BAŞLATILMIYOR (fail-closed)");
    }
    process.exitCode = r.ok ? 0 : 1;
  } catch (err) {
    console.error(`[migration-gate] şema doğrulanamadı: ${err instanceof Error ? err.message : String(err)} → başlatılmıyor`);
    process.exitCode = 1;
  }
}

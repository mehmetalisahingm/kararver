// KV-48 (#50) — yıkıcı migration denetimi: pnpm --filter @kararver/db db:check-migrations
//
// Deploy rollback'i "uygulamanın bir önceki sürümüne dön, veritabanı olduğu gibi kalsın" demektir (Prisma'da down
// migration yok; docs/KV-48_BACKUP_RESTORE.md). Bunun çalışması için her migration bir önceki uygulama sürümüyle
// uyumlu olmalıdır (expand/contract). Bu denetim, veri silen veya eski sürümü kıran ifadeleri bulur:
//   DROP TABLE/COLUMN/TYPE/SCHEMA, TRUNCATE, DELETE FROM, ALTER COLUMN ... TYPE, SET NOT NULL, RENAME,
//   varsayılansız ADD COLUMN ... NOT NULL (eski sürümün INSERT'ü başarısız olur).
// Bilerek yapılan yıkıcı değişiklik dosyada şu satırla onaylanır (gerekçe zorunlu, reviewer görür):
//   -- kv:destructive <gerekçe; önceki sürüm bu kolonu artık okumuyor (PR #…), yedek alındı>
// Onaylı dosya da raporda listelenir. Onaysız bulgu varsa çıkış kodu 1.
//
// Transaction: Prisma migration dosyasını transaction'a sarmaz; ortadaki bir ifade hata verirse öncekiler uygulanmış
// kalır (KV-48 tatbikatında denendi). Dosyayı BEGIN; … COMMIT; ile sarmak hatada hepsini geri alır. Sarılmamış yeni
// migration uyarı olarak raporlanır (çıkış kodunu etkilemez). Transaction'da çalışamayan ifade (CREATE INDEX
// CONCURRENTLY vb.) varsa dosyaya "-- kv:no-transaction <gerekçe>" yazılır.
//
// Bu denetimden önce merge edilmiş migration'lar (CUTOFF dahil) değiştirilemez (Prisma checksum) ve KV-48'de tek tek
// incelendi; denetim dışıdır.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const CUTOFF = "20261002120000";

const RULES: { name: string; re: RegExp }[] = [
  { name: "DROP TABLE", re: /\bDROP\s+TABLE\b/i },
  { name: "DROP COLUMN", re: /\bDROP\s+COLUMN\b/i },
  { name: "DROP TYPE", re: /\bDROP\s+TYPE\b/i },
  { name: "DROP SCHEMA", re: /\bDROP\s+SCHEMA\b/i },
  { name: "TRUNCATE", re: /\bTRUNCATE\b/i },
  { name: "DELETE FROM", re: /\bDELETE\s+FROM\b/i },
  { name: "ALTER COLUMN ... TYPE", re: /\bALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE\b/i },
  { name: "SET NOT NULL", re: /\bSET\s+NOT\s+NULL\b/i },
  { name: "RENAME", re: /\bRENAME\b/i },
];

const ADD_COLUMN = /\bADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?("?\w+"?)([^,;]*)/gi;

/** SQL yorumlarını ve fonksiyon gövdelerini ($$ … $$) atar: trigger gövdesindeki "DELETE" ifadesi bulgu değildir. */
export function stripSql(sql: string): string {
  // Satır sonları korunur: bulgunun satır numarası dosyadakiyle aynı kalsın.
  const blank = (m: string) => m.replace(/[^\n]/g, "");
  return sql
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/--[^\n]*/g, "");
}

export type Finding = { rule: string; line: number; text: string };

export function findDestructive(sql: string): Finding[] {
  const code = stripSql(sql);
  const findings: Finding[] = [];
  const lineOf = (index: number) => code.slice(0, index).split("\n").length;
  for (const rule of RULES) {
    for (const m of code.matchAll(new RegExp(rule.re.source, "gi"))) {
      const line = lineOf(m.index);
      findings.push({ rule: rule.name, line, text: code.split("\n")[line - 1]!.trim() });
    }
  }
  for (const m of code.matchAll(ADD_COLUMN)) {
    const clause = m[3]!;
    if (/\bNOT\s+NULL\b/i.test(clause) && !/\bDEFAULT\b/i.test(clause) && !/\bGENERATED\b/i.test(clause)) {
      const line = lineOf(m.index);
      findings.push({ rule: "ADD COLUMN NOT NULL (varsayılansız)", line, text: code.split("\n")[line - 1]!.trim() });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}

/** Onay satırı: "-- kv:destructive <en az 10 karakter gerekçe>". */
export function approval(sql: string): string | null {
  const m = sql.match(/^\s*--\s*kv:destructive\s+(.{10,})$/m);
  return m ? m[1]!.trim() : null;
}

/** Dosya BEGIN; … COMMIT; ile sarılı mı (yorumlar hariç ilk ve son ifade) ya da bilerek transaction dışı mı. */
export function transactional(sql: string): boolean {
  if (/^\s*--\s*kv:no-transaction\s+.{10,}$/m.test(sql)) return true;
  const code = stripSql(sql).trim();
  return /^BEGIN\s*;/i.test(code) && /COMMIT\s*;$/i.test(code);
}

export type Report = { migration: string; findings: Finding[]; approvedBy: string | null; transactional: boolean }[];

export async function checkMigrations(dir: string, cutoff = CUTOFF): Promise<Report> {
  const report: Report = [];
  for (const name of (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    if (name.slice(0, 14) <= cutoff) continue;
    const sql = await readFile(path.join(dir, name, "migration.sql"), "utf8");
    const findings = findDestructive(sql);
    const tx = transactional(sql);
    if (findings.length > 0 || !tx) report.push({ migration: name, findings, approvedBy: approval(sql), transactional: tx });
  }
  return report;
}

if (import.meta.main) {
  const report = await checkMigrations(path.resolve(import.meta.dirname, "../prisma/migrations"));
  let failed = false;
  for (const r of report) {
    if (!r.transactional) console.log(`⚠ transaction yok: ${r.migration} (BEGIN; … COMMIT; ile sarılmalı; hata olursa yarım kalır)`);
    if (r.findings.length === 0) continue;
    console.log(`${r.approvedBy ? "⚠ onaylı" : "✖ onaysız"} ${r.migration}${r.approvedBy ? ` — ${r.approvedBy}` : ""}`);
    for (const f of r.findings) console.log(`    satır ${f.line}: ${f.rule}: ${f.text}`);
    failed ||= r.findings.length > 0 && !r.approvedBy;
  }
  if (failed) console.error("Yıkıcı değişiklik expand/contract ile bölünmeli ya da '-- kv:destructive <gerekçe>' ile onaylanmalı (docs/KV-48_BACKUP_RESTORE.md).");
  else console.log(report.some((r) => r.findings.length) ? "Yıkıcı değişiklikler onaylı." : `Yıkıcı değişiklik yok (${CUTOFF} sonrası).`);
  process.exitCode = failed ? 1 : 0;
}

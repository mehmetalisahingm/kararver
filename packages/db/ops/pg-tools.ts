// KV-48 (#50) — pg_dump / pg_restore çağrısı. İstemci sürümü sunucudan eski olamaz (pg_dump bunu reddeder);
// PostgreSQL 17 için 17.x istemci gerekir. PG_BIN verilirse oradan, yoksa PATH'ten bulunur.
//
// Bağlantı bilgisi komut satırına değil ortam değişkenlerine (PGHOST, PGPASSWORD, ...) yazılır: parola süreç
// listesinde (ps) görünmez.
import { spawn } from "node:child_process";
import path from "node:path";

export function pgTool(name: "pg_dump" | "pg_restore"): string {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  return process.env.PG_BIN ? path.join(process.env.PG_BIN, exe) : exe;
}

/** libpq ortam değişkenleri. `sslmode` gibi sorgu parametreleri de taşınır. */
export function pgEnv(connectionString: string): Record<string, string> {
  const url = new URL(connectionString);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") throw new Error("postgresql:// adresi bekleniyor");
  const env: Record<string, string> = {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

/** Hedef adresi aynı sunucuda başka bir veritabanına çevirir (CREATE DATABASE için ör. "postgres"). */
export function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
}

export function databaseName(connectionString: string): string {
  return decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ""));
}

/** Parolasız gösterim (log ve manifest için). */
export function redact(connectionString: string): string {
  const url = new URL(connectionString);
  if (url.password) url.password = "***";
  return url.toString();
}

export async function run(tool: "pg_dump" | "pg_restore", args: string[], connectionString: string): Promise<void> {
  const child = spawn(pgTool(tool), args, {
    env: { ...process.env, ...pgEnv(connectionString) },
    stdio: ["ignore", "inherit", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += String(d)));
  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", (err) =>
      reject(
        Object.assign(new Error(`${tool} çalıştırılamadı (${err.message}). PostgreSQL 17 istemci araçlarını kurun veya PG_BIN verin.`), {
          cause: err,
        }),
      ),
    );
    child.on("close", (c) => resolve(c ?? 1));
  });
  if (code !== 0) throw new Error(`${tool} başarısız (çıkış ${code}): ${stderr.trim()}`);
}

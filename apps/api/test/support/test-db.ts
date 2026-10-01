// Postgres test veritabanının seçimi: `pnpm db:test` ve `pnpm test:reset` ile aynı kural (docs/KV-06_LOCAL_SETUP.md).
//   1) Ortamda TEST_DATABASE_URL varsa o (CI).
//   2) Yoksa repo kökündeki .env okunur (ortamdaki değerleri ezmez): oradaki TEST_DATABASE_URL, o da yoksa
//      DATABASE_URL'deki veritabanı adına "_test" eklenmiş hali.
//   3) Hiçbiri yoksa null: Postgres testleri atlanır, ama bir kez açık uyarı yazılır (sessizce atlanmaz).
// Güvenlik: veritabanı adı "_test" ile bitmeli; bitmiyorsa testler hiç başlamaz.
import path from "node:path";

let warned = false;

export function resolveTestDatabaseUrl(repoRoot: string): string | null {
  if (!process.env.TEST_DATABASE_URL) {
    try {
      process.loadEnvFile(path.join(repoRoot, ".env"));
    } catch {
      // .env yok
    }
  }
  let url = process.env.TEST_DATABASE_URL;
  if (!url && process.env.DATABASE_URL) {
    const derived = new URL(process.env.DATABASE_URL);
    derived.pathname = `${derived.pathname.replace(/^\//, "")}_test`;
    url = derived.toString();
  }
  if (!url) {
    if (!warned) {
      warned = true;
      console.warn("⚠ Postgres testleri ATLANDI: TEST_DATABASE_URL yok ve .env'de DATABASE_URL yok (bkz. docs/KV-06_LOCAL_SETUP.md).");
    }
    return null;
  }
  const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!dbName.endsWith("_test")) throw new Error(`Güvenlik: test veritabanının adı "_test" ile bitmeli (şu an: "${dbName}")`);
  // Değişkeni doğrudan okuyan testler (ör. pg-boss, sorgu sayacı) aynı veritabanını kullansın.
  process.env.TEST_DATABASE_URL = url;
  return url;
}

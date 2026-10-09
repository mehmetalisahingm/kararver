import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 .env dosyasını kendisi yüklemez. DATABASE_URL ortamda yoksa (local)
// repo kökündeki .env okunur. Staging/production'da ve testlerde değer ortamdan gelir.
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env"));
  } catch {
    // .env yok: ortam değişkenleri kullanılır
  }
}

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});

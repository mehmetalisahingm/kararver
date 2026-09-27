import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 .env dosyasını kendisi yüklemez. Local'de repo kökündeki .env okunur;
// staging/production'da değişkenler zaten ortamdan gelir (dosya yoksa sessizce geçilir).
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env"));
} catch {
  // .env yok: ortam değişkenleri kullanılır
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

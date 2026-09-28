import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

export * from "../generated/prisma/client.ts";

/**
 * Uygulama başına tek bir PrismaClient oluşturun (api ve worker kendi örneğini tutar).
 * Prisma 7 veritabanına driver adapter üzerinden bağlanır.
 */
export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL tanımlı değil (bkz. .env.example)");
  }
  // Oturum saat dilimi UTC (DATA_MODEL §2.2). Ham SQL'de Date parametresi saat dilimsiz timestamp olarak
  // bağlanır; oturum başka bir saat diliminde olursa (ör. docker-compose TZ=Europe/Istanbul) timestamptz
  // karşılaştırmaları kayar. İstanbul günü gereken hesaplar AT TIME ZONE ile açıkça yapılır.
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, options: "-c TimeZone=UTC" }) });
}

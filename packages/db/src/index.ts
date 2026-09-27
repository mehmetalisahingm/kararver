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
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

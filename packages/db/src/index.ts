import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

export * from "../generated/prisma/client.ts";

/**
 * Uygulama başına tek bir PrismaClient oluşturun (api ve worker kendi örneğini tutar).
 * Prisma 7 veritabanına driver adapter üzerinden bağlanır.
 */
export type ClientOptions = {
  /** Teşhis (KV-47): her SQL sorgusunda çağrılır. Üretimde verilmez. */
  onQuery?: (event: { query: string; durationMs: number }) => void;
};

export function createPrismaClient(connectionString = process.env.DATABASE_URL, options: ClientOptions = {}): PrismaClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL tanımlı değil (bkz. .env.example)");
  }
  // Oturum saat dilimi UTC (DATA_MODEL §2.2). Ham SQL'de Date parametresi saat dilimsiz timestamp olarak
  // bağlanır; oturum başka bir saat diliminde olursa (ör. docker-compose TZ=Europe/Istanbul) timestamptz
  // karşılaştırmaları kayar. İstanbul günü gereken hesaplar AT TIME ZONE ile açıkça yapılır.
  // Bağlantı havuzu (KV-47): pg varsayılanı 10. Yük altında istekler havuzda bekliyorsa DATABASE_POOL_MAX ile
  // artırılır; PostgreSQL max_connections'ı (varsayılan 100) api + worker toplamı aşmamalı.
  const max = Number(process.env.DATABASE_POOL_MAX ?? 10);
  if (!Number.isInteger(max) || max < 1 || max > 100) throw new Error("DATABASE_POOL_MAX 1–100 arası tam sayı olmalı");
  const adapter = new PrismaPg({ connectionString, options: "-c TimeZone=UTC", max });
  if (!options.onQuery) return new PrismaClient({ adapter });
  const client = new PrismaClient({ adapter, log: [{ emit: "event", level: "query" }] });
  const onQuery = options.onQuery;
  client.$on("query", (e) => onQuery({ query: e.query, durationMs: Number(e.duration) }));
  return client as unknown as PrismaClient;
}

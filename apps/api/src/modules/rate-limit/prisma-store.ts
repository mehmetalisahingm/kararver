// RateLimitStore'un PostgreSQL uygulaması. Tablo: rate_limit_counters (packages/db/prisma/schema/security.prisma).
// Artırma tek ifadedir (INSERT … ON CONFLICT DO UPDATE … RETURNING): bütün API süreçleri aynı satırı sıraya girerek
// artırır, iki süreç aynı anda "son hakkı" alamaz. Çok sayaçlı istekte anahtarlar sıralı yazılır (deadlock olmaz).
import type { PrismaClient } from "@kararver/db";
import { windowOf, type CounterRef, type CounterState, type RateLimitStore } from "./store.ts";

/** Süresi geçen pencereler ara ara silinir: ortalama her CLEANUP_EVERY artırmada bir, en fazla CLEANUP_BATCH satır. */
const CLEANUP_EVERY = 200;
const CLEANUP_BATCH = 1000;

type Row = { key: string; window_start: Date; count: number };

export function createPrismaRateLimitStore(prisma: PrismaClient, random: () => number = Math.random): RateLimitStore {
  const slots = (counters: readonly CounterRef[], now: Date) =>
    counters.map((c) => ({ key: c.key, ...windowOf(c.windowMs, now) }));
  const id = (key: string, start: Date) => `${key}|${start.getTime()}`;

  async function cleanup(now: Date) {
    await prisma.$executeRaw`
      DELETE FROM rate_limit_counters
      WHERE ctid IN (SELECT ctid FROM rate_limit_counters WHERE expires_at < ${now} LIMIT ${CLEANUP_BATCH})`;
  }

  return {
    async consume(counters, now) {
      if (counters.length === 0) return [];
      const s = slots(counters, now);
      const ordered = [...s].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.start.getTime() - b.start.getTime()));
      const rows = await prisma.$queryRaw<Row[]>`
        INSERT INTO rate_limit_counters (key, window_start, count, expires_at)
        SELECT k, ws, 1, ex
        FROM unnest(${ordered.map((o) => o.key)}::text[], ${ordered.map((o) => o.start)}::timestamptz[], ${ordered.map((o) => o.end)}::timestamptz[])
          WITH ORDINALITY AS t(k, ws, ex, ord)
        ORDER BY ord
        ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_counters.count + 1
        RETURNING key, window_start, count`;
      const byId = new Map(rows.map((r) => [id(r.key, r.window_start), r.count]));
      if (random() * CLEANUP_EVERY < 1) await cleanup(now).catch(() => undefined);
      return s.map((x): CounterState => ({ key: x.key, count: byId.get(id(x.key, x.start)) ?? 1, resetAt: x.end }));
    },

    async peek(counters, now) {
      if (counters.length === 0) return [];
      const s = slots(counters, now);
      const rows = await prisma.$queryRaw<Row[]>`
        SELECT c.key, c.window_start, c.count
        FROM rate_limit_counters c
        JOIN unnest(${s.map((o) => o.key)}::text[], ${s.map((o) => o.start)}::timestamptz[]) AS t(k, ws)
          ON c.key = t.k AND c.window_start = t.ws`;
      const byId = new Map(rows.map((r) => [id(r.key, r.window_start), r.count]));
      return s.map((x): CounterState => ({ key: x.key, count: byId.get(id(x.key, x.start)) ?? 0, resetAt: x.end }));
    },

    async clear(keys) {
      if (keys.length === 0) return;
      await prisma.$executeRaw`DELETE FROM rate_limit_counters WHERE key = ANY(${[...keys]}::text[])`;
    },
  };
}

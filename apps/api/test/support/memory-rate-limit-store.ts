// KV-19 RateLimitStore'un bellek uygulaması (memory backend testleri). Tek süreçtir; çoklu süreç tutarlılığı
// yalnız PostgreSQL uygulamasında anlamlıdır (rate-limit.test.ts iki uygulama örneğiyle sınar).
import { windowOf, type RateLimitStore } from "../../src/modules/rate-limit/store.ts";

export function createMemoryRateLimitStore(): RateLimitStore & { counters: Map<string, number> } {
  const counters = new Map<string, number>();
  const id = (key: string, start: Date) => `${key}|${start.getTime()}`;
  return {
    counters,
    async consume(refs, now) {
      return refs.map((r) => {
        const w = windowOf(r.windowMs, now);
        const k = id(r.key, w.start);
        const count = (counters.get(k) ?? 0) + 1;
        counters.set(k, count);
        return { key: r.key, count, resetAt: w.end };
      });
    },
    async peek(refs, now) {
      return refs.map((r) => {
        const w = windowOf(r.windowMs, now);
        return { key: r.key, count: counters.get(id(r.key, w.start)) ?? 0, resetAt: w.end };
      });
    },
    async clear(keys) {
      for (const k of [...counters.keys()]) if (keys.some((key) => k.startsWith(`${key}|`))) counters.delete(k);
    },
  };
}

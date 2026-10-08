// KV-19 (#21) sayaç deposu. Sabit pencere: pencere başı = floor(şimdi / pencere) × pencere.
// Prisma uygulaması: prisma-store.ts; bellek uygulaması: test/support/memory-rate-limit-store.ts.

export type CounterRef = { key: string; windowMs: number };
export type CounterState = { key: string; count: number; resetAt: Date };

export interface RateLimitStore {
  /** Her sayacı atomik olarak bir artırır; artırılmış değeri ve pencere bitişini verir (girdi sırasıyla). */
  consume(counters: readonly CounterRef[], now: Date): Promise<CounterState[]>;
  /** Artırmadan okur (girdi sırasıyla; sayaç yoksa 0). */
  peek(counters: readonly CounterRef[], now: Date): Promise<CounterState[]>;
  /** Anahtarın bütün pencerelerini siler (ör. başarılı girişte e-posta sayacı). */
  clear(keys: readonly string[]): Promise<void>;
}

export function windowOf(windowMs: number, now: Date): { start: Date; end: Date } {
  const start = Math.floor(now.getTime() / windowMs) * windowMs;
  return { start: new Date(start), end: new Date(start + windowMs) };
}

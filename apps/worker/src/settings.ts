// Worker'ın sistem ayarı okuyucusu (KV-40, #42). API ile aynı tablo (system_settings) ve aynı kayıt defteri:
// satırı olmayan ayar contracts varsayılanıyla çalışır. Kısa süre (5 sn) bellekte tutulur; DB okunamazsa son bilinen
// değerler, hiç yoksa varsayılanlar kullanılır (fail-safe: job'lar ayar yüzünden durmaz).
import { defaultSettings, isSettingKey, type SettingKey } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";

export type WorkerSettings = {
  /** Ayar değeri; kayıt defterinde varsayılanı olan anahtarlar için garantili dolu. */
  get<T = unknown>(key: SettingKey): Promise<T>;
  invalidate(): void;
};

export function createWorkerSettings(
  prisma: Pick<PrismaClient, "systemSetting">,
  options: { now: () => Date; ttlMs?: number; onError?: (error: unknown) => void },
): WorkerSettings {
  const ttlMs = options.ttlMs ?? 5_000;
  const defaults = defaultSettings().values as Record<string, unknown>;
  let snapshot: { values: Record<string, unknown>; loadedAt: number } | null = null;

  async function current() {
    if (snapshot && options.now().getTime() - snapshot.loadedAt < ttlMs) return snapshot.values;
    try {
      const rows = await prisma.systemSetting.findMany({ select: { key: true, value: true } });
      const values = { ...defaults };
      for (const row of rows) if (isSettingKey(row.key)) values[row.key] = row.value;
      snapshot = { values, loadedAt: options.now().getTime() };
    } catch (error) {
      options.onError?.(error);
      // Son bilinen değerler (yoksa varsayılanlar); 1 sn sonra yeniden dener.
      snapshot = { values: snapshot?.values ?? defaults, loadedAt: options.now().getTime() - Math.max(0, ttlMs - 1_000) };
    }
    return snapshot.values;
  }

  return {
    async get<T>(key: SettingKey) {
      const values = await current();
      if (!(key in values)) throw new Error(`ayar varsayılanı yok: ${key}`);
      return values[key] as T;
    },
    invalidate() {
      snapshot = null;
    },
  };
}

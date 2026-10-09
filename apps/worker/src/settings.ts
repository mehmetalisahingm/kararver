// Worker'ın sistem ayarı okuyucusu (KV-40, #42). API ile aynı tablo (system_settings) ve aynı kayıt defteri:
// satırı olmayan ayar contracts varsayılanıyla çalışır. Kısa süre (5 sn) bellekte tutulur; DB okunamazsa son bilinen
// değerler, hiç yoksa varsayılanlar kullanılır (fail-safe: job'lar ayar yüzünden durmaz).
import { defaultSettings, isSettingKey, parseSettingValue, type SettingKey } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";

export type WorkerSettings = {
  /** Ayar değeri; kayıt defterinde varsayılanı olan anahtarlar için garantili dolu. */
  get<T = unknown>(key: SettingKey): Promise<T>;
  snapshot(): Promise<SettingsSnapshot>;
  invalidate(): void;
};

export type SettingsSnapshot = {
  values: Readonly<Record<string, unknown>>;
  versions: Readonly<Record<string, number>>;
};

export function createWorkerSettings(
  prisma: Pick<PrismaClient, "systemSetting">,
  options: { now: () => Date; ttlMs?: number; onError?: (error: unknown) => void },
): WorkerSettings {
  const ttlMs = options.ttlMs ?? 5_000;
  const defaults = defaultSettings().values as Record<string, unknown>;
  let snapshot: (SettingsSnapshot & { loadedAt: number }) | null = null;

  async function current() {
    if (snapshot && options.now().getTime() - snapshot.loadedAt < ttlMs) return snapshot;
    try {
      const rows = await prisma.systemSetting.findMany({ select: { key: true, value: true, version: true } });
      const values = { ...defaults };
      const versions: Record<string, number> = {};
      for (const row of rows) {
        if (!isSettingKey(row.key)) continue;
        const parsed = parseSettingValue(row.key, row.value);
        if (!parsed.ok) throw new Error(parsed.message);
        values[row.key] = parsed.value;
        versions[row.key] = row.version;
      }
      snapshot = { values, versions, loadedAt: options.now().getTime() };
    } catch (error) {
      options.onError?.(error);
      // Son bilinen değerler (yoksa varsayılanlar); 1 sn sonra yeniden dener.
      snapshot = { values: snapshot?.values ?? defaults, versions: snapshot?.versions ?? {}, loadedAt: options.now().getTime() - Math.max(0, ttlMs - 1_000) };
    }
    return snapshot;
  }

  return {
    async get<T>(key: SettingKey) {
      const { values } = await current();
      if (!(key in values)) throw new Error(`ayar varsayılanı yok: ${key}`);
      return structuredClone(values[key]) as T;
    },
    async snapshot() {
      const { values, versions } = await current();
      return structuredClone({ values, versions });
    },
    invalidate() {
      if (snapshot) snapshot.loadedAt = -Infinity;
    },
  };
}

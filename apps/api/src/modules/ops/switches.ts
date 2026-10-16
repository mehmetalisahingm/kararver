// KV-186 (#186) acil durum anahtarlarının durumu (KV-40): etkin değer, son değişiklik zamanı ve yayılma süresi.
// Değiştirme burada yoktur (admin.emergency.put, yalnız SUPER_ADMIN, gerekçe ve audit); değiştiren kişi audit'tedir.
import { emergencySwitchSettings } from "@kararver/contracts";
import { DEFAULT_UPDATED_AT, type SettingsService } from "../settings/service.ts";
import type { SwitchName, SwitchesView } from "./status.ts";

/** Ayar servisinin varsayılan önbellek ömrü (service.ts); servis değeri vermezse kullanılır. */
const DEFAULT_TTL_MS = 5_000;

export async function emergencySwitchesView(settings: SettingsService): Promise<SwitchesView> {
  const entries = new Map((await settings.list()).map((entry) => [entry.key as string, entry]));
  const items = (Object.entries(emergencySwitchSettings) as Array<[SwitchName, string]>).map(([name, key]) => {
    const entry = entries.get(key);
    // Satırı olmayan (hiç değiştirilmemiş) ayar varsayılan zamanla gelir: değişiklik yok.
    const changed = entry && entry.updatedAt.getTime() !== DEFAULT_UPDATED_AT.getTime();
    return { name, key, enabled: entry?.value === true, changedAt: changed ? entry.updatedAt.toISOString() : null };
  });
  return { propagationSeconds: Math.ceil((settings.cacheTtlMs ?? DEFAULT_TTL_MS) / 1000), items };
}

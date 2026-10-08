// Sistem ayarları veri erişimi — KV-40 (#42). Üretim uygulaması: prisma-store.ts.
// Kayıt defteri, tip/aralık kuralları ve resmî varsayılanlar contracts settings.ts'tedir; burası yalnız saklar.
import type { SettingKey } from "@kararver/contracts";

export type SettingEditor = { id: string; username: string; displayName: string; avatarPublicKey: string | null };

/** Veritabanında satırı olan ayar. Satırı olmayan ayar varsayılanla (sürüm 1) çalışır. */
export type StoredSetting = { key: string; value: unknown; version: number; updatedAt: Date; updatedBy: SettingEditor | null };

type Mutation = {
  actorId: string;
  reason: string;
  requestId: string | null;
  now: Date;
  /** Etkin varsayılan değerler (kayıt defteri + güvenli varsayılanlar): satırı olmayan ayarın önceki değeri. */
  defaults: Readonly<Record<string, unknown>>;
};

export type UpdateInput = Mutation & { key: SettingKey; value: unknown; version: number };
export type EmergencyInput = Mutation & { changes: Partial<Record<SettingKey, boolean>> };

export type UpdateOutcome =
  | { kind: "updated" | "unchanged"; setting: StoredSetting }
  /** Gönderilen sürüm eskidir; `current` güncel kayıt. */
  | { kind: "conflict"; current: StoredSetting }
  /** Değer tek başına geçerli ama diğer ayarlarla çakışıyor (ör. minDuration > maxDuration). */
  | { kind: "invalid"; message: string };

export type EmergencyOutcome = { kind: "applied"; changed: number; settings: StoredSetting[] };

export interface SettingsStore {
  /** Satırı olan bütün ayarlar. */
  loadStored(): Promise<StoredSetting[]>;
  /**
   * Tek ayarı değiştirir: bütün ayar değişiklikleri tek advisory kilidiyle sıralanır (alanlar arası kurallar için),
   * sürüm kontrolü, satır + audit (settings.update) aynı transaction'da. Aynı değer tekrarı `unchanged` (iz yok).
   */
  update(input: UpdateInput): Promise<UpdateOutcome>;
  /** Acil durum anahtarları: değişen anahtarlar tek transaction'da, tek audit kaydı (emergency.update). */
  putEmergency(input: EmergencyInput): Promise<EmergencyOutcome>;
}

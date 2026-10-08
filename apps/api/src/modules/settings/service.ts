// Sistem ayarları servisi — KV-40 (#42). Ayar değerleri DB'den okunur, kısa süre bellekte tutulur; değişiklik bu süreçte
// anında, diğer API süreçlerinde en geç TTL kadar sonra görünür. Hiçbir ayar için deploy gerekmez.
//
// Varsayılan kuralı: contracts settings.ts'teki resmî varsayılan; resmî değeri olmayan anahtarlar (özellik anahtarları,
// oy değiştirme, "Senin İçin" payları) için aşağıdaki GÜVENLİ varsayılanlar kullanılır (KV-04 açık konuları; Mehmet teyidi
// bekliyor): özellikler açık, bakım kapalı, oy değiştirme açık, keşif payı %20 / aynı yazar 2 / aynı kategori 4.
// DB okunamazsa son bilinen değerler, hiç yoksa bu varsayılanlar kullanılır (fail-safe: platform kapanmaz).
import {
  buildPublicConfig,
  defaultSettings,
  emergencySwitchSettings,
  isSettingKey,
  settingKeys,
  type SettingKey,
} from "@kararver/contracts";
import type { FeedSettings } from "../feed/for-you.ts";
import { DEFAULT_RATE_LIMIT_SETTINGS, type RateLimitSettings } from "../rate-limit/policy.ts";
import type { MediaSettings } from "../media/store.ts";
import type { PollSettings } from "../polls/store.ts";
import type { EmergencyOutcome, SettingsStore, StoredSetting, UpdateOutcome } from "./store.ts";

/** Resmî kaynakta değeri olmayan ayarlar için güvenli varsayılan (bkz. dosya başı). */
export const SAFE_DEFAULTS: Readonly<Partial<Record<SettingKey, unknown>>> = Object.freeze({
  "polls.voteChangeAllowed": true,
  "features.registration": true,
  "features.pollCreation": true,
  "features.comments": true,
  "features.uploads": true,
  "maintenance.enabled": false,
  "feed.explorationPercent": 20,
  "feed.maxSameAuthorPerWindow": 2,
  "feed.maxSameCategoryPerWindow": 4,
});

/** Hız sınırı (KV-19) önerileri `limits.<ad>` anahtarlarının güvenli varsayılanıdır (Mehmet geçici limitleri onayladı, #21). */
const RATE_LIMIT_DEFAULTS = Object.fromEntries(Object.entries(DEFAULT_RATE_LIMIT_SETTINGS).map(([k, v]) => [`limits.${k}`, v]));

export type SettingValues = Readonly<Record<SettingKey, unknown>>;

/** Etkin varsayılanlar: resmî + güvenli. Eksik anahtar programlama hatasıdır. */
export function effectiveDefaults(): SettingValues {
  const merged: Record<string, unknown> = { ...defaultSettings().values, ...SAFE_DEFAULTS, ...RATE_LIMIT_DEFAULTS };
  const missing = settingKeys.filter((k) => !(k in merged));
  if (missing.length > 0) throw new Error(`ayar varsayılanı yok: ${missing.join(", ")}`);
  return merged as SettingValues;
}

/** Satırı olmayan (hiç değiştirilmemiş) ayarın `updatedAt` değeri. */
export const DEFAULT_UPDATED_AT = new Date(0);

export type SettingEntry = StoredSetting;

export type SettingsService = {
  /** Etkin değerler (önbellekli). */
  values(): Promise<SettingValues>;
  /** Bütün kayıt defteri anahtarları, sıralı; satırı olmayanlar sürüm 1 / varsayılan değerle. */
  list(): Promise<SettingEntry[]>;
  update(input: { key: SettingKey; value: unknown; version: number; reason: string; actorId: string; requestId: string | null }): Promise<UpdateOutcome>;
  putEmergency(input: { changes: Partial<Record<SettingKey, boolean>>; reason: string; actorId: string; requestId: string | null }): Promise<EmergencyOutcome>;
  /** Önbelleği düşürür (ayar değişince çağrılır; testler de kullanır). */
  invalidate(): void;

  publicConfig(): Promise<ReturnType<typeof buildPublicConfig>>;
  pollSettings(): Promise<PollSettings>;
  feedSettings(): Promise<FeedSettings>;
  mediaSettings(): Promise<MediaSettings>;
  pointSettings(): Promise<{ initialGrant: number; publishCost: number }>;
  /** Hız sınırı değerleri (`limits.*`, KV-19). */
  rateLimitSettings(): Promise<RateLimitSettings>;
  isRegistrationEnabled(): Promise<boolean>;
  isCommentsEnabled(): Promise<boolean>;
  isMaintenance(): Promise<boolean>;
  /** Yorum üst sınırı (comments.bodyMaxLength); sözleşme şeması 2000 karakterle üst sınırdır, ayar yalnız daraltır. */
  commentMaxLength(): Promise<number>;
};

export type SettingsServiceOptions = {
  now: () => Date;
  /** Önbellek ömrü; varsayılan 5 sn (çok süreçli dağıtımda değişikliğin yayılma süresi). */
  ttlMs?: number;
  onError?: (error: unknown) => void;
};

type Snapshot = { values: SettingValues; rows: StoredSetting[]; loadedAt: number };

export function createSettingsService(store: SettingsStore, options: SettingsServiceOptions): SettingsService {
  const ttlMs = options.ttlMs ?? 5_000;
  const defaults = effectiveDefaults();
  let snapshot: Snapshot | null = null;
  let loading: Promise<Snapshot> | null = null;

  async function load(): Promise<Snapshot> {
    const rows = await store.loadStored();
    const values: Record<string, unknown> = { ...defaults };
    for (const row of rows) if (isSettingKey(row.key)) values[row.key] = row.value;
    return { values: values as SettingValues, rows, loadedAt: options.now().getTime() };
  }

  async function current(): Promise<Snapshot> {
    const fresh = snapshot && options.now().getTime() - snapshot.loadedAt < ttlMs;
    if (fresh) return snapshot!;
    loading ??= load()
      .then((s) => (snapshot = s))
      .catch((error: unknown) => {
        options.onError?.(error);
        // Fail-safe: son bilinen değerler, yoksa güvenli varsayılanlar. Kısa süre (1 sn) sonra yeniden denenir.
        const fallback = snapshot ?? { values: defaults, rows: [], loadedAt: 0 };
        snapshot = { ...fallback, loadedAt: options.now().getTime() - Math.max(0, ttlMs - 1_000) };
        return snapshot;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  const num = (v: SettingValues, key: SettingKey) => v[key] as number;
  const bool = (v: SettingValues, key: SettingKey) => v[key] as boolean;

  const service: SettingsService = {
    async values() {
      return (await current()).values;
    },

    async list() {
      const { rows } = await current();
      const byKey = new Map(rows.map((r) => [r.key, r]));
      return [...settingKeys]
        .sort()
        .map((key) => byKey.get(key) ?? { key, value: defaults[key], version: 1, updatedAt: DEFAULT_UPDATED_AT, updatedBy: null });
    },

    async update(input) {
      const outcome = await store.update({ ...input, now: options.now(), defaults });
      service.invalidate();
      return outcome;
    },

    async putEmergency(input) {
      const outcome = await store.putEmergency({ ...input, now: options.now(), defaults });
      service.invalidate();
      return outcome;
    },

    invalidate() {
      snapshot = null;
    },

    async publicConfig() {
      return buildPublicConfig(await service.values());
    },

    async pollSettings() {
      const v = await service.values();
      return {
        minDurationHours: num(v, "polls.minDurationHours"),
        maxDurationHours: num(v, "polls.maxDurationHours"),
        voteChangeAllowed: bool(v, "polls.voteChangeAllowed"),
        publishCostPoints: num(v, "points.publishCost"),
        newAccountPeriodDays: num(v, "polls.newAccountPeriodDays"),
        newAccountDailyLimit: num(v, "polls.newAccountDailyLimit"),
        newAccountCooldownMinutes: num(v, "polls.newAccountCooldownMinutes"),
        dailyLimit: num(v, "polls.dailyLimit"),
        cooldownMinutes: num(v, "polls.cooldownMinutes"),
        creationEnabled: bool(v, "features.pollCreation"),
        minOptions: num(v, "polls.minOptions"),
        maxOptions: num(v, "polls.maxOptions"),
        titleMaxLength: num(v, "polls.titleMaxLength"),
        descriptionMaxLength: num(v, "polls.descriptionMaxLength"),
        maxMediaPerPoll: num(v, "media.maxPerPoll"),
      };
    },

    async feedSettings() {
      const v = await service.values();
      return {
        explorationPercent: num(v, "feed.explorationPercent"),
        maxSameAuthorPerWindow: num(v, "feed.maxSameAuthorPerWindow"),
        maxSameCategoryPerWindow: num(v, "feed.maxSameCategoryPerWindow"),
      };
    },

    async mediaSettings() {
      const v = await service.values();
      return { uploadsEnabled: bool(v, "features.uploads"), maxBytes: num(v, "media.maxBytes"), allowedTypes: v["media.allowedTypes"] as readonly string[] };
    },

    async pointSettings() {
      const v = await service.values();
      return { initialGrant: num(v, "points.initialGrant"), publishCost: num(v, "points.publishCost") };
    },

    async rateLimitSettings() {
      const v = await service.values();
      return Object.fromEntries(Object.keys(DEFAULT_RATE_LIMIT_SETTINGS).map((k) => [k, num(v, `limits.${k}` as SettingKey)])) as RateLimitSettings;
    },

    async isRegistrationEnabled() {
      return bool(await service.values(), "features.registration");
    },
    async isCommentsEnabled() {
      return bool(await service.values(), "features.comments");
    },
    async isMaintenance() {
      return bool(await service.values(), "maintenance.enabled");
    },

    async commentMaxLength() {
      return num(await service.values(), "comments.bodyMaxLength");
    },
  };
  return service;
}

/** Acil durum anahtarı adı → ayar anahtarı (admin.emergency.put gövdesi). */
export const emergencyKey = (name: keyof typeof emergencySwitchSettings): SettingKey => emergencySwitchSettings[name];

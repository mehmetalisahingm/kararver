// KV-04 (#6) — sistem ayarı kayıt defteri. KV-40 (`system_settings`) değerleri bu tanımlara göre
// saklar ve doğrular; `GET /config` public alt kümeyi `PublicConfig` şekline çevirir.
// Açıklama ve açık konular: docs/KV-04_ROLES_EVENTS.md.
//
// Varsayılan kuralı: yalnızca belgede veya contracts kaynağında (yorum/zod sınırı) geçen değer
// resmîdir ve `source` ile yazılır. Fixture değeri resmî değildir. Kaynağı olmayan varsayılan
// uydurulmaz: `default: null` + `missing` gerekçesi.
import { z } from "zod";
import { PublicConfig, Setting } from "./domains/admin.ts";
import { AllowedMimeType } from "./domains/media.ts";
import type { ErrorCode } from "./errors.ts";

type Bound = number | null;

export type SettingDefinition = {
  type: "integer" | "boolean" | "mimeTypes";
  description: string;
  min: Bound;
  max: Bound;
  /** null: resmî kaynakta değer yok (açık konu). */
  default: { value: number | boolean | readonly string[]; source: string } | null;
  missing?: string;
  /** `PublicConfig` içindeki yol; null ise ayar public değildir (sadece admin/servis okur). */
  publicPath: readonly string[] | null;
};

const POLLS = "packages/contracts/src/domains/polls.ts";
const COMMENTS = "packages/contracts/src/domains/comments.ts";
const MEDIA = "packages/contracts/src/domains/media.ts";
const ADMIN = "packages/contracts/src/domains/admin.ts";

const int = (
  description: string,
  min: Bound,
  max: Bound,
  value: number,
  source: string,
  publicPath: readonly string[] | null,
): SettingDefinition => ({ type: "integer", description, min, max, default: { value, source }, publicPath });

const flag = (description: string, publicPath: readonly string[], missing: string): SettingDefinition => ({
  type: "boolean",
  description,
  min: null,
  max: null,
  default: null,
  missing,
  publicPath,
});

/** Varsayılanı resmî kaynakta olmayan tamsayı ayarı; API geçici değeri kendi tarafında tutar. */
const proposedInt = (description: string, min: Bound, max: Bound, missing: string): SettingDefinition => ({
  type: "integer",
  description,
  min,
  max,
  default: null,
  missing,
  publicPath: null,
});

const FEED_PROPOSAL = (value: number) =>
  `PRODUCT_TEAM_PLAN §7 ve #29 kabul koşulu bunu admin ayarı olarak ister, değer vermez. Öneri ${value} (Faruk, KV-27; API geçici olarak bunu kullanır), Mehmet teyidi bekliyor`;

const NO_SWITCH_DEFAULT =
  "PRODUCT_TEAM_PLAN §16 'Sistem ayarları' ve 'Acil durum kontrolleri' anahtarı tanımlar, varsayılan değer vermez";

export const settingsRegistry = Object.freeze({
  "polls.minOptions": int(
    "Anket için en az seçenek",
    2,
    6,
    2,
    `${POLLS} → CreatePollBody.options .min(2); ${ADMIN} → PublicConfig.polls.minOptions .min(2); PRODUCT_TEAM_PLAN §4 "2–6 seçenek"`,
    ["polls", "minOptions"],
  ),
  "polls.maxOptions": int(
    "Anket için en fazla seçenek",
    2,
    6,
    6,
    `${POLLS} → CreatePollBody.options .max(6); ${ADMIN} → PublicConfig.polls.maxOptions .max(6); PRODUCT_TEAM_PLAN §4 "2–6 seçenek"`,
    ["polls", "maxOptions"],
  ),
  "polls.minDurationHours": int(
    "En kısa anket süresi (saat)",
    1,
    720,
    1,
    `${POLLS} → CreatePollBody.durationHours yorum "varsayılan 1–720", .min(1)`,
    ["polls", "minDurationHours"],
  ),
  "polls.maxDurationHours": int(
    "En uzun anket süresi (saat)",
    1,
    720,
    720,
    `${POLLS} → CreatePollBody.durationHours yorum "varsayılan 1–720", .max(720)`,
    ["polls", "maxDurationHours"],
  ),
  "polls.titleMaxLength": int(
    "Başlık üst sınırı (karakter)",
    10,
    200,
    200,
    `${POLLS} → Title .min(10).max(200)`,
    ["polls", "titleMaxLength"],
  ),
  "polls.descriptionMaxLength": int(
    "Açıklama üst sınırı (karakter)",
    0,
    5000,
    5000,
    `${POLLS} → Description .max(5000)`,
    ["polls", "descriptionMaxLength"],
  ),
  // KV-20 (#22): yayın limitleri. Aşımda 429 PUBLISH_COOLDOWN / DAILY_PUBLISH_LIMIT + Retry-After.
  "polls.newAccountPeriodDays": int("Yeni hesap sayılma süresi (gün)", 0, 90, 7, `PRODUCT_TEAM_PLAN §13 "Önerilen varsayılan değerler" "ilk 7 gün"`, null),
  "polls.newAccountDailyLimit": int("Yeni hesap: 24 saatte en fazla anket", 1, 100, 3, `PRODUCT_TEAM_PLAN §13 "Önerilen varsayılan değerler" "maksimum 3 anket / 24 saat"`, null),
  "polls.newAccountCooldownMinutes": int(
    "Yeni hesap: iki anket arası en az süre (dakika)",
    0,
    1440,
    30,
    `PRODUCT_TEAM_PLAN §13 "Önerilen varsayılan değerler" "iki anket arasında minimum 30 dakika"`,
    null,
  ),
  "polls.dailyLimit": int("Normal hesap: 24 saatte en fazla anket", 1, 1000, 10, `PRODUCT_TEAM_PLAN §13 "Önerilen varsayılan değerler" "maksimum 10 anket / 24 saat"`, null),
  "polls.cooldownMinutes": int("Normal hesap: iki anket arası en az süre (dakika)", 0, 1440, 10, `PRODUCT_TEAM_PLAN §13 "Önerilen varsayılan değerler" "iki anket arasında minimum 10 dakika"`, null),
  "polls.voteChangeAllowed": {
    type: "boolean",
    description: "Kullanıcı anket kapanmadan oyunu değiştirebilir",
    min: null,
    max: null,
    default: null,
    missing:
      "PRODUCT_TEAM_PLAN §5 ve DATA_MODEL §5.1 bunun bir sistem ayarı olduğunu söyler, varsayılan değeri vermez",
    publicPath: ["polls", "voteChangeAllowed"],
  },
  "comments.bodyMaxLength": int(
    "Yorum üst sınırı (karakter)",
    1,
    2000,
    2000,
    `${COMMENTS} → Body .min(1).max(2000)`,
    ["comments", "bodyMaxLength"],
  ),
  "media.maxBytes": int(
    "Tek görsel üst sınırı (bayt)",
    1,
    50 * 1024 * 1024,
    8 * 1024 * 1024,
    `docs/MEDIA_MODERATION.md §5 madde 2 "Varsayılan öneri 8 MB"; ${MEDIA} → media.uploads.create sizeBytes yorumu "Varsayılan üst sınır 8 MB", .max(50 MB)`,
    ["media", "maxBytes"],
  ),
  "media.maxPerPoll": int(
    "Anket başına en fazla görsel",
    0,
    10,
    10,
    `${POLLS} → commonCreate.mediaIds .max(10)`,
    ["media", "maxPerPoll"],
  ),
  "media.allowedTypes": {
    type: "mimeTypes",
    description: "İzin verilen görsel türleri (AllowedMimeType alt kümesi)",
    min: 1,
    max: AllowedMimeType.options.length,
    default: {
      value: Object.freeze([...AllowedMimeType.options]),
      source: `${MEDIA} → AllowedMimeType; docs/MEDIA_MODERATION.md §5 madde 1`,
    },
    publicPath: ["media", "allowedTypes"],
  },
  "points.initialGrant": int(
    "İlk başarılı girişte bir kez verilen puan",
    0,
    null,
    20,
    `docs/V1_USER_FLOW.md "Başlangıç puanı ve yayın maliyeti — V1": 20 puan`,
    ["points", "initialGrant"],
  ),
  "points.publishCost": int(
    "Yayın maliyeti (puan)",
    0,
    null,
    10,
    `docs/V1_USER_FLOW.md "Başlangıç puanı ve yayın maliyeti — V1": 10 puan`,
    ["points", "publishCost"],
  ),
  "features.registration": flag("Yeni kayıt açık", ["features", "registration"], NO_SWITCH_DEFAULT),
  "features.pollCreation": flag("Anket oluşturma açık", ["features", "pollCreation"], NO_SWITCH_DEFAULT),
  "features.comments": flag("Yorumlar açık", ["features", "comments"], NO_SWITCH_DEFAULT),
  "features.uploads": flag("Görsel yükleme açık", ["features", "uploads"], NO_SWITCH_DEFAULT),
  "maintenance.enabled": flag("Bakım modu", ["maintenance"], NO_SWITCH_DEFAULT),
  "trends.moversMinVotes": int(
    "Haftanın Değişkenleri: her iki pencere sonunda en az geçerli oy",
    0,
    null,
    30,
    "docs/DATA_MODEL.md §8.3 Eşikler",
    null,
  ),
  "trends.moversMinActiveAccounts": int(
    "Haftanın Değişkenleri: ikinci pencerede en az benzersiz aktif hesap",
    0,
    null,
    10,
    "docs/DATA_MODEL.md §8.3 Eşikler",
    null,
  ),
  "feed.explorationPercent": proposedInt(
    "Senin İçin: kartların yüzde kaçı yeni/az oy almış anketlere ayrılır (keşif payı)",
    0,
    50,
    FEED_PROPOSAL(20),
  ),
  "feed.maxSameAuthorPerWindow": proposedInt("Senin İçin: art arda 10 kartta aynı yazardan en fazla", 1, 10, FEED_PROPOSAL(2)),
  "feed.maxSameCategoryPerWindow": proposedInt("Senin İçin: art arda 10 kartta aynı kategoriden en fazla", 1, 10, FEED_PROPOSAL(4)),
} satisfies Record<string, SettingDefinition>);

export type SettingKey = keyof typeof settingsRegistry;
export const settingKeys = Object.freeze(Object.keys(settingsRegistry) as SettingKey[]);

/** `PUT /admin/emergency` anahtarı → ayar anahtarı. */
export const emergencySwitchSettings = Object.freeze({
  registration: "features.registration",
  pollCreation: "features.pollCreation",
  comments: "features.comments",
  uploads: "features.uploads",
  maintenance: "maintenance.enabled",
} as const satisfies Record<string, SettingKey>);

export function isSettingKey(key: unknown): key is SettingKey {
  return typeof key === "string" && Object.hasOwn(settingsRegistry, key);
}

function valueSchema(def: SettingDefinition): z.ZodType {
  switch (def.type) {
    case "boolean":
      return z.boolean();
    case "integer": {
      let s = z.number().int();
      if (def.min !== null) s = s.min(def.min);
      if (def.max !== null) s = s.max(def.max);
      return s;
    }
    case "mimeTypes":
      return z
        .array(AllowedMimeType)
        .min(def.min ?? 0)
        .max(def.max ?? Infinity)
        .refine((a) => new Set(a).size === a.length, "Tekrarlanan tür");
  }
}

export type SettingResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; code: Extract<ErrorCode, "NOT_FOUND" | "VALIDATION_ERROR">; message: string };

/**
 * `PATCH /admin/settings/:key` değerini doğrular. Bilinmeyen anahtar → NOT_FOUND (404),
 * tip veya aralık dışı → VALIDATION_ERROR (400). Anahtar biçimi `Setting.key` ile aynıdır.
 */
export function parseSettingValue(key: string, value: unknown): SettingResult {
  if (!isSettingKey(key)) return { ok: false, code: "NOT_FOUND", message: `Bilinmeyen ayar: ${key}` };
  const parsed = valueSchema(settingsRegistry[key]).safeParse(value);
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: `${key}: ${parsed.error.issues[0]?.message}` };
  return { ok: true, value: parsed.data };
}

/** Alanlar arası kurallar; tek ayar değişikliği de bütün değer kümesiyle birlikte kontrol edilir. */
const crossRules: readonly [SettingKey, SettingKey, string][] = [
  ["polls.minOptions", "polls.maxOptions", "minOptions ≤ maxOptions"],
  ["polls.minDurationHours", "polls.maxDurationHours", "minDurationHours ≤ maxDurationHours"],
];

/** Bütün değer kümesini doğrular: bilinmeyen anahtar, tip/aralık ve alanlar arası kurallar. */
export function validateSettings(values: Readonly<Record<string, unknown>>): SettingResult<Partial<Record<SettingKey, unknown>>> {
  const out: Partial<Record<SettingKey, unknown>> = {};
  for (const [key, value] of Object.entries(values)) {
    const r = parseSettingValue(key, value);
    if (!r.ok) return r;
    out[key as SettingKey] = r.value;
  }
  for (const [lo, hi, rule] of crossRules) {
    const a = out[lo];
    const b = out[hi];
    if (typeof a === "number" && typeof b === "number" && a > b) {
      return { ok: false, code: "VALIDATION_ERROR", message: rule };
    }
  }
  return { ok: true, value: out };
}

/** Resmî varsayılanlar ve varsayılanı olmayan (açık konu) anahtarlar. */
export function defaultSettings(): { values: Partial<Record<SettingKey, unknown>>; missing: SettingKey[] } {
  const values: Partial<Record<SettingKey, unknown>> = {};
  const missing: SettingKey[] = [];
  for (const key of settingKeys) {
    const d = (settingsRegistry[key] as SettingDefinition).default;
    if (d === null) missing.push(key);
    else values[key] = Array.isArray(d.value) ? [...d.value] : d.value;
  }
  return { values, missing };
}

/**
 * Ayar değerlerinden `GET /config` gövdesini kurar. Bütün public anahtarlar dolu olmalıdır;
 * eksik anahtar TypeError'dır (varsayılan uydurulmaz). Sonuç strict `PublicConfig`'ten geçer.
 */
export function buildPublicConfig(values: Readonly<Record<string, unknown>>): z.infer<typeof PublicConfig> {
  const checked = validateSettings(values);
  if (!checked.ok) throw new TypeError(checked.message);
  const config: Record<string, unknown> = {};
  for (const key of settingKeys) {
    const path = (settingsRegistry[key] as SettingDefinition).publicPath;
    if (!path) continue;
    if (!Object.hasOwn(checked.value, key)) throw new TypeError(`Public ayar değeri yok: ${key}`);
    let node = config;
    for (const part of path.slice(0, -1)) node = (node[part] ??= {}) as Record<string, unknown>;
    node[path.at(-1)!] = checked.value[key];
  }
  return PublicConfig.parse(config);
}

/** Kayıt anahtarları `Setting.key` biçimindedir (admin.settings.update path parametresi). */
export const settingKeyPattern = Setting.shape.key;

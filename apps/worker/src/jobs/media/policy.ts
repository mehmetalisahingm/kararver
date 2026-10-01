// NudeNet çıktısından risk seviyesi (docs/MEDIA_MODERATION.md §6.1). Model nihai otorite değildir;
// orta ve yüksek risk moderatör kuyruğuna gider, sadece düşük risk otomatik yayınlanır.

export type Detection = { class: string; score: number };
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type RiskThresholds = { high: number; medium: number };

/** Admin ayarı gelene kadar (KV-40, "moderasyon risk eşikleri") MEDIA_MODERATION §6.1 varsayılanları. */
export const DEFAULT_THRESHOLDS: RiskThresholds = { high: 0.65, medium: 0.35 };

const HIGH_CLASSES = new Set([
  "FEMALE_GENITALIA_EXPOSED",
  "MALE_GENITALIA_EXPOSED",
  "ANUS_EXPOSED",
  "FEMALE_BREAST_EXPOSED",
  "BUTTOCKS_EXPOSED",
]);
/** Tek başına yüksek güvenle bile sadece incelemeye düşer. */
const MEDIUM_CLASSES = new Set(["MALE_BREAST_EXPOSED", "BELLY_EXPOSED"]);

export type RiskResult = { level: RiskLevel; score: number };

/** Birden fazla bölge varsa en kötüsü kazanır (fail-closed). */
export function assessRisk(detections: readonly Detection[], t: RiskThresholds = DEFAULT_THRESHOLDS): RiskResult {
  let high = 0;
  let medium = 0;
  for (const d of detections) {
    if (HIGH_CLASSES.has(d.class)) high = Math.max(high, d.score);
    else if (MEDIUM_CLASSES.has(d.class)) medium = Math.max(medium, d.score);
  }
  const score = Math.max(high, medium);
  if (high >= t.high) return { level: "HIGH", score };
  if (high >= t.medium || medium >= t.high) return { level: "MEDIUM", score };
  return { level: "LOW", score };
}

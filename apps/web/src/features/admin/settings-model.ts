// Sistem ayarları ekranının saf kuralları (KV-40, #42): gruplama, giriş ayrıştırma, acil durum anahtarı açıklamaları.
// Anahtar, tip, aralık ve açıklama contracts kayıt defterinden gelir (`settingsRegistry`); sunucu zaten doğrular (400),
// buradaki kontroller yalnız boş/yanlış girişi göndermeden önce yakalamak içindir.
import { emergencySwitchSettings, settingsRegistry, type SettingKey } from "@kararver/contracts";

export type EmergencyName = keyof typeof emergencySwitchSettings;

export const emergencySwitches: { name: EmergencyName; key: SettingKey; label: string; effect: string }[] = [
  { name: "registration", key: emergencySwitchSettings.registration, label: "Yeni kayıt", effect: "Kapalıyken yeni hesap açılamaz; mevcut hesaplar giriş yapabilir." },
  { name: "pollCreation", key: emergencySwitchSettings.pollCreation, label: "Anket ve tartışma açma", effect: "Kapalıyken yeni anket ve tartışma yayınlanamaz; okuma ve oy verme sürer." },
  { name: "comments", key: emergencySwitchSettings.comments, label: "Yorumlar", effect: "Kapalıyken yeni yorum ve cevap yazılamaz; mevcut yorumlar görünür." },
  { name: "uploads", key: emergencySwitchSettings.uploads, label: "Görsel yükleme", effect: "Kapalıyken yeni görsel yüklenemez; yayındaki görseller görünür." },
  { name: "maintenance", key: emergencySwitchSettings.maintenance, label: "Bakım modu", effect: "Açıkken bütün yazma işlemleri (oy, yorum, anket, rapor…) durur; okuma, giriş ve yönetim paneli açık kalır." },
];

const emergencyKeys: ReadonlySet<string> = new Set(emergencySwitches.map((s) => s.key));

/** Bakım modunda "açık" tehlikeli durumdur; diğer anahtarlarda "kapalı". */
export const isRisky = (name: EmergencyName, value: boolean) => (name === "maintenance" ? value : !value);

export const groupLabels: Record<string, string> = {
  polls: "Anket",
  comments: "Yorum",
  media: "Görsel",
  points: "Puan",
  trends: "Trend",
  feed: "Senin İçin akışı",
  limits: "Hız sınırları",
  features: "Özellikler",
  maintenance: "Bakım",
};
const groupOrder = Object.keys(groupLabels);

export const groupOf = (key: string) => key.split(".")[0]!;

/** Acil durum anahtarları ayrı bölümde; tabloda yalnız değer ayarları görünür. */
export const isEmergencyKey = (key: string) => emergencyKeys.has(key);

type Definition = (typeof settingsRegistry)[SettingKey];
export const definitionOf = (key: string): Definition | null => (Object.hasOwn(settingsRegistry, key) ? settingsRegistry[key as SettingKey] : null);

/** Kayıt defterindeki açıklama; bilinmeyen (yeni sürümde eklenmiş) anahtar için anahtarın kendisi. */
export const labelOf = (key: string) => definitionOf(key)?.description ?? key;

export function rangeOf(key: string): string | null {
  const d = definitionOf(key);
  if (!d || d.type !== "integer") return null;
  if (d.min !== null && d.max !== null) return `${d.min}–${d.max}`;
  if (d.min !== null) return `en az ${d.min}`;
  if (d.max !== null) return `en fazla ${d.max}`;
  return null;
}

/** Sıralı gruplar; grup içinde anahtar sırası kayıt defteri sırasındadır. */
export function groupSettings<T extends { key: string }>(items: readonly T[]): { group: string; label: string; items: T[] }[] {
  const byGroup = new Map<string, T[]>();
  for (const item of items) {
    if (isEmergencyKey(item.key)) continue;
    const group = groupOf(item.key);
    byGroup.set(group, [...(byGroup.get(group) ?? []), item]);
  }
  const rank = (g: string) => (groupOrder.includes(g) ? groupOrder.indexOf(g) : groupOrder.length);
  return [...byGroup.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([group, list]) => ({ group, label: groupLabels[group] ?? group, items: list }));
}

export type ParsedValue = { ok: true; value: unknown } | { ok: false; message: string };

/** Giriş metnini ayarın tipine çevirir. Tam sayı ayarında ondalık veya boş giriş reddedilir. */
export function parseInput(key: string, current: unknown, raw: string | boolean | string[]): ParsedValue {
  if (typeof current === "boolean") return { ok: true, value: raw === true || raw === "true" };
  if (Array.isArray(current)) {
    if (!Array.isArray(raw) || raw.length === 0) return { ok: false, message: "En az bir tür seçilmeli." };
    return { ok: true, value: raw };
  }
  const text = String(raw).trim();
  if (!/^-?\d+$/.test(text)) return { ok: false, message: "Tam sayı gir." };
  const value = Number(text);
  const d = definitionOf(key);
  if (d && d.type === "integer") {
    if (d.min !== null && value < d.min) return { ok: false, message: `En az ${d.min} olmalı.` };
    if (d.max !== null && value > d.max) return { ok: false, message: `En fazla ${d.max} olmalı.` };
  }
  return { ok: true, value };
}

/** Tabloda gösterilecek değer. */
export function formatValue(key: string, value: unknown): string {
  if (typeof value === "boolean") return value ? "Açık" : "Kapalı";
  if (Array.isArray(value)) return value.join(", ");
  if (key === "media.maxBytes" && typeof value === "number") return `${value.toLocaleString("tr-TR")} bayt (${(value / 1024 / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB)`;
  return typeof value === "number" ? value.toLocaleString("tr-TR") : String(value);
}

export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// admin.audit.list okuma tarafı savunma katmanı (#185). Yazma yolu (contracts assertAuditEntry) hassas anahtarı zaten
// reddeder; bu katman eski, elle eklenmiş veya kuralı atlatmış kayıtların yanıtta sızmasını önler. Kayıt değişmez
// (append-only): yalnız yanıttaki kopya temizlenir.
//
// Eşleşme anahtarın kelimelerine göredir (camelCase, snake_case, kebab-case, büyük harf kısaltmaları bölünür), büyük/küçük
// harf duyarsız. Düz "içerir" yerine kelime: `ip` ve `otp` gibi kısa adlar `description`, `recipient`, `footprint` gibi
// zararsız alanları gizlemesin diye.

export const REDACTED = "[gizli]";

/** Tek başına hassas kelimeler (çoğul ekleri de: tokens, hashes, sessions). */
const SENSITIVE_WORDS = new Set([
  "password",
  "passwd",
  "hash",
  "token",
  "secret",
  "mfa",
  "totp",
  "otp",
  "recovery",
  "apikey",
  "cookie",
  "session",
  "email",
  "ip",
  "useragent",
]);
/** Birden çok kelimeye bölünen hassas adlar: apiKey / api_key, userAgent / user-agent. */
const SENSITIVE_SEQUENCES = [
  ["api", "key"],
  ["user", "agent"],
];

export function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+|(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

const singular = (w: string) => (w.endsWith("es") && SENSITIVE_WORDS.has(w.slice(0, -2)) ? w.slice(0, -2) : w.endsWith("s") ? w.slice(0, -1) : w);

export function isSensitiveKey(key: string): boolean {
  const words = keyWords(key);
  if (words.some((w) => SENSITIVE_WORDS.has(w) || SENSITIVE_WORDS.has(singular(w)))) return true;
  return SENSITIVE_SEQUENCES.some((seq) => words.some((_, i) => seq.every((s, j) => words[i + j] === s || (j === seq.length - 1 && singular(words[i + j] ?? "") === s))));
}

/** before/after özetinin hassas alanları "[gizli]" olan kopyası; iç içe nesne ve dizilerde de. */
export function redactAuditSummary<T>(value: T): T {
  return redact(value) as T;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = isSensitiveKey(k) ? REDACTED : redact(v);
    return out;
  }
  return value;
}

// Technical preference only: this is not a legal approval or a user/account identifier.
export const PRIVACY_PREFERENCE_KEY = "kv.privacy.preferences";
export const SHARE_ATTRIBUTION_KEY = "kv.share.attribution";
export const PRIVACY_PREFERENCE_EVENT = "kv:privacy-preferences-changed";
export const PREFERENCE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export type PrivacyPreference = { version: 1; measurement: boolean; updatedAt: string };
export type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
// If withdrawal cannot be persisted, never reuse an older grant in this document.
const blockedStores = new WeakSet<PreferenceStorage>();
let measurementBlockedInDocument = false;

export function browserPreferenceStorage(): PreferenceStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

export function clearShareAttribution(storage: PreferenceStorage | null): void {
  try { storage?.removeItem(SHARE_ATTRIBUTION_KEY); }
  catch { /* Optional storage must never prevent browsing, login or withdrawal. */ }
}

export function readPrivacyPreference(storage = browserPreferenceStorage(), now = Date.now()): PrivacyPreference | null {
  if (typeof window !== "undefined" && measurementBlockedInDocument) { clearShareAttribution(storage); return null; }
  if (storage && blockedStores.has(storage)) { clearShareAttribution(storage); return null; }
  try {
    const raw = storage?.getItem(PRIVACY_PREFERENCE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === "object" && "version" in value && value.version === 1 &&
        "measurement" in value && typeof value.measurement === "boolean" &&
        "updatedAt" in value && typeof value.updatedAt === "string") {
      const at = Date.parse(value.updatedAt);
      if (Number.isFinite(at) && at <= now && now - at < PREFERENCE_LIFETIME_MS) {
        if (!value.measurement) clearShareAttribution(storage);
        return { version: 1, measurement: value.measurement, updatedAt: value.updatedAt };
      }
    }
    storage?.removeItem(PRIVACY_PREFERENCE_KEY);
  } catch { /* Missing, malformed, expired or inaccessible preference means measurement is off. */ }
  clearShareAttribution(storage);
  return null;
}

export function savePrivacyPreference(measurement: boolean, storage = browserPreferenceStorage(), now = Date.now()): boolean {
  if (!measurement) clearShareAttribution(storage);
  try {
    if (!storage) {
      if (typeof window !== "undefined") measurementBlockedInDocument = true;
      return false;
    }
    const value: PrivacyPreference = { version: 1, measurement, updatedAt: new Date(now).toISOString() };
    storage.setItem(PRIVACY_PREFERENCE_KEY, JSON.stringify(value));
    blockedStores.delete(storage);
    if (typeof window !== "undefined") measurementBlockedInDocument = false;
    const saved = readPrivacyPreference(storage, now);
    if (saved?.measurement === measurement && saved.updatedAt === value.updatedAt) return true;
  } catch { /* Persisted consent is required; a failed write must not enable measurement. */ }
  if (storage) blockedStores.add(storage);
  if (typeof window !== "undefined") measurementBlockedInDocument = true;
  clearShareAttribution(storage);
  return false;
}

import {
  browserPreferenceStorage, clearShareAttribution, readPrivacyPreference, SHARE_ATTRIBUTION_KEY,
  PREFERENCE_LIFETIME_MS,
} from "./privacy-preferences.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ShareAttribution = { shareId: string; capturedAt: string };

export function readShareAttribution(storage = browserPreferenceStorage(), now = Date.now()): ShareAttribution | null {
  const preference = readPrivacyPreference(storage, now);
  if (preference?.measurement !== true) return null;
  try {
    const raw = storage?.getItem(SHARE_ATTRIBUTION_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === "object" && "shareId" in value && typeof value.shareId === "string" &&
        UUID.test(value.shareId) && "capturedAt" in value && typeof value.capturedAt === "string") {
      const at = Date.parse(value.capturedAt);
      if (Number.isFinite(at) && at >= Date.parse(preference.updatedAt) && at <= now && now - at < PREFERENCE_LIFETIME_MS)
        return { shareId: value.shareId, capturedAt: value.capturedAt };
    }
  } catch { /* Optional context; never expose storage errors to the product flow. */ }
  clearShareAttribution(storage);
  return null;
}

export function captureShareAttribution(shareId: string | null, storage = browserPreferenceStorage(), now = Date.now()): void {
  if (readPrivacyPreference(storage, now)?.measurement !== true) return;
  if (readShareAttribution(storage, now) || !shareId || !UUID.test(shareId)) return;
  const value: ShareAttribution = { shareId, capturedAt: new Date(now).toISOString() };
  try { storage?.setItem(SHARE_ATTRIBUTION_KEY, JSON.stringify(value)); }
  catch { /* Optional measurement cannot block navigation. */ }
}

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRIVACY_PREFERENCE_KEY, SHARE_ATTRIBUTION_KEY, PREFERENCE_LIFETIME_MS,
  readPrivacyPreference, savePrivacyPreference, type PreferenceStorage,
} from "../src/lib/privacy-preferences.ts";
import { captureShareAttribution, readShareAttribution } from "../src/lib/share-attribution.ts";

const now = Date.parse("2026-11-01T12:00:00.000Z");
const first = "019b2234-5678-7abc-8def-0123456789ab";
const second = "019b2234-5678-7abc-8def-0123456789ac";
function store() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); } };
}
const attribution = (shareId = first, capturedAt = now) => JSON.stringify({ shareId, capturedAt: new Date(capturedAt).toISOString() });

test("no choice never captures a source; legacy attribution is removed without touching functional storage", () => {
  const s = store();
  s.setItem(SHARE_ATTRIBUTION_KEY, attribution());
  s.setItem("kararver:theme", "dark");
  s.setItem("kv-welcome-draft-v1", "draft");
  captureShareAttribution(first, s, now);
  assert.equal(readShareAttribution(s, now), null);
  assert.equal(s.getItem(SHARE_ATTRIBUTION_KEY), null);
  assert.equal(s.getItem(PRIVACY_PREFERENCE_KEY), null);
  assert.equal(s.getItem("kararver:theme"), "dark");
  assert.equal(s.getItem("kv-welcome-draft-v1"), "draft");
});

test("explicit grant permits first-touch capture; read does not extend preference or attribution lifetime", () => {
  const s = store();
  assert.equal(savePrivacyPreference(true, s, now), true);
  captureShareAttribution(first, s, now + 1);
  captureShareAttribution(second, s, now + 2);
  assert.deepEqual(readShareAttribution(s, now + 1000), { shareId: first, capturedAt: new Date(now + 1).toISOString() });
  assert.deepEqual(JSON.parse(s.getItem(PRIVACY_PREFERENCE_KEY)!), { version: 1, measurement: true, updatedAt: new Date(now).toISOString() });
});

test("denial and withdrawal clear the source and cannot be bypassed by a subsequent URL or reader", () => {
  const s = store();
  savePrivacyPreference(true, s, now);
  captureShareAttribution(first, s, now);
  assert.ok(readShareAttribution(s, now));
  assert.equal(savePrivacyPreference(false, s, now + 1), true);
  s.setItem(SHARE_ATTRIBUTION_KEY, attribution(second, now + 1));
  captureShareAttribution(second, s, now + 2);
  assert.equal(readShareAttribution(s, now + 2), null);
  assert.equal(s.getItem(SHARE_ATTRIBUTION_KEY), null);
  assert.equal(readPrivacyPreference(s, now + 2)?.measurement, false);
});

test("expired, future, unknown-version and malformed preferences fail closed", () => {
  const invalid = ["null", "[]", "{", "true", JSON.stringify({version: 2, measurement: true, updatedAt: new Date(now).toISOString()}),
    JSON.stringify({version: 1, measurement: "true", updatedAt: new Date(now).toISOString()}),
    JSON.stringify({version: 1, measurement: true, updatedAt: new Date(now + 1).toISOString()}),
    JSON.stringify({version: 1, measurement: true, updatedAt: new Date(now - PREFERENCE_LIFETIME_MS).toISOString()})];
  for (const raw of invalid) {
    const s = store();
    s.setItem(PRIVACY_PREFERENCE_KEY, raw);
    s.setItem(SHARE_ATTRIBUTION_KEY, attribution());
    captureShareAttribution(first, s, now);
    assert.equal(readShareAttribution(s, now), null, raw);
    assert.equal(s.getItem(SHARE_ATTRIBUTION_KEY), null, raw);
  }
});

test("pre-consent, future, expired and malformed source records cannot be reused", () => {
  for (const raw of ["null", "[]", "{", attribution(first, now - 1), attribution(first, now + 1),
    attribution(first, now - PREFERENCE_LIFETIME_MS), attribution("not-a-uuid")]) {
    const s = store();
    savePrivacyPreference(true, s, now);
    s.setItem(SHARE_ATTRIBUTION_KEY, raw);
    assert.equal(readShareAttribution(s, now), null, raw);
    assert.equal(s.getItem(SHARE_ATTRIBUTION_KEY), null, raw);
  }
});

test("preference expiry stops capture and removes the previous source even without a page reload", () => {
  const s = store();
  savePrivacyPreference(true, s, now);
  captureShareAttribution(first, s, now);
  captureShareAttribution(second, s, now + PREFERENCE_LIFETIME_MS);
  assert.equal(readShareAttribution(s, now + PREFERENCE_LIFETIME_MS), null);
  assert.equal(s.getItem(SHARE_ATTRIBUTION_KEY), null);
});

test("cross-tab withdrawal is observed by the next capture/read without a cached grant", () => {
  const s = store();
  savePrivacyPreference(true, s, now);
  captureShareAttribution(first, s, now);
  s.setItem(PRIVACY_PREFERENCE_KEY, JSON.stringify({ version: 1, measurement: false, updatedAt: new Date(now + 1).toISOString() }));
  captureShareAttribution(second, s, now + 2);
  assert.equal(readShareAttribution(s, now + 2), null);
  assert.equal(s.getItem(SHARE_ATTRIBUTION_KEY), null);
});

test("blocked storage never throws and a failed withdrawal cannot revive an old grant in this document", () => {
  const blocked: PreferenceStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(savePrivacyPreference(true, blocked, now), false);
  assert.equal(readShareAttribution(blocked, now), null);
  assert.doesNotThrow(() => captureShareAttribution(first, blocked, now));
  assert.equal(savePrivacyPreference(true, null, now), false);
  const s = store();
  savePrivacyPreference(true, s, now);
  captureShareAttribution(first, s, now);
  const failingWrite: PreferenceStorage = { getItem: s.getItem, removeItem: s.removeItem, setItem() { throw new Error("quota"); } };
  assert.equal(savePrivacyPreference(false, failingWrite, now + 1), false);
  assert.equal(s.getItem(SHARE_ATTRIBUTION_KEY), null);
  captureShareAttribution(second, failingWrite, now + 2);
  assert.equal(readShareAttribution(failingWrite, now + 2), null);
  assert.equal(s.getItem(SHARE_ATTRIBUTION_KEY), null);
});

test("server-side callers have no browser storage and do not capture anything", () => {
  assert.equal(readPrivacyPreference(), null);
  assert.equal(readShareAttribution(), null);
  assert.doesNotThrow(() => captureShareAttribution(first));
});

test("withdrawal while the browser storage getter is blocked cannot revive a grant when access returns", () => {
  const s = store();
  savePrivacyPreference(true, s, now);
  captureShareAttribution(first, s, now);
  let unavailable = true;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    get localStorage() { if (unavailable) throw new Error("denied"); return s; },
  } });
  try {
    assert.equal(savePrivacyPreference(false, undefined, now + 1), false);
    unavailable = false;
    captureShareAttribution(second, undefined, now + 2);
    assert.equal(readShareAttribution(undefined, now + 2), null);
    assert.equal(s.getItem(SHARE_ATTRIBUTION_KEY), null);
    assert.equal(savePrivacyPreference(true, undefined, now + 3), true);
    captureShareAttribution(second, undefined, now + 3);
    assert.equal(readShareAttribution(undefined, now + 3)?.shareId, second);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

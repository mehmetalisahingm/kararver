// KV-04 ayar kayıt defteri testleri: PublicConfig ile birebir eşleme, anahtar biçimi,
// bilinmeyen anahtar, aralık/tip doğrulaması, kaynak kuralı ve acil durum eşlemesi. DB gerektirmez.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { z } from "zod";
import {
  buildPublicConfig,
  CreatePollBody,
  defaultSettings,
  emergencySwitchSettings,
  getEndpoint,
  parseSettingValue,
  PublicConfig,
  Setting,
  settingKeys,
  settingsRegistry,
  validateSettings,
  type SettingDefinition,
  type SettingKey,
} from "../src/index.ts";

const def = (k: SettingKey) => settingsRegistry[k] as SettingDefinition;

/** Kaynağı olmayan varsayılanlar (açık konu). Liste değişirse test bilinçli güncellenir. */
const MISSING_DEFAULTS: SettingKey[] = [
  "polls.voteChangeAllowed",
  "features.registration",
  "features.pollCreation",
  "features.comments",
  "features.uploads",
  "maintenance.enabled",
];

function leafPaths(schema: z.ZodObject, prefix: string[] = []): string[] {
  return Object.entries(schema.shape).flatMap(([k, v]) =>
    v instanceof z.ZodObject ? leafPaths(v, [...prefix, k]) : [[...prefix, k].join(".")],
  );
}

describe("kayıt defteri ↔ PublicConfig", () => {
  test("her public anahtar bir PublicConfig alanına birebir karşılık gelir; eksik/fazla yok", () => {
    const registryPaths = settingKeys.map((k) => def(k).publicPath).filter((p) => p !== null).map((p) => p.join("."));
    assert.equal(new Set(registryPaths).size, registryPaths.length, "iki anahtar aynı alana yazıyor");
    assert.deepEqual([...registryPaths].sort(), leafPaths(PublicConfig).sort());
  });

  test("varsayılanı eksik alanlar listeli (PR taslak kalır)", () => {
    assert.deepEqual(defaultSettings().missing, MISSING_DEFAULTS);
  });

  test(
    "varsayılanlardan üretilen config PublicConfig.parse()'tan geçer",
    { todo: `resmî varsayılanı olmayan alanlar: ${MISSING_DEFAULTS.join(", ")}` },
    () => {
      PublicConfig.parse(buildPublicConfig(defaultSettings().values));
    },
  );

  test("eksik alanlar dışarıdan verildiğinde varsayılanlar PublicConfig şeklini tam doldurur", () => {
    // Bu değerler test girdisidir, varsayılan DEĞİLDİR; yalnız eşlemenin tamlığını gösterir.
    const supplied = Object.fromEntries(MISSING_DEFAULTS.map((k) => [k, false]));
    const config = buildPublicConfig({ ...defaultSettings().values, ...supplied });
    assert.deepEqual(PublicConfig.parse(config), config);
    assert.equal(config.polls.maxDurationHours, 720);
    assert.equal(config.media.maxBytes, 8 * 1024 * 1024);
    assert.deepEqual(config.points, { initialGrant: 20, publishCost: 10 });
  });

  test("public olmayan ayar /config'e sızmaz", () => {
    const supplied = Object.fromEntries(MISSING_DEFAULTS.map((k) => [k, true]));
    const config = buildPublicConfig({ ...defaultSettings().values, ...supplied });
    assert.ok(!("trends" in config));
    assert.ok(settingKeys.some((k) => def(k).publicPath === null));
  });

  test("public anahtarın değeri yoksa /config kurulmaz (varsayılan uydurulmaz)", () => {
    assert.throws(() => buildPublicConfig(defaultSettings().values), /Public ayar değeri yok: polls\.voteChangeAllowed/);
  });
});

describe("anahtar ve kaynak kuralları", () => {
  test("her anahtar Setting.key regex'inden geçer", () => {
    for (const k of settingKeys) assert.ok(Setting.shape.key.safeParse(k).success, k);
  });

  test("her varsayılanın kaynağı var; eksik olanın gerekçesi var; fixture kaynak değildir", () => {
    for (const k of settingKeys) {
      const d = def(k);
      if (d.default === null) {
        assert.ok(d.missing && d.missing.length > 10, `${k}: missing gerekçesi`);
      } else {
        assert.ok(/(docs\/|packages\/contracts\/src\/|PRODUCT_TEAM_PLAN)/.test(d.default.source), `${k}: ${d.default.source}`);
        assert.ok(!/fixtures/.test(d.default.source), `${k}: fixture resmî kaynak değil`);
        assert.ok(parseSettingValue(k, d.default.value).ok, `${k}: varsayılan kendi sınırına uymuyor`);
      }
    }
  });

  test("resmî varsayılanlar", () => {
    const v = defaultSettings().values;
    assert.equal(v["media.maxBytes"], 8 * 1024 * 1024);
    assert.equal(v["polls.minDurationHours"], 1);
    assert.equal(v["polls.maxDurationHours"], 720);
    assert.equal(v["points.initialGrant"], 20);
    assert.equal(v["points.publishCost"], 10);
    assert.equal(v["trends.moversMinVotes"], 30);
    assert.equal(v["trends.moversMinActiveAccounts"], 10);
  });

  test("FOUNDATION_CONTRACTS namespace listesi kayıt defterini kapsar", () => {
    const doc = readFileSync(path.join(import.meta.dirname, "../../../docs/FOUNDATION_CONTRACTS.md"), "utf8");
    const section = doc.slice(doc.indexOf("Settings namespace'leri"), doc.indexOf("KV-40'da saklanır"));
    for (const k of settingKeys) {
      const ns = k.split(".")[0];
      assert.ok(section.includes(`\`${ns}.*\``) || section.includes(`\`${k}\``), `${k} belgede yok`);
    }
    assert.ok(!section.includes("registration.enabled"), "eski ad registration.enabled kaldırılmalı");
  });

  test("cooldown, günlük limit, trend katsayısı ve feed.* kayıtta yok", () => {
    assert.deepEqual(settingKeys.filter((k) => /^feed\.|cooldown|daily|coefficient|weight/i.test(k)), []);
  });
});

describe("doğrulama", () => {
  test("bilinmeyen anahtar NOT_FOUND", () => {
    for (const k of ["polls.unknown", "registration.enabled", "features.everything", "__proto__", "constructor"]) {
      const r = parseSettingValue(k, true);
      assert.equal(r.ok, false, k);
      assert.equal(!r.ok && r.code, "NOT_FOUND", k);
    }
    const all = validateSettings({ "polls.minOptions": 2, "polls.hacked": 1 });
    assert.equal(!all.ok && all.code, "NOT_FOUND");
  });

  test("min/max dışı değer VALIDATION_ERROR", () => {
    for (const k of settingKeys.filter((x) => def(x).type === "integer")) {
      const { min, max } = def(k);
      if (min !== null) {
        assert.ok(parseSettingValue(k, min).ok, `${k} min`);
        const r = parseSettingValue(k, min - 1);
        assert.equal(!r.ok && r.code, "VALIDATION_ERROR", `${k} min-1`);
      }
      if (max !== null) {
        assert.ok(parseSettingValue(k, max).ok, `${k} max`);
        const r = parseSettingValue(k, max + 1);
        assert.equal(!r.ok && r.code, "VALIDATION_ERROR", `${k} max+1`);
      }
    }
  });

  test("tip dışı değer VALIDATION_ERROR", () => {
    const cases: [SettingKey, unknown][] = [
      ["polls.maxOptions", "6"],
      ["polls.maxOptions", 5.5],
      ["media.maxBytes", null],
      ["features.uploads", "false"],
      ["maintenance.enabled", 1],
      ["media.allowedTypes", []],
      ["media.allowedTypes", ["image/gif"]],
      ["media.allowedTypes", ["image/png", "image/png"]],
    ];
    for (const [k, v] of cases) {
      const r = parseSettingValue(k, v);
      assert.equal(!r.ok && r.code, "VALIDATION_ERROR", `${k} = ${JSON.stringify(v)}`);
    }
    assert.ok(parseSettingValue("media.allowedTypes", ["image/webp"]).ok);
  });

  test("alanlar arası kurallar", () => {
    const bad = validateSettings({ "polls.minOptions": 5, "polls.maxOptions": 3 });
    assert.equal(!bad.ok && bad.code, "VALIDATION_ERROR");
    const bad2 = validateSettings({ "polls.minDurationHours": 48, "polls.maxDurationHours": 24 });
    assert.equal(!bad2.ok && bad2.code, "VALIDATION_ERROR");
    assert.ok(validateSettings({ "polls.minOptions": 3, "polls.maxOptions": 3 }).ok);
  });
});

describe("config ↔ API tutarlılığı", () => {
  const poll = (mediaCount: number) => ({
    kind: "POLL",
    title: "Bu araba bu fiyata alınır mı?",
    categoryId: "0190f3a4-0000-7000-8000-000000000001",
    durationHours: 24,
    resultsVisibility: "ALWAYS",
    options: [{ label: "Evet" }, { label: "Hayır" }],
    mediaIds: Array.from({ length: mediaCount }, (_, i) => `0190f3a4-0000-7000-8000-${String(i + 100).padStart(12, "0")}`),
  });

  test("media.maxPerPoll tavanı polls.ts mediaIds şemasıyla aynı (10)", () => {
    assert.equal(def("media.maxPerPoll").max, 10);
    assert.ok(CreatePollBody.safeParse(poll(10)).success);
    assert.equal(CreatePollBody.safeParse(poll(11)).success, false);
    assert.ok(parseSettingValue("media.maxPerPoll", 10).ok);
    assert.equal(parseSettingValue("media.maxPerPoll", 11).ok, false);
  });
});

describe("acil durum anahtarları", () => {
  test("admin.emergency.put anahtarlarının hepsi bir ayara bağlı ve boolean", () => {
    const body = getEndpoint("admin.emergency.put").request.body as z.ZodObject;
    const switches = body.shape.switches as z.ZodObject;
    assert.deepEqual(Object.keys(switches.shape).sort(), Object.keys(emergencySwitchSettings).sort());
    for (const key of Object.values(emergencySwitchSettings)) assert.equal(def(key).type, "boolean", key);
  });

  test("features.* ve maintenance.enabled adlandırması koddaki alanlarla aynı", () => {
    for (const k of Object.keys(PublicConfig.shape.features.shape)) assert.ok(settingKeys.includes(`features.${k}` as SettingKey), k);
    assert.deepEqual(def("maintenance.enabled").publicPath, ["maintenance"]);
  });
});

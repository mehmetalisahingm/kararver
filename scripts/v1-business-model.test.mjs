// #285 — işletmeci ücretsiz/reklamsız V1 kararı için statik negatif regresyon.
 // Bu test, çalışma zamanı/ağ trafiği veya hukuki kabul kanıtı değildir;
 // yeni gelir modülü/SDK eklenmesini kod incelemesine zorlayan savunmadır.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = path => readFileSync(join(root, path), "utf8");

test("V1 ürün kararı: ücret, reklam, sponsor, abonelik, puan satışı ve pazarlama kapalı", () => {
  const policy = read("apps/web/src/lib/v1-business-model.ts");
  assert.match(policy, /access:\s*"free"/);
  for (const key of [
    "advertisingEnabled", "sponsoredPollsEnabled", "paidMembershipsEnabled",
    "subscriptionsEnabled", "inAppPurchasesEnabled", "paymentsEnabled",
    "paidPointsEnabled", "pointsCashOutEnabled", "marketingEmailsEnabled",
  ]) {
    assert.match(policy, new RegExp(`\\b${key}:\\s*false\\b`), `${key} V1 için kapalı kalmalı`);
  }
  const register = read("apps/web/src/app/kayit/page.tsx");
  assert.match(register, /V1_FREE_NOTE/, "kayıt anında ücretsiz/reklamsız açıklaması gösterilmeli");
  assert.match(policy, /puanlar parayla satılmaz/i, "oyunlaştırma puanı ödeme sanılmamalı");
});

test("V1: birinci taraf ödeme/reklam SDK'sı direct dependency olarak eklenmedi", () => {
  const manifests = [
    "package.json", "apps/web/package.json", "apps/api/package.json",
    "apps/worker/package.json", "packages/contracts/package.json", "packages/db/package.json",
  ];
  const prohibited = /^(?:stripe|@stripe\/|@paypal\/|paypal(?:-|$)|@revenuecat\/|react-native-purchases$|@google-ads\/|google-adsense$|@google-adsense\/|adsbygoogle$|google-ads-api$|@paddle\/|paddle(?:-|$)|@lemonsqueezy\/|@adyen\/|iyzico|@iyzico\/|@paytr\/|paytr(?:-|$))/i;
  for (const file of manifests) {
    const json = JSON.parse(read(file));
    const installed = { ...json.dependencies, ...json.devDependencies, ...json.optionalDependencies };
    for (const name of Object.keys(installed)) {
      assert.doesNotMatch(name, prohibited, `${file}: yeni ödeme/reklam bağımlılığı ürün/hukuk incelemesi gerektirir`);
    }
  }
});

test("V1: ödeme/abonelik/reklam için yeni bir uygulama modül veya route dizini bulunmuyor", () => {
  const roots = ["apps/api/src/modules", "apps/web/src/app", "apps/web/src/features"];
  const bannedSegment = /^(?:payments?|checkout|billing|subscriptions?|ads|adverts?|advertising|sponsored|sponsorships?|paywall|purchase|purchases)$/i;
  function walk(dir) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      // Dosya adına bakılır; 'premium' dekoratif CSS ve uygulama-içi 'points' hariçtir.
      const segment = entry.isDirectory() ? entry.name : entry.name.replace(/\.[^.]+$/, "");
      assert.doesNotMatch(segment, bannedSegment, `${path}: V1 için yeni gelir modülü ürün/hukuk kararı gerektirir`);
      if (entry.isDirectory()) walk(path);
    }
  }
  roots.forEach(walk);
});

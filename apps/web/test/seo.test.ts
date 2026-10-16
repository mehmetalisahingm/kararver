import { test } from "node:test";
import assert from "node:assert/strict";
import { pollShareMetadata, publicRobots, privateMetadata, privatePaths } from "../src/lib/seo.ts";

test("public content is indexable only in the explicit production environment", () => {
  const previous = process.env.APP_ENV;
  try {
    for (const value of [undefined, "staging", "preview", "local", "prod"]) {
      if (value === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = value;
      assert.deepEqual(publicRobots(), { index: false, follow: false });
    }
    process.env.APP_ENV = "production";
    assert.deepEqual(publicRobots(), { index: true, follow: true });
    assert.deepEqual(privateMetadata.robots, { index: false, follow: false });
  } finally {
    if (previous === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previous;
  }
});

test("crawler exclusions include the real password and private delivery routes", () => {
  for (const path of ["/sifremi-unuttum", "/sifre-yenile", "/veri-indir", "/hesap", "/admin", "/ilgi-alanlari"])
    assert.ok(privatePaths.includes(path), path);
  assert.ok(!privatePaths.includes("/sifre-sifirla"));
});

test("share preview uses one canonical title and description for OG and X, without fake images", () => {
  const metadata = pollShareMetadata({
    title: "Karar testi · Kararver",
    description: "Karar verirken birlikte düşün.",
    canonical: "https://kararver.example/karar/karar-testi-12345678",
  });
  assert.deepEqual(metadata.openGraph, {
    type: "article",
    url: "https://kararver.example/karar/karar-testi-12345678",
    siteName: "Kararver",
    locale: "tr_TR",
    title: "Karar testi · Kararver",
    description: "Karar verirken birlikte düşün.",
  });
  assert.deepEqual(metadata.twitter, {
    card: "summary", title: "Karar testi · Kararver",
    description: "Karar verirken birlikte düşün.",
  });
});

test("approved image is used in both OG and X large cards, never a fallback", () => {
  const imageUrl = "https://kararver.example/api/media-public/m/00000000-0000-0000-0000-000000000001.webp";
  const metadata = pollShareMetadata({
    title: "Görselli karar · Kararver",
    description: "İki seçenek.",
    canonical: "https://kararver.example/karar/gorselli-karar-abcd1234",
    imageUrl,
  });
  assert.deepEqual(metadata.openGraph?.images, [{ url: imageUrl, alt: "Görselli karar · Kararver" }]);
  assert.deepEqual(metadata.twitter, {
    card: "summary_large_image",
    title: "Görselli karar · Kararver",
    description: "İki seçenek.",
    images: [imageUrl],
  });
});

/** dHash birim testleri (KV-38). Veritabanı gerektirmez. */
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { dHash, hamming, NEAR_DUPLICATE_MAX_DISTANCE } from "../src/jobs/media/phash.ts";

const scene = (extra = "") =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="100%" height="100%" fill="rgb(20,120,200)"/><circle cx="200" cy="160" r="110" fill="rgb(230,60,40)"/><rect x="330" y="220" width="240" height="180" fill="rgb(250,230,60)"/>${extra}</svg>`,
    ),
  )
    .blur(2)
    .png()
    .toBuffer();

test("hamming: farklı bit sayısını sayar", () => {
  assert.equal(hamming("0000000000000000", "0000000000000000"), 0);
  assert.equal(hamming("0000000000000000", "ffffffffffffffff"), 64);
  assert.equal(hamming("0000000000000001", "8000000000000000"), 2);
  assert.equal(hamming("00000000000000f0", "000000000000000f"), 8);
});

test("dHash 16 haneli küçük harf hex döner ve aynı girdide aynıdır", async () => {
  const image = await scene();
  const a = await dHash(image);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(await dHash(image), a);
});

test("yeniden boyutlandırma ve yeniden sıkıştırma eşik içinde kalır; farklı görsel uzak düşer", async () => {
  const image = await scene();
  const original = await dHash(image);
  const small = await dHash(await sharp(image).resize(160).jpeg({ quality: 40 }).toBuffer());
  assert.ok(hamming(original, small) <= NEAR_DUPLICATE_MAX_DISTANCE, `uzaklık ${hamming(original, small)}`);

  const other = await dHash(await scene('<circle cx="470" cy="90" r="80" fill="rgb(10,10,10)"/><rect x="0" y="330" width="300" height="150" fill="rgb(255,255,255)"/>'));
  assert.ok(hamming(original, other) > NEAR_DUPLICATE_MAX_DISTANCE, `uzaklık ${hamming(original, other)}`);
});

test("saydam görsel beyaz zemine düşer; saydam ve opak sürüm yakın kalır", async () => {
  const opaque = await scene();
  const transparent = await sharp(opaque).ensureAlpha(0.95).png().toBuffer();
  assert.ok(hamming(await dHash(opaque), await dHash(transparent)) <= NEAR_DUPLICATE_MAX_DISTANCE);
});

// Görsel doğrulama ve re-encode (docs/MEDIA_MODERATION.md §5). Gerçek sharp/libvips ile, sentetik görsellerle.
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { InvalidImageError, MAX_EDGE_PX, reencodeImage, sniffImageType } from "../src/jobs/media/image.ts";

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 120, g: 40, b: 200 } } });

test("dosya türü içerikten tespit edilir, uzantı/beyan değil", async () => {
  assert.equal(sniffImageType(await solid(8, 8).jpeg().toBuffer()), "image/jpeg");
  assert.equal(sniffImageType(await solid(8, 8).png().toBuffer()), "image/png");
  assert.equal(sniffImageType(await solid(8, 8).webp().toBuffer()), "image/webp");
  assert.equal(sniffImageType(await solid(8, 8).gif().toBuffer()), null);
  assert.equal(sniffImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null);
  assert.equal(sniffImageType(Buffer.from("<html><script>alert(1)</script>")), null);
  assert.equal(sniffImageType(Buffer.alloc(2)), null);
});

test("EXIF (GPS dahil) ve diğer meta veriler çıktıda yok", async () => {
  const input = await solid(64, 48)
    .withExif({ IFD0: { Copyright: "gizli", Artist: "Ad Soyad" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "41/1 17/1 0/1" } })
    .jpeg()
    .toBuffer();
  const before = await sharp(input).metadata();
  assert.ok(before.exif && before.exif.length > 0, "girdi gerçekten EXIF taşıyor");

  const out = await reencodeImage(input);
  const after = await sharp(out.data).metadata();
  assert.equal(after.format, "webp");
  assert.equal(after.exif, undefined);
  assert.equal(after.xmp, undefined);
  assert.equal(after.icc, undefined);
  assert.ok(!out.data.includes(Buffer.from("gizli")) && !out.data.includes(Buffer.from("Ad Soyad")));
});

test("EXIF yönü piksellere uygulanır (yan çekilmiş telefon fotoğrafı dik çıkar)", async () => {
  const rotated = await solid(60, 40).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const out = await reencodeImage(rotated);
  assert.deepEqual([out.width, out.height], [40, 60]);
  assert.equal((await sharp(out.data).metadata()).orientation, undefined);
});

test("uzun kenar 2048 px'e küçültülür, küçük görsel büyütülmez", async () => {
  const big = await reencodeImage(await solid(4000, 3000).jpeg().toBuffer());
  assert.deepEqual([big.width, big.height], [MAX_EDGE_PX, 1536]);
  const small = await reencodeImage(await solid(300, 200).png().toBuffer());
  assert.deepEqual([small.width, small.height], [300, 200]);
});

test("bozuk dosya ve sıkıştırma bombası InvalidImageError", async () => {
  const jpeg = await solid(64, 64).jpeg().toBuffer();
  await assert.rejects(reencodeImage(jpeg.subarray(0, 40)), InvalidImageError);
  await assert.rejects(reencodeImage(Buffer.from("ffd8ffe0 bu bir görsel değil")), InvalidImageError);
  // Küçük bir PNG ama 6400x6400 piksel (≈41 MP > 40 MP sınırı).
  const bomb = await sharp({ create: { width: 6_400, height: 6_400, channels: 3, background: "#000" } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  assert.ok(bomb.length < 1_000_000);
  await assert.rejects(reencodeImage(bomb), (err) => err instanceof InvalidImageError && /pixel limit/i.test(err.message));
});

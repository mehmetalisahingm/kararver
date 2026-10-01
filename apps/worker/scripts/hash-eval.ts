// Yasaklı görsel dHash eşiği ölçümü (KV-38, #40; docs/MEDIA_MODERATION.md §10).
// Çalıştırma: pnpm --filter @kararver/worker hash:eval  → scripts/hash-eval.results.json
//
// Sentetik ama yapılandırılmış görseller (rastgele renkli şekiller + bulanıklık) üretilir; her biri gerçek işlem
// hattından (reencodeImage → dHash) geçirilir. Pozitif: aynı görselin dönüşümleri (yeniden boyut, yeniden sıkıştırma,
// parlaklık, kırpma, bulanıklık). Negatif: farklı görsellerin bütün çiftleri. Sonuç, gerçek fotoğraf kümesinin yerini
// tutmaz (§8 açık konu 1: etiketli doğrulama seti); eşik seçimini sağlam bir başlangıca bağlar.
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { reencodeImage } from "../src/jobs/media/image.ts";
import { dHash, hamming, NEAR_DUPLICATE_MAX_DISTANCE } from "../src/jobs/media/phash.ts";

const COUNT = 300;
const W = 640;
const H = 480;

/** Deterministik PRNG: aynı çalıştırma aynı sonucu verir. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function svgFor(seed: number): string {
  const r = mulberry32(seed);
  const color = () => `rgb(${Math.floor(r() * 256)},${Math.floor(r() * 256)},${Math.floor(r() * 256)})`;
  const shapes: string[] = [];
  for (let i = 0; i < 14; i++) {
    const x = r() * W;
    const y = r() * H;
    shapes.push(
      r() < 0.5
        ? `<circle cx="${x}" cy="${y}" r="${20 + r() * 140}" fill="${color()}" fill-opacity="${0.5 + r() * 0.5}"/>`
        : `<rect x="${x}" y="${y}" width="${30 + r() * 260}" height="${30 + r() * 200}" fill="${color()}" fill-opacity="${0.5 + r() * 0.5}" transform="rotate(${r() * 90} ${x} ${y})"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="${color()}"/>${shapes.join("")}</svg>`;
}

async function original(seed: number): Promise<Buffer> {
  return sharp(Buffer.from(svgFor(seed))).blur(2).jpeg({ quality: 92 }).toBuffer();
}

type Variant = { name: string; make: (src: Buffer) => Promise<Buffer>; expectMatch: boolean };
const variants: Variant[] = [
  { name: "yeniden boyut 50%", make: (b) => sharp(b).resize(W / 2).jpeg({ quality: 90 }).toBuffer(), expectMatch: true },
  { name: "yeniden boyut 25%", make: (b) => sharp(b).resize(W / 4).jpeg({ quality: 90 }).toBuffer(), expectMatch: true },
  { name: "büyütme 150%", make: (b) => sharp(b).resize(Math.round(W * 1.5)).png().toBuffer(), expectMatch: true },
  { name: "JPEG q40", make: (b) => sharp(b).jpeg({ quality: 40 }).toBuffer(), expectMatch: true },
  { name: "WebP q30", make: (b) => sharp(b).webp({ quality: 30 }).toBuffer(), expectMatch: true },
  { name: "PNG", make: (b) => sharp(b).png().toBuffer(), expectMatch: true },
  { name: "parlaklık +15%", make: (b) => sharp(b).modulate({ brightness: 1.15 }).jpeg({ quality: 90 }).toBuffer(), expectMatch: true },
  { name: "doygunluk -30%", make: (b) => sharp(b).modulate({ saturation: 0.7 }).jpeg({ quality: 90 }).toBuffer(), expectMatch: true },
  { name: "bulanıklık σ=1.5", make: (b) => sharp(b).blur(1.5).jpeg({ quality: 90 }).toBuffer(), expectMatch: true },
  { name: "kenar kırpma 3%", make: (b) => sharp(b).extract({ left: 10, top: 8, width: W - 20, height: H - 16 }).jpeg({ quality: 90 }).toBuffer(), expectMatch: true },
  { name: "kenar kırpma 10%", make: (b) => sharp(b).extract({ left: 32, top: 24, width: W - 64, height: H - 48 }).jpeg({ quality: 90 }).toBuffer(), expectMatch: true },
  // Bilinen sınır: dHash yön değişimini yakalamaz. Beklenen: eşleşmez.
  { name: "yatay çevirme", make: (b) => sharp(b).flop().jpeg({ quality: 90 }).toBuffer(), expectMatch: false },
  { name: "90° döndürme", make: (b) => sharp(b).rotate(90).jpeg({ quality: 90 }).toBuffer(), expectMatch: false },
];

const hashOf = async (bytes: Buffer) => dHash((await reencodeImage(bytes)).data);

const originals: string[] = [];
const sources: Buffer[] = [];
for (let i = 0; i < COUNT; i++) {
  const src = await original(1000 + i);
  sources.push(src);
  originals.push(await hashOf(src));
}

const maxT = 20;
const rows: { variant: string; expectMatch: boolean; p50: number; p95: number; max: number; matchAt: Record<number, number> }[] = [];
for (const v of variants) {
  const distances: number[] = [];
  for (let i = 0; i < COUNT; i++) distances.push(hamming(originals[i], await hashOf(await v.make(sources[i]))));
  distances.sort((a, b) => a - b);
  const matchAt: Record<number, number> = {};
  for (let t = 0; t <= maxT; t++) matchAt[t] = distances.filter((d) => d <= t).length / COUNT;
  rows.push({ variant: v.name, expectMatch: v.expectMatch, p50: distances[Math.floor(COUNT * 0.5)], p95: distances[Math.floor(COUNT * 0.95)], max: distances.at(-1)!, matchAt });
}

// Negatifler: farklı görsellerin bütün çiftleri.
const negatives: number[] = [];
for (let i = 0; i < COUNT; i++) for (let j = i + 1; j < COUNT; j++) negatives.push(hamming(originals[i], originals[j]));
negatives.sort((a, b) => a - b);
const falsePositiveAt: Record<number, number> = {};
for (let t = 0; t <= maxT; t++) falsePositiveAt[t] = negatives.filter((d) => d <= t).length;

const result = {
  generatedAt: new Date().toISOString(),
  images: COUNT,
  negativePairs: negatives.length,
  negative: { min: negatives[0], p01: negatives[Math.floor(negatives.length * 0.01)], p50: negatives[Math.floor(negatives.length * 0.5)] },
  threshold: NEAR_DUPLICATE_MAX_DISTANCE,
  falsePositivePairsAt: falsePositiveAt,
  variants: rows,
};
writeFileSync(new URL("./hash-eval.results.json", import.meta.url), JSON.stringify(result, null, 2));

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`görsel: ${COUNT}, negatif çift: ${negatives.length}, negatif min/p01/p50: ${result.negative.min}/${result.negative.p01}/${result.negative.p50}`);
console.log(`eşik ${NEAR_DUPLICATE_MAX_DISTANCE}: yanlış pozitif çift = ${falsePositiveAt[NEAR_DUPLICATE_MAX_DISTANCE]} (${pct(falsePositiveAt[NEAR_DUPLICATE_MAX_DISTANCE] / negatives.length)})`);
for (const r of rows) {
  console.log(`${r.variant.padEnd(20)} ${r.expectMatch ? "eşleşmeli " : "eşleşmemeli"} p50=${r.p50} p95=${r.p95} max=${r.max} eşikte yakalanan=${pct(r.matchAt[NEAR_DUPLICATE_MAX_DISTANCE])}`);
}

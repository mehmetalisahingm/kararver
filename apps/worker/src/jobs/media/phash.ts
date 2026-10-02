// Algısal parmak izi (KV-38, #40): 64 bit dHash. Görsel 9x8 gri tona indirilir, her satırda komşu piksel
// karşılaştırılır (sol > sağ). Yeniden boyutlandırma, yeniden sıkıştırma, EXIF/meta veri ve küçük renk
// farkları değerini çok az oynatır; farklı görseller uzak düşer. Ölçüm: scripts/media-hash-eval (docs/MEDIA_MODERATION.md §10).
import sharp from "sharp";

export const HASH_WIDTH = 9;
export const HASH_HEIGHT = 8;
/**
 * Komşu pikseller arasındaki fark bu değerin (0–255) altındaysa bit 0 sayılır. Düz bölgelerde sıkıştırma
 * gürültüsü "sol > sağ" sonucunu rastgele çevirirdi; ölü bölge hash'i kararlı tutar (ölçüm: hash-eval).
 */
export const DEAD_BAND = 3;

/**
 * Bu uzaklık ve altı "çok benzer" sayılır ve görsel REDDEDİLMEZ, incelemeye alınır (yanlış pozitif maliyeti
 * düşük, yanlış negatif maliyeti yüksek). Seçim ve ölçüm: docs/MEDIA_MODERATION.md §10.
 */
export const NEAR_DUPLICATE_MAX_DISTANCE = 6;

/** İşlenmiş (EXIF yönü uygulanmış) görselden 16 haneli küçük harf hex. */
export async function dHash(image: Buffer): Promise<string> {
  const { data } = await sharp(image, { limitInputPixels: 40_000_000, failOn: "error" })
    // Saydam bölge siyaha değil beyaza düşer; aynı görselin saydam/opak sürümü yakın kalır.
    .flatten({ background: "#ffffff" })
    .grayscale()
    .resize(HASH_WIDTH, HASH_HEIGHT, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let y = 0; y < HASH_HEIGHT; y++) {
    for (let x = 0; x < HASH_WIDTH - 1; x++) {
      bits = (bits << 1n) | (data[y * HASH_WIDTH + x] - data[y * HASH_WIDTH + x + 1] > DEAD_BAND ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

/** İki 16 haneli hex hash arasındaki farklı bit sayısı (0–64). */
export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

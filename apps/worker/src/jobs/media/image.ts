// Görsel doğrulama ve yeniden kodlama (docs/MEDIA_MODERATION.md §5).
// Kullanıcının dosyası hiçbir zaman olduğu gibi yayınlanmaz: sharp çözer, EXIF yönünü piksellere
// uygular, yeniden boyutlandırır ve webp olarak yeniden kodlar. Çıktıda meta veri (EXIF/GPS/ICC/XMP) yoktur.
import sharp from "sharp";

export type SniffedType = "image/jpeg" | "image/png" | "image/webp";

/** İstemcinin Content-Type beyanına değil, dosyanın ilk baytlarına bakar. */
export function sniffImageType(bytes: Uint8Array): SniffedType | null {
  const at = (i: number, ...values: number[]) => values.every((v, k) => bytes[i + k] === v);
  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  // RIFF....WEBP
  if (bytes.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

/** Uzun kenar üst sınırı; daha küçük görseller büyütülmez. */
export const MAX_EDGE_PX = 2048;
/** Sıkıştırma bombasına karşı: küçük dosyada devasa piksel alanı çözülmez (40 MP). */
export const MAX_INPUT_PIXELS = 40_000_000;
export const WEBP_QUALITY = 82;

export type ProcessedImage = { data: Buffer; width: number; height: number; contentType: "image/webp" };

export class InvalidImageError extends Error {}

export async function reencodeImage(bytes: Buffer): Promise<ProcessedImage> {
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false })
      .rotate()
      .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, contentType: "image/webp" };
  } catch (err) {
    throw new InvalidImageError(err instanceof Error ? err.message : String(err));
  }
}

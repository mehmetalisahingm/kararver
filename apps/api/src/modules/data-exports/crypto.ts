// Veri paketi çözme — #181. Biçim worker'daki şifrelemeyle birebir aynıdır (apps/worker/src/jobs/data-exports/crypto.ts):
// "KVX1" | iv (12) | tag (16) | AES-256-GCM şifreli metin; AAD = dışa aktarma kimliği. Etiket doğrulanmazsa (bozuk nesne,
// yanlış anahtar, başka talebin nesnesi) Error fırlatır; kısmi/sahte veri asla dönmez.
import { createDecipheriv } from "node:crypto";
import { gunzipSync } from "node:zlib";

const MAGIC = Buffer.from("KVX1");
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Çözülmüş (gzip açılmış) paket için üst sınır; worker 25 MB'ta durur, burada bozuk/zararlı nesneye karşı sigorta. */
const MAX_PLAIN_BYTES = 30 * 1024 * 1024;

export function decryptPackage(blob: Buffer, key: Buffer, exportId: string): unknown {
  if (blob.length < MAGIC.length + IV_BYTES + TAG_BYTES || !blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("veri paketi biçimi tanınmıyor");
  }
  const iv = blob.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = blob.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES);
  const body = blob.subarray(MAGIC.length + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(exportId));
  decipher.setAuthTag(tag);
  const gz = Buffer.concat([decipher.update(body), decipher.final()]);
  return JSON.parse(gunzipSync(gz, { maxOutputLength: MAX_PLAIN_BYTES }).toString("utf8"));
}

// Veri paketi şifreleme — #181. AES-256-GCM; biçim: "KVX1" | iv (12) | tag (16) | şifreli metin.
// AAD = dışa aktarma kimliği: bir talebin şifreli nesnesi başka talebin satırıyla (anahtarıyla) açılamaz.
// API tarafı aynı biçimi çözer (apps/api/src/modules/data-exports/crypto.ts); iki taraf birlikte test edilir.
import { createCipheriv, randomBytes } from "node:crypto";

export const PACKAGE_MAGIC = Buffer.from("KVX1");
export const KEY_BYTES = 32;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;

export const newPackageKey = (): Buffer => randomBytes(KEY_BYTES);

export function encryptPackage(plain: Buffer, key: Buffer, exportId: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(exportId));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([PACKAGE_MAGIC, iv, cipher.getAuthTag(), body]);
}

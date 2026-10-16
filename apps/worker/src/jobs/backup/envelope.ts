// KV-48 / #51 yedek şifrelemesi (zarf): her yedek için rastgele 256 bit veri anahtarı, AES-256-GCM ile akış halinde
// şifreleme; veri anahtarı RSA-OAEP (SHA-256) açık anahtarıyla sarılır. Sunucu yalnız AÇIK anahtarı bilir: ele geçirilen bir
// sunucu ya da bucket anahtarı yedekleri okuyamaz. Özel anahtar ekip dışında, çevrimdışı saklanır (KV-48 "Zamanlanmış yedek").
//
// Dosya biçimi: "KVBK1\n" | 4 bayt başlık uzunluğu (BE) | başlık JSON { v, alg, wrap, wrappedKey, iv } | şifreli veri | 16 bayt GCM etiketi.
// Etiket sonda olduğu için çözme önce etiketi okur, sonra akışı doğrular; değiştirilmiş dosya çözülmez.
import { constants, createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, privateDecrypt, publicEncrypt, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, mkdtemp, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("KVBK1\n", "ascii");
const TAG_BYTES = 16;

type Header = { v: 1; alg: "aes-256-gcm"; wrap: "rsa-oaep-sha256"; wrappedKey: string; iv: string };

export async function encryptFile(source: string, target: string, publicKeyPem: string): Promise<void> {
  if (!/^-----BEGIN (?:RSA )?PUBLIC KEY-----/.test(publicKeyPem.trimStart())) throw new Error("sunucuya yalnız açık anahtar verilmeli");
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== "rsa" || (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) {
    throw new Error("yedek açık anahtarı RSA ve en az 3072 bit olmalı");
  }
  const dataKey = randomBytes(32);
  const iv = randomBytes(12);
  const wrappedKey = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, dataKey);
  const header: Header = { v: 1, alg: "aes-256-gcm", wrap: "rsa-oaep-sha256", wrappedKey: wrappedKey.toString("base64"), iv: iv.toString("base64") };
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(headerBytes.length);

  const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
  dataKey.fill(0);
  const out = createWriteStream(target, { flags: "wx", mode: 0o600 });
  out.write(Buffer.concat([MAGIC, length, headerBytes]));
  await pipeline(createReadStream(source), cipher, out, { end: false });
  await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (err?: Error | null) => (err ? reject(err) : resolve())));
}

export async function decryptFile(source: string, target: string, privateKeyPem: string): Promise<void> {
  const size = (await stat(source)).size;
  const fh = await open(source, "r");
  let headerEnd: number;
  let header: Header;
  let tag: Buffer;
  try {
    const prefix = Buffer.alloc(MAGIC.length + 4);
    await fh.read(prefix, 0, prefix.length, 0);
    if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("şifreli yedek değil (biçim işareti yok)");
    const headerLength = prefix.readUInt32BE(MAGIC.length);
    if (headerLength > 4096) throw new Error("geçersiz yedek başlığı");
    if (size < prefix.length + headerLength + TAG_BYTES) throw new Error("yedek dosyası kesik");
    const headerBytes = Buffer.alloc(headerLength);
    await fh.read(headerBytes, 0, headerLength, prefix.length);
    try {
      header = JSON.parse(headerBytes.toString("utf8")) as Header;
    } catch {
      throw new Error("geçersiz yedek başlığı");
    }
    if (header.v !== 1 || header.alg !== "aes-256-gcm" || header.wrap !== "rsa-oaep-sha256") throw new Error("desteklenmeyen yedek biçimi");
    headerEnd = prefix.length + headerLength;
    if (size < headerEnd + TAG_BYTES) throw new Error("yedek dosyası kesik");
    tag = Buffer.alloc(TAG_BYTES);
    await fh.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await fh.close();
  }
  const dataKey = privateDecrypt(
    { key: createPrivateKey(privateKeyPem), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(header.wrappedKey, "base64"),
  );
  const decipher = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(header.iv, "base64"));
  dataKey.fill(0);
  decipher.setAuthTag(tag);
  // Doğrulanmamış düz metin hedef adıyla görünmez. Aynı dosya sistemindeki geçici dosya
  // yalnız etiket doğrulandıktan sonra atomik ve üzerine yazmadan yayımlanır.
  const work = await mkdtemp(path.join(path.dirname(path.resolve(target)), ".kv-decrypt-"));
  const temporary = path.join(work, "verified.dump");
  try {
    await pipeline(createReadStream(source, { start: headerEnd, end: size - TAG_BYTES - 1 }), decipher, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
    await link(temporary, target);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}


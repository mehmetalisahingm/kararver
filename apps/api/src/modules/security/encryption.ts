import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createTotpSecret, totpEnrollmentUri } from "./totp.ts";

/**
 * MFA anahtarları (#180, #291). TOTP sırrı AES-256-GCM ile şifrelenir; ilk bayt anahtar sürümüdür:
 * - v1: anahtar oturum pepper'ından türetilir (eski biçim). Pepper değişirse v1 kayıtları çözülemez.
 * - v2: anahtar ayrı `MFA_ENCRYPTION_KEY`'den türetilir. Oturum pepper'ı MFA'yı kilitlemeden değiştirilebilir.
 * `legacy`, v1 kayıtlarını ve eski kurtarma kodu özetlerini doğrulayan sırların LİSTESİDİR: ilk eleman güncel
 * AUTH_TOKEN_PEPPER, sonrakiler MFA_LEGACY_PEPPERS'teki bütün eski pepper'lar. Liste yalnız büyür (A→B→C sonrası A ve B
 * ikisi de durur); böylece hiçbir rotasyon eski kurtarma kodunu sessizce geçersiz kılmaz. `current` yoksa yeni kayıtlar
 * v1 ve `legacy[0]` ile yazılır (geriye uyum).
 */
export type MfaKeys = { current: string | null; legacy: readonly string[] };

/** Yalnız pepper verilen eski çağrılar için (testler, geçiş öncesi yapılandırma). */
export const legacyOnly = (pepper: string): MfaKeys => ({ current: null, legacy: [pepper] });

const LABEL = { 1: "KararVer:encrypted-totp-key:v1\0", 2: "KararVer:encrypted-totp-key:v2\0" } as const;

function derive(version: 1 | 2, secret: string): Buffer {
  if (secret.length < 32) throw new Error("Invalid MFA encryption configuration");
  return createHash("sha256").update(LABEL[version]).update(secret).digest();
}

/** Şifreli kaydın anahtar sürümü (1 ya da 2); tanınmayan biçimde null. */
export function cipherVersion(ciphertext: Uint8Array): 1 | 2 | null {
  const b = Buffer.from(ciphertext);
  return b.length >= 30 && (b[0] === 1 || b[0] === 2) ? (b[0] as 1 | 2) : null;
}

/** v1 kayıt ve ayrı anahtar tanımlıysa: yeni anahtara taşınmalı. */
export const needsRekey = (ciphertext: Uint8Array, keys: MfaKeys): boolean => keys.current !== null && cipherVersion(ciphertext) === 1;

export function protectTotpSecret(secret: string, userId: string, keys: MfaKeys): Buffer {
  const version = keys.current ? 2 : 1;
  const nonce = randomBytes(12);
  const secretKey = keys.current ?? keys.legacy[0];
  if (!secretKey) throw new Error("Invalid MFA encryption configuration");
  const cipher = createCipheriv("aes-256-gcm", derive(version, secretKey), nonce);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([version]), nonce, cipher.getAuthTag(), encrypted]);
}

export function recoverTotpSecret(ciphertext: Uint8Array, userId: string, keys: MfaKeys): string {
  const b = Buffer.from(ciphertext);
  const version = cipherVersion(b);
  if (version === null) throw new Error("Invalid encrypted MFA key");
  if (version === 2 && !keys.current) throw new Error("MFA_ENCRYPTION_KEY gerekli: kayıt ayrı anahtarla şifrelenmiş");
  const open = (secretKey: string) => {
    const decipher = createDecipheriv("aes-256-gcm", derive(version, secretKey), b.subarray(1, 13));
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(b.subarray(13, 29));
    return Buffer.concat([decipher.update(b.subarray(29)), decipher.final()]).toString("utf8");
  };
  if (version === 2) return open(keys.current!);
  // v1: hangi eski pepper ile yazıldığı bilinmez; GCM etiketi yanlış anahtarı reddeder, sıradakine geçilir.
  for (const secretKey of keys.legacy) {
    try {
      return open(secretKey);
    } catch {}
  }
  throw new Error("MFA kaydı eski sırlarla çözülemedi (MFA_LEGACY_PEPPERS eksik olabilir)");
}

/** v1 kaydı çözüp ayrı anahtarla (v2) yeniden şifreler; dönüş doğrulanmadan yeni kayıt verilmez. */
export function rekeyTotpSecret(ciphertext: Uint8Array, userId: string, keys: MfaKeys): Buffer {
  if (!keys.current) throw new Error("MFA_ENCRYPTION_KEY tanımlı değil");
  const secret = recoverTotpSecret(ciphertext, userId, keys);
  const next = protectTotpSecret(secret, userId, keys);
  if (recoverTotpSecret(next, userId, keys) !== secret) throw new Error("MFA yeniden şifreleme doğrulanamadı");
  return next;
}

export function createMfaEnrollment(accountLabel: string, userId: string, keys: MfaKeys) {
  const secret = createTotpSecret();
  return { secret, uri: totpEnrollmentUri(secret, accountLabel), ciphertext: protectTotpSecret(secret, userId, keys) };
}

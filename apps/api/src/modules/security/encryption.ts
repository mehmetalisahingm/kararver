import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createTotpSecret, totpEnrollmentUri } from "./totp.ts";

function keyFromPepper(pepper: string): Buffer {
  if (pepper.length < 32) throw new Error("Invalid MFA encryption configuration");
  // Domain separated; same server secret is already required for session tokens.
  return createHash("sha256").update("KararVer:encrypted-totp-key:v1\0").update(pepper).digest();
}
export function protectTotpSecret(secret: string, userId: string, pepper: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromPepper(pepper), nonce);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted]);
}
export function recoverTotpSecret(ciphertext: Uint8Array, userId: string, pepper: string): string {
  const b = Buffer.from(ciphertext);
  if (b.length < 30 || b[0] !== 1) throw new Error("Invalid encrypted MFA key");
  const decipher = createDecipheriv("aes-256-gcm", keyFromPepper(pepper), b.subarray(1, 13));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(b.subarray(13, 29));
  return Buffer.concat([decipher.update(b.subarray(29)), decipher.final()]).toString("utf8");
}
export function createMfaEnrollment(accountLabel: string, userId: string, pepper: string) {
  const secret = createTotpSecret();
  return { secret, uri: totpEnrollmentUri(secret, accountLabel), ciphertext: protectTotpSecret(secret, userId, pepper) };
}

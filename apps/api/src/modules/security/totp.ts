// SA #180: RFC 4226/6238 primitive for an opt-in TOTP MFA rollout.
// NOT an authorization gate by itself: the store must encrypt secrets at rest,
// atomically persist lastAcceptedStep and bind a fresh step-up to the session.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function encodeBase32(value: Uint8Array): string {
  let output = "", bits = 0, buffer = 0;
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits) output += ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(text: string): Buffer {
  const normalized = text.trim().replace(/=+$/, "").toUpperCase();
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) throw new TypeError("Invalid TOTP base32 secret");
  let bits = 0, acc = 0, out: number[] = [];
  for (const char of normalized) {
    acc = (acc << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >>> bits) & 255);
      acc &= (1 << bits) - 1;
    }
  }
  if (bits && acc !== 0) throw new TypeError("Noncanonical TOTP base32 padding bits");
  if (out.length < 16) throw new TypeError("TOTP secret too short");
  return Buffer.from(out);
}

export function createTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function hotp(secret: Uint8Array, counter: number, digits: 6 | 8 = 6): string {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new RangeError("Invalid HOTP counter");
  if (secret.byteLength < 16) throw new RangeError("TOTP key must be >= 128 bits");
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits);
  return String(value).padStart(digits, "0");
}

export type VerifyTotpInput = {
  base32Secret: string;
  code: string;
  nowMs: number;
  /** Persisted counter read under account/MFA row lock in a transaction. */
  lastAcceptedStep: number;
  /** Maximum one period of clock skew either way. */
  window?: 0 | 1;
};

/** Returns accepted counter, or null. Caller MUST persist it atomically before granting step-up. */
export function matchTotpStep(input: VerifyTotpInput): number | null {
  if (!/^\d{6}$/.test(input.code) || !Number.isFinite(input.nowMs) || input.nowMs < 0) return null;
  if (!Number.isSafeInteger(input.lastAcceptedStep) || input.lastAcceptedStep < -1) return null;
  const key = decodeBase32(input.base32Secret);
  const counter = Math.floor(input.nowMs / (TOTP_PERIOD_SECONDS * 1000));
  const width = input.window ?? 1;
  for (let step = counter - width; step <= counter + width; step++) {
    if (step < 0 || step <= input.lastAcceptedStep) continue;
    const expected = Buffer.from(hotp(key, step), "ascii");
    if (timingSafeEqual(expected, Buffer.from(input.code, "ascii"))) return step;
  }
  return null;
}

/** Secret must never be put into logs or audit entries; show the URI only once at enrollment. */
export function totpEnrollmentUri(secret: string, accountLabel: string, issuer = "KararVer"): string {
  decodeBase32(secret);
  if (!accountLabel.trim()) throw new TypeError("Account label required");
  return "otpauth://totp/" + encodeURIComponent(issuer + ":" + accountLabel) +
    "?secret=" + encodeURIComponent(secret) + "&issuer=" + encodeURIComponent(issuer) +
    "&algorithm=SHA1&digits=6&period=30";
}

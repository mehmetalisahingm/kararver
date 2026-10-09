// Oturum ve e-posta token'ları, parola hash'i (TECH_DECISIONS.md §3.4).
// Token 32 byte rastgele üretilir; DB'de sadece sha256(token + AUTH_TOKEN_PEPPER) saklanır.
import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes } from "node:crypto";

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string, pepper: string): string {
  return createHash("sha256").update(token + pepper).digest("hex");
}

export type PasswordHasher = {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
};

/** argon2id, OWASP önerisi: 19 MiB bellek, 2 tur, 1 paralellik (@node-rs/argon2 varsayılanı). */
export function createArgon2Hasher(): PasswordHasher {
  return {
    hash: (password) => hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
    async verify(passwordHash, password) {
      try {
        return await verify(passwordHash, password);
      } catch {
        return false;
      }
    },
  };
}

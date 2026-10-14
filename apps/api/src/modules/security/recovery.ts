import { createHmac, randomBytes } from "node:crypto";

export function createRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => randomBytes(16).toString("hex"));
}

export function hashRecoveryCode(code: string, userId: string, pepper: string): string {
  return createHmac("sha256", pepper).update("KararVer:mfa-recovery:v1\0")
    .update(userId).update("\0").update(code.toLowerCase()).digest("hex");
}

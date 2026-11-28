import { createHmac, randomBytes } from "node:crypto";
import type { MfaKeys } from "./encryption.ts";

export function createRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => randomBytes(16).toString("hex"));
}

/** v1 özeti (eski): o anki oturum pepper'ı. Değişmez; eski kodlar MfaKeys.legacy listesindeki her sırla denenir. */
export function hashRecoveryCode(code: string, userId: string, pepper: string): string {
  return createHmac("sha256", pepper).update("KararVer:mfa-recovery:v1\0")
    .update(userId).update("\0").update(code.toLowerCase()).digest("hex");
}

function hashRecoveryCodeV2(code: string, userId: string, key: string): string {
  return createHmac("sha256", key).update("KararVer:mfa-recovery:v2\0")
    .update(userId).update("\0").update(code.toLowerCase()).digest("hex");
}

/** Yeni kodun saklanacak özeti: ayrı anahtar varsa v2, yoksa v1. */
export function recoveryCodeHashForStorage(code: string, userId: string, keys: MfaKeys): string {
  return keys.current ? hashRecoveryCodeV2(code, userId, keys.current) : hashRecoveryCode(code, userId, keys.legacy[0]!);
}

/**
 * Doğrulamada kabul edilen özetler: v2 (ayrı anahtar) ve v1 (eski sır). Kurtarma kodu düz saklanmadığı için eski özetler
 * yeni anahtara taşınamaz; her eski pepper MFA_LEGACY_PEPPERS listesinde kaldığı sürece eski kodlar çalışmaya devam eder.
 */
export function recoveryCodeHashCandidates(code: string, userId: string, keys: MfaKeys): string[] {
  const legacy = keys.legacy.map((pepper) => hashRecoveryCode(code, userId, pepper));
  return keys.current ? [hashRecoveryCodeV2(code, userId, keys.current), ...legacy] : legacy;
}

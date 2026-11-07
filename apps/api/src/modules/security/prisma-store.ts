// SA #180: PostgreSQL MFA enrollment and session-bound TOTP step-up.
// All verification is serialized on the account's credential row; repeated OTPs cannot win a race.
import type { Prisma, PrismaClient } from "@kararver/db";
import { writeAudit } from "../audit/write.ts";
import { createRecoveryCodes, recoveryCodeHashCandidates, recoveryCodeHashForStorage } from "./recovery.ts";
import { createMfaEnrollment, legacyOnly, needsRekey, recoverTotpSecret, rekeyTotpSecret, type MfaKeys } from "./encryption.ts";
import { matchTotpStep } from "./totp.ts";
import { consumeFreshStepup } from "./stepup-guard.ts";
import type { MfaStore } from "./store.ts";

const ENROLLMENT_MS = 10 * 60_000;
const STEPUP_MS = 5 * 60_000;
const LOCK_MS = 15 * 60_000;
const MAX_FAILURES = 5;
type CredentialRow = {
  secret_cipher: Uint8Array; enabled_at: Date | null; pending_expires_at: Date;
  setup_session_id: string; last_accepted_step: number; failed_attempts: number; locked_until: Date | null;
  reenroll_secret_cipher: Uint8Array | null; reenroll_session_id: string | null; reenroll_expires_at: Date | null;
};
type Tx = Prisma.TransactionClient;

/** `mfaKeys` yalnız pepper ise (eski çağrı) v1 biçimi kullanılır; ayrı anahtar için bkz. encryption.ts `MfaKeys`. */
export function createPrismaMfaStore(prisma: PrismaClient, mfaKeys: MfaKeys | string): MfaStore {
  const keys = typeof mfaKeys === "string" ? legacyOnly(mfaKeys) : mfaKeys;
  /** Başarılı doğrulamadan sonra v1 kaydı aynı transaction'da ayrı anahtara taşır (pepper değişimine hazırlık). */
  const rekeyIfNeeded = async (tx: Tx, userId: string, cipher: Uint8Array) => {
    if (!needsRekey(cipher, keys)) return;
    const next = rekeyTotpSecret(cipher, userId, keys);
    await tx.$executeRaw`UPDATE user_mfa_credentials SET secret_cipher = ${next} WHERE user_id = ${userId}::uuid`;
  };
  const freshSession = async (tx: Tx, userId: string, sessionId: string, now: Date): Promise<boolean> => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM sessions
      WHERE id = ${sessionId}::uuid AND user_id = ${userId}::uuid
        AND revoked_at IS NULL AND expires_at > ${now}::timestamptz FOR UPDATE`;
    return rows.length === 1;
  };
  const audit = (tx: Tx, userId: string, operation: string, now: Date, requestId?: string,
    after: Record<string, number> | null = null) =>
    writeAudit(tx, { source: "API", actorId: userId, action: "account.mfa", operation,
      target: { type: "USER", id: userId }, before: null, after, at: now, requestId });
  const recordFailure = async (tx: Tx, userId: string, failed: number, now: Date, requestId?: string) => {
    const count = failed + 1;
    const locked = count >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MS) : null;
    await tx.$executeRaw`UPDATE user_mfa_credentials SET failed_attempts = ${locked ? 0 : count},
      locked_until = ${locked}::timestamptz WHERE user_id = ${userId}::uuid`;
    await audit(tx, userId, locked ? "lock" : "deny", now, requestId);
  };
  const grantStepup = async (tx: Tx, sessionId: string, now: Date) => {
    const expiresAt = new Date(now.getTime() + STEPUP_MS);
    await tx.$executeRaw`
      INSERT INTO session_mfa_stepups (session_id, verified_at, expires_at)
      VALUES (${sessionId}::uuid, ${now}::timestamptz, ${expiresAt}::timestamptz)
      ON CONFLICT (session_id) DO UPDATE SET verified_at = EXCLUDED.verified_at,
        expires_at = EXCLUDED.expires_at, consumed_at = NULL`;
    return expiresAt;
  };
  return {
    async status(userId, sessionId, now) {
      const rows = await prisma.$queryRaw<{ enabled_at: Date | null; expires_at: Date | null }[]>`
        SELECT c.enabled_at, CASE WHEN s.revoked_at IS NULL AND s.expires_at > ${now}::timestamptz
          AND st.expires_at > ${now}::timestamptz AND st.consumed_at IS NULL THEN st.expires_at ELSE NULL END AS expires_at
        FROM user_mfa_credentials c LEFT JOIN session_mfa_stepups st
          ON st.session_id = ${sessionId}::uuid
        LEFT JOIN sessions s ON s.id = ${sessionId}::uuid AND s.user_id = c.user_id
        WHERE c.user_id = ${userId}::uuid`;
      return { enabled: rows[0]?.enabled_at !== null && rows.length > 0, stepUpExpiresAt: rows[0]?.expires_at ?? null };
    },
    async begin({ userId, sessionId, email, now, requestId }) {
      return prisma.$transaction(async tx => {
        if (!(await freshSession(tx, userId, sessionId, now))) return { kind: "session" as const };
        const enrollment = createMfaEnrollment(email, userId, keys);
        const expiresAt = new Date(now.getTime() + ENROLLMENT_MS);
        const updated = await tx.$queryRaw<{ user_id: string }[]>`
          INSERT INTO user_mfa_credentials
            (user_id, secret_cipher, setup_session_id, pending_expires_at, last_accepted_step)
          VALUES (${userId}::uuid, ${enrollment.ciphertext}, ${sessionId}::uuid, ${expiresAt}::timestamptz, -1)
          ON CONFLICT (user_id) DO UPDATE SET secret_cipher = EXCLUDED.secret_cipher,
            setup_session_id = EXCLUDED.setup_session_id,
            pending_expires_at = EXCLUDED.pending_expires_at,
            last_accepted_step = -1, failed_attempts = 0, locked_until = NULL
          WHERE user_mfa_credentials.enabled_at IS NULL RETURNING user_id`;
        if (updated.length === 0) return { kind: "conflict" as const };
        await audit(tx, userId, "setup", now, requestId);
        return { kind: "created" as const, secret: enrollment.secret, uri: enrollment.uri, expiresAt };
      });
    },
    async confirm({ userId, sessionId, code, now, requestId }) {
      return prisma.$transaction(async tx => {
        if (!(await freshSession(tx, userId, sessionId, now))) return { kind: "session" as const };
        const rows = await tx.$queryRaw<CredentialRow[]>`
          SELECT * FROM user_mfa_credentials WHERE user_id = ${userId}::uuid FOR UPDATE`;
        const c = rows[0];
        if (!c || c.enabled_at || c.setup_session_id !== sessionId || c.pending_expires_at <= now) return { kind: "invalid" as const };
        if (c.locked_until && c.locked_until > now) return { kind: "locked" as const };
        const step = matchTotpStep({ base32Secret: recoverTotpSecret(c.secret_cipher, userId, keys),
          code, nowMs: now.getTime(), lastAcceptedStep: Number(c.last_accepted_step) });
        if (step === null) { await recordFailure(tx, userId, c.failed_attempts, now, requestId); return { kind: "invalid" as const }; }
        await tx.$executeRaw`UPDATE user_mfa_credentials
          SET enabled_at = ${now}::timestamptz, last_accepted_step = ${step},
            failed_attempts = 0, locked_until = NULL
          WHERE user_id = ${userId}::uuid AND enabled_at IS NULL`;
        await rekeyIfNeeded(tx, userId, c.secret_cipher);
        const recoveryCodes = createRecoveryCodes();
        await tx.mfaRecoveryCode.createMany({ data: recoveryCodes.map(code => ({
          userId, codeHash: recoveryCodeHashForStorage(code, userId, keys), createdAt: now,
        })) });
        await audit(tx, userId, "enable", now, requestId);
        return { kind: "enabled" as const, recoveryCodes };
      });
    },
    async stepUp({ userId, sessionId, code, now, requestId }) {
      return prisma.$transaction(async tx => {
        if (!(await freshSession(tx, userId, sessionId, now))) return { kind: "session" as const };
        const rows = await tx.$queryRaw<CredentialRow[]>`
          SELECT * FROM user_mfa_credentials WHERE user_id = ${userId}::uuid FOR UPDATE`;
        const c = rows[0];
        if (!c?.enabled_at) return { kind: "invalid" as const };
        if (c.locked_until && c.locked_until > now) return { kind: "locked" as const };
        const step = matchTotpStep({ base32Secret: recoverTotpSecret(c.secret_cipher, userId, keys),
          code, nowMs: now.getTime(), lastAcceptedStep: Number(c.last_accepted_step) });
        if (step === null) { await recordFailure(tx, userId, c.failed_attempts, now, requestId); return { kind: "invalid" as const }; }
        await tx.$executeRaw`UPDATE user_mfa_credentials SET last_accepted_step = ${step},
          failed_attempts = 0, locked_until = NULL WHERE user_id = ${userId}::uuid`;
        await rekeyIfNeeded(tx, userId, c.secret_cipher);
        const expiresAt = await grantStepup(tx, sessionId, now);
        await audit(tx, userId, "verify", now, requestId);
        return { kind: "verified" as const, expiresAt };
      });
    },
    async recover({ userId, sessionId, code, now, requestId }) {
      return prisma.$transaction(async tx => {
        if (!(await freshSession(tx, userId, sessionId, now))) return { kind: "session" as const };
        const [c] = await tx.$queryRaw<CredentialRow[]>`
          SELECT * FROM user_mfa_credentials WHERE user_id = ${userId}::uuid FOR UPDATE`;
        if (!c?.enabled_at) return { kind: "invalid" as const };
        if (c.locked_until && c.locked_until > now) return { kind: "locked" as const };
        const used = await tx.mfaRecoveryCode.updateMany({
          where: { userId, codeHash: { in: recoveryCodeHashCandidates(code, userId, keys) }, usedAt: null, revokedAt: null },
          data: { usedAt: now },
        });
        if (used.count !== 1) {
          await recordFailure(tx, userId, c.failed_attempts, now, requestId);
          return { kind: "invalid" as const };
        }
        await tx.$executeRaw`UPDATE user_mfa_credentials SET failed_attempts = 0, locked_until = NULL
          WHERE user_id = ${userId}::uuid`;
        const expiresAt = await grantStepup(tx, sessionId, now);
        await audit(tx, userId, "recover", now, requestId);
        return { kind: "verified" as const, expiresAt };
      });
    },
    /**
     * Doğrulayıcı yenileme başlatma (#180/#291). Taze step-up bu transaction'da tüketilir; yeni sır yalnız bekleyen alana
     * yazılır, etkin `secret_cipher` ve kurtarma kodları değişmez. Yeni sır her zaman ayrı anahtarla (v2) şifrelenir:
     * anahtar yoksa başlatılmaz, çünkü amaç sırrı eski pepper'dan koparmaktır.
     */
    async reenrollBegin({ userId, sessionId, email, now, requestId }) {
      return prisma.$transaction(async tx => {
        if (!(await freshSession(tx, userId, sessionId, now))) return { kind: "session" as const };
        const [c] = await tx.$queryRaw<CredentialRow[]>`
          SELECT * FROM user_mfa_credentials WHERE user_id = ${userId}::uuid FOR UPDATE`;
        if (!c?.enabled_at) return { kind: "not_enabled" as const };
        if (!keys.current) return { kind: "key_required" as const };
        if (!(await consumeFreshStepup(tx, userId, sessionId, now))) return { kind: "stepup_required" as const };
        const enrollment = createMfaEnrollment(email, userId, keys);
        const expiresAt = new Date(now.getTime() + ENROLLMENT_MS);
        await tx.$executeRaw`UPDATE user_mfa_credentials SET reenroll_secret_cipher = ${enrollment.ciphertext},
          reenroll_session_id = ${sessionId}::uuid, reenroll_expires_at = ${expiresAt}::timestamptz
          WHERE user_id = ${userId}::uuid AND enabled_at IS NOT NULL`;
        await audit(tx, userId, "reenroll_begin", now, requestId);
        return { kind: "created" as const, secret: enrollment.secret, uri: enrollment.uri, expiresAt };
      });
    },
    /**
     * Onay: kod bekleyen YENİ sırla doğrulanır. Başarısızlıkta yalnız ortak deneme sayacı artar; etkin sır ve kodlar aynı
     * kalır. Başarıda tek transaction: sır değişir (v2), eski kurtarma kodları iptal, yeni kodlar, audit, diğer oturumların
     * step-up'ları düşer. Satır kilidi eşzamanlı ikinci onayı bekletir; o, temizlenmiş bekleyen alanı görüp reddedilir.
     */
    async reenrollConfirm({ userId, sessionId, code, now, requestId }) {
      return prisma.$transaction(async tx => {
        if (!(await freshSession(tx, userId, sessionId, now))) return { kind: "session" as const };
        const [c] = await tx.$queryRaw<CredentialRow[]>`
          SELECT * FROM user_mfa_credentials WHERE user_id = ${userId}::uuid FOR UPDATE`;
        if (!c?.enabled_at || !c.reenroll_secret_cipher || c.reenroll_session_id !== sessionId
          || !c.reenroll_expires_at || c.reenroll_expires_at <= now || !keys.current) return { kind: "invalid" as const };
        if (c.locked_until && c.locked_until > now) return { kind: "locked" as const };
        const step = matchTotpStep({ base32Secret: recoverTotpSecret(c.reenroll_secret_cipher, userId, keys),
          code, nowMs: now.getTime(), lastAcceptedStep: -1 });
        if (step === null) { await recordFailure(tx, userId, c.failed_attempts, now, requestId); return { kind: "invalid" as const }; }
        // Bekleyen sır başlatmada v2 yazıldı; yine de yazmadan önce sürüm ve dönüş doğrulanır.
        const next = needsRekey(c.reenroll_secret_cipher, keys)
          ? rekeyTotpSecret(c.reenroll_secret_cipher, userId, keys) : Buffer.from(c.reenroll_secret_cipher);
        const swapped = await tx.$executeRaw`UPDATE user_mfa_credentials SET secret_cipher = ${next},
            last_accepted_step = ${step}, failed_attempts = 0, locked_until = NULL,
            reenroll_secret_cipher = NULL, reenroll_session_id = NULL, reenroll_expires_at = NULL
          WHERE user_id = ${userId}::uuid AND enabled_at IS NOT NULL AND reenroll_session_id = ${sessionId}::uuid`;
        if (swapped !== 1) return { kind: "invalid" as const };
        const revoked = await tx.mfaRecoveryCode.updateMany({
          where: { userId, usedAt: null, revokedAt: null }, data: { revokedAt: now },
        });
        const recoveryCodes = createRecoveryCodes();
        await tx.mfaRecoveryCode.createMany({ data: recoveryCodes.map(code => ({
          userId, codeHash: recoveryCodeHashForStorage(code, userId, keys), createdAt: now,
        })) });
        const stepups = await tx.$executeRaw`UPDATE session_mfa_stepups SET consumed_at = ${now}::timestamptz
          WHERE consumed_at IS NULL AND session_id <> ${sessionId}::uuid
            AND session_id IN (SELECT id FROM sessions WHERE user_id = ${userId}::uuid)`;
        await audit(tx, userId, "reenroll", now, requestId, {
          cipherVersion: 2, recoveryCodesIssued: recoveryCodes.length, recoveryCodesRevoked: revoked.count, stepupsRevoked: stepups,
        });
        return { kind: "reenrolled" as const, recoveryCodes };
      });
    },
  };
}

// SA #180: PostgreSQL MFA enrollment and session-bound TOTP step-up.
// All verification is serialized on the account's credential row; repeated OTPs cannot win a race.
import type { Prisma, PrismaClient } from "@kararver/db";
import { writeAudit } from "../audit/write.ts";
import { createRecoveryCodes, hashRecoveryCode } from "./recovery.ts";
import { createMfaEnrollment, recoverTotpSecret } from "./encryption.ts";
import { matchTotpStep } from "./totp.ts";
import type { MfaStore } from "./store.ts";

const ENROLLMENT_MS = 10 * 60_000;
const STEPUP_MS = 5 * 60_000;
const LOCK_MS = 15 * 60_000;
const MAX_FAILURES = 5;
type CredentialRow = {
  secret_cipher: Uint8Array; enabled_at: Date | null; pending_expires_at: Date;
  setup_session_id: string; last_accepted_step: number; failed_attempts: number; locked_until: Date | null;
};
type Tx = Prisma.TransactionClient;

export function createPrismaMfaStore(prisma: PrismaClient, pepper: string): MfaStore {
  const freshSession = async (tx: Tx, userId: string, sessionId: string, now: Date): Promise<boolean> => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM sessions
      WHERE id = ${sessionId}::uuid AND user_id = ${userId}::uuid
        AND revoked_at IS NULL AND expires_at > ${now}::timestamptz FOR UPDATE`;
    return rows.length === 1;
  };
  const audit = (tx: Tx, userId: string, operation: string, now: Date, requestId?: string) =>
    writeAudit(tx, { source: "API", actorId: userId, action: "account.mfa", operation,
      target: { type: "USER", id: userId }, before: null, after: null, at: now, requestId });
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
        const enrollment = createMfaEnrollment(email, userId, pepper);
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
        const step = matchTotpStep({ base32Secret: recoverTotpSecret(c.secret_cipher, userId, pepper),
          code, nowMs: now.getTime(), lastAcceptedStep: Number(c.last_accepted_step) });
        if (step === null) { await recordFailure(tx, userId, c.failed_attempts, now, requestId); return { kind: "invalid" as const }; }
        await tx.$executeRaw`UPDATE user_mfa_credentials
          SET enabled_at = ${now}::timestamptz, last_accepted_step = ${step},
            failed_attempts = 0, locked_until = NULL
          WHERE user_id = ${userId}::uuid AND enabled_at IS NULL`;
        const recoveryCodes = createRecoveryCodes();
        await tx.mfaRecoveryCode.createMany({ data: recoveryCodes.map(code => ({
          userId, codeHash: hashRecoveryCode(code, userId, pepper), createdAt: now,
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
        const step = matchTotpStep({ base32Secret: recoverTotpSecret(c.secret_cipher, userId, pepper),
          code, nowMs: now.getTime(), lastAcceptedStep: Number(c.last_accepted_step) });
        if (step === null) { await recordFailure(tx, userId, c.failed_attempts, now, requestId); return { kind: "invalid" as const }; }
        await tx.$executeRaw`UPDATE user_mfa_credentials SET last_accepted_step = ${step},
          failed_attempts = 0, locked_until = NULL WHERE user_id = ${userId}::uuid`;
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
          where: { userId, codeHash: hashRecoveryCode(code, userId, pepper), usedAt: null }, data: { usedAt: now },
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
  };
}

import type { Prisma } from "@kararver/db";
/** Atomically consume a fresh, unspent, session-bound TOTP step-up.
 * Must run in the *same transaction* as the protected mutation.
 */
export async function consumeFreshStepup(tx: Prisma.TransactionClient, actorId: string, sessionId: string, at: Date): Promise<boolean> {
  const rows = await tx.$queryRaw<{ session_id: string }[]>`
    UPDATE session_mfa_stepups AS st SET consumed_at = ${at}::timestamptz
    WHERE st.session_id = ${sessionId}::uuid AND st.consumed_at IS NULL
      AND st.expires_at > ${at}::timestamptz
      AND st.verified_at <= ${at}::timestamptz
      AND st.verified_at > ${new Date(at.getTime() - 300000)}::timestamptz
      AND EXISTS (
        SELECT 1 FROM sessions AS ss
          JOIN user_mfa_credentials AS cred ON cred.user_id = ss.user_id
          WHERE ss.id = st.session_id AND ss.user_id = ${actorId}::uuid
            AND ss.revoked_at IS NULL AND ss.expires_at > ${at}::timestamptz
            AND cred.enabled_at IS NOT NULL
      )
    RETURNING st.session_id`;
  return rows.length === 1;
}

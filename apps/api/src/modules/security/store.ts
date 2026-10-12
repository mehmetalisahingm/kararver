/** Server-side MFA store; fresh session checks and replay protection are done in PostgreSQL. */
export interface MfaStore {
  status(userId: string, sessionId: string, now: Date): Promise<{ enabled: boolean; stepUpExpiresAt: Date | null }>;
  begin(input: { userId: string; sessionId: string; email: string; now: Date }): Promise<
    { kind: "created"; secret: string; uri: string; expiresAt: Date } | { kind: "conflict" | "session" }
  >;
  confirm(input: { userId: string; sessionId: string; code: string; now: Date }): Promise<"enabled" | "invalid" | "session" | "locked">;
  stepUp(input: { userId: string; sessionId: string; code: string; now: Date }): Promise<
    { kind: "verified"; expiresAt: Date } | { kind: "invalid" | "session" | "locked" }
  >;
}

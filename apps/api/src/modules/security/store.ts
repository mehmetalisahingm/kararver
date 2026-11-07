/** Server-side MFA store; fresh session checks and replay protection are done in PostgreSQL. */
export interface MfaStore {
  status(userId: string, sessionId: string, now: Date): Promise<{ enabled: boolean; stepUpExpiresAt: Date | null }>;
  begin(input: { userId: string; sessionId: string; email: string; now: Date; requestId?: string }): Promise<
    { kind: "created"; secret: string; uri: string; expiresAt: Date } | { kind: "conflict" } | { kind: "session" }
  >;
  confirm(input: { userId: string; sessionId: string; code: string; now: Date; requestId?: string }): Promise<
    { kind: "enabled"; recoveryCodes: string[] } | { kind: "invalid" | "session" | "locked" }
  >;
  recover(input: { userId: string; sessionId: string; code: string; now: Date; requestId?: string }): Promise<
    { kind: "verified"; expiresAt: Date } | { kind: "invalid" | "session" | "locked" }
  >;
  stepUp(input: { userId: string; sessionId: string; code: string; now: Date; requestId?: string }): Promise<
    { kind: "verified"; expiresAt: Date } | { kind: "invalid" | "session" | "locked" }
  >;
  /** Etkin MFA'da yeni sır başlatır; taze step-up'ı tüketir. Eski sır onaya kadar geçerli kalır. */
  reenrollBegin(input: { userId: string; sessionId: string; email: string; now: Date; requestId?: string }): Promise<
    { kind: "created"; secret: string; uri: string; expiresAt: Date } | { kind: "session" | "not_enabled" | "key_required" | "stepup_required" }
  >;
  /** Yeni sırla üretilmiş kodla onay: sır değişir, eski kurtarma kodları iptal, yeni kodlar döner. */
  reenrollConfirm(input: { userId: string; sessionId: string; code: string; now: Date; requestId?: string }): Promise<
    { kind: "reenrolled"; recoveryCodes: string[] } | { kind: "invalid" | "session" | "locked" }
  >;
}

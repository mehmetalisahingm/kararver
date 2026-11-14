/** Server-side MFA store; fresh session checks and replay protection are done in PostgreSQL. */
/** #373 (Utku) P2: uygulamanın MFA anahtarı kayıtlı v2 sırları çözebiliyor mu? */
export type MfaKeyCheck = "ok" | "mismatch" | "unverified" | "unknown";

export interface MfaStore {
  /**
   * Salt okuma, sır döndürmez. Birkaç v2 kaydı mevcut anahtarla çözmeyi dener: biri çözülürse "ok", hiçbiri çözülmezse
   * "mismatch" (yanlış MFA_ENCRYPTION_KEY), v2 kayıt yoksa "unverified", DB hatasında "unknown".
   */
  keyCheck?(): Promise<MfaKeyCheck>;
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
}

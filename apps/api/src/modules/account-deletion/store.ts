// Kullanıcının kendi hesabını silme talebi — #181, KV-33 §12. Üretim uygulaması: prisma-store.ts.
//
// Bu modül yalnız TALEBİ yönetir (parola/MFA/teyit sonrası açılır, e-posta bağlantısıyla onaylanır, iptal edilir). Silmenin
// kendisi account-erasure modülünün `anonymize` işlemidir (`self` kipi): kapsam, engeller, kilitler ve idempotency orada.
import type { Prisma } from "@kararver/db";
import type { Mutation } from "../admin-users/store.ts";
import type { ErasureBlocker } from "../account-erasure/store.ts";

type Tx = Prisma.TransactionClient;

export type DeletionRow = {
  id: string;
  status: "OPEN" | "COMPLETED" | "CANCELLED" | "EXPIRED" | "FAILED";
  expiresAt: Date;
  createdAt: Date;
  finishedAt: Date | null;
  failure: string | null;
};

export type RequestInput = Mutation & {
  userId: string;
  sessionId: string;
  confirmUsername: string;
  /** MFA açıksa bu oturumda taze step-up aynı transaction'da tüketilir. */
  mfaEnabled: boolean;
  tokenHash: string;
  expiresAt: Date;
  hourlyLimit: number;
  cooldownMs: number;
};
export type RequestResult =
  | { kind: "created"; row: DeletionRow; email: string }
  | { kind: "limited"; retryAfterMs: number }
  | { kind: "rejected"; reason: "not_found" | "user_deleted" | "confirmation_mismatch" | "mfa_required" };

/** Onay adımı: token geçerli ve talep açık mı. `done`: talep zaten tamamlanmış (tekrar tıklama). */
export type PrepareResult =
  | { kind: "ready"; deletionId: string; userId: string; email: string }
  | { kind: "done" }
  | { kind: "rejected"; reason: "invalid" };

export type CancelByTokenResult =
  | { kind: "cancelled"; fresh: boolean; email: string }
  | { kind: "rejected"; reason: "invalid" | "already_deleted" };

export interface AccountDeletionStore {
  latest(userId: string): Promise<DeletionRow | null>;
  request(input: RequestInput): Promise<RequestResult>;
  /** Token'ı çözer; süresi geçmiş açık talebi kapatır. Hesap kilitlenmez: kesin karar silme transaction'ındaki `guard`'dadır. */
  prepare(tokenHash: string, now: Date): Promise<PrepareResult>;
  /** Silme transaction'ı içinde (hesap satırı kilitliyken): talep hâlâ açık ve süresi geçmemiş mi. */
  isOpen(tx: Tx, deletionId: string, now: Date): Promise<boolean>;
  /** Silme transaction'ı içinde: talebi tamamlandı olarak kapatır (idempotent). */
  markCompleted(tx: Tx, deletionId: string, now: Date): Promise<void>;
  /** Silme engellendi (talep ile onay arasında engel doğdu): talep FAILED olur, hiçbir şey silinmemiştir. */
  fail(deletionId: string, reason: ErasureBlocker | "stale", now: Date): Promise<void>;
  cancelOwn(input: Mutation & { userId: string }): Promise<{ cancelled: boolean }>;
  /** E-postadaki "bu ben değilim": talep iptal, bütün oturumlar kapanır, bekleyen bağlantılar geçersiz olur. */
  cancelByToken(input: { tokenHash: string; requestId: string; now: Date }): Promise<CancelByTokenResult>;
}

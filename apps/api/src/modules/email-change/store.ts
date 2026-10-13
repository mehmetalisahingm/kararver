// E-posta değişimi — #181. Kurallar: docs/KV-33_ADMIN_USERS.md §11. Üretim uygulaması: prisma-store.ts.
//
// Her değiştiren işlem tek transaction'dadır: hesap satırı kilitlenir (admin-users ile aynı kilit), talep o kilit altında
// okunur, durum geçişi + (uygulanıyorsa) e-posta güncellemesi + oturum iptali + audit birlikte yazılır. E-postalar
// transaction dışında, sonuca göre gönderilir. Audit'te ve loglarda hiçbir e-posta adresi yoktur.
import type { EmailChangeOrigin, EmailChangeStatus } from "@kararver/db";
import type { Mutation } from "../admin-users/store.ts";

export type EmailChangeRow = {
  id: string;
  origin: EmailChangeOrigin;
  status: EmailChangeStatus;
  /** Yalnız OPEN iken dolu. */
  newEmail: string | null;
  requiresOld: boolean;
  newConfirmedAt: Date | null;
  oldConfirmedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  finishedAt: Date | null;
  failure: string | null;
};

export type StartInput = Mutation & {
  userId: string;
  origin: EmailChangeOrigin;
  /** Yönetici başlatmasında zorunlu gerekçe. */
  reason: string | null;
  newEmail: string;
  newEmailNormalized: string;
  newTokenHash: string;
  oldTokenHash: string;
  expiresAt: Date;
  /** Kullanıcı başlatmasında: saatte en çok istek ve ardışık istekler arası en kısa süre. */
  hourlyLimit: number;
  cooldownMs: number;
};
export type StartRejection = "not_found" | "forbidden" | "user_deleted" | "same_email" | "request_open";
export type StartResult =
  | { kind: "created"; row: EmailChangeRow; oldEmail: string }
  /** Yeni adres başka hesapta: talep açılmaz; yanıt dışarıdan aynıdır, sahibine bilgilendirme gider. */
  | { kind: "taken"; ownerEmail: string }
  | { kind: "limited"; retryAfterMs: number }
  | { kind: "rejected"; reason: StartRejection };

export type Applied = { userId: string; oldEmail: string; newEmail: string };
export type ConfirmResult =
  | { kind: "waiting"; step: "new" | "old" }
  /** `applied` yalnız bu çağrıda uygulandıysa dolu (bildirim e-postaları için); tekrar tıklamada null. */
  | { kind: "applied"; step: "new" | "old"; applied: Applied | null }
  | { kind: "rejected"; reason: "invalid" | "email_taken" };
export type DenyResult =
  | { kind: "denied"; fresh: boolean; userId: string; oldEmail: string }
  | { kind: "rejected"; reason: "invalid" | "already_applied" };

export type CancelResult = { kind: "cancelled" | "unchanged" } | { kind: "rejected"; reason: "not_found" | "forbidden" };

export interface EmailChangeStore {
  start(input: StartInput): Promise<StartResult>;
  /** Hesabın son talebi (her durumda); yoksa null. */
  latest(userId: string): Promise<EmailChangeRow | null>;
  list(userId: string, limit: number): Promise<EmailChangeRow[] | null>;
  confirm(input: { tokenHash: string; requestId: string; now: Date }): Promise<ConfirmResult>;
  deny(input: { tokenHash: string; requestId: string; now: Date }): Promise<DenyResult>;
  /** Kullanıcının kendi açık talebini iptal eder (idempotent). */
  cancelOwn(input: Mutation & { userId: string }): Promise<CancelResult>;
  /** Yönetici iptali (gerekçeli, idempotent). */
  cancelByAdmin(input: Mutation & { userId: string; reason: string }): Promise<CancelResult>;
  /** E-postalar gönderilemedi: talep açık kalmasın (yeniden denenebilir). */
  failSend(requestId: string, now: Date): Promise<void>;
}

/** d***@example.test: yalnız ilk harf ve alan adı görünür. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  return `${local.length > 1 ? local[0] : ""}***${email.slice(at)}`;
}

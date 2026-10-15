// Kullanıcının kendi hesabını silme endpoint'leri — #181. Sözleşme: contracts/domains/privacy.ts (me.deletion.*, auth.deletion.*).
// Kurallar: docs/KV-33_ADMIN_USERS.md §12.
//
// Akış: önizleme → talep (mevcut parola, MFA açıksa taze step-up, kullanıcı adının yazılı teyidi; HESABI SİLMEZ, kayıtlı
// e-postaya onay + "ben değilim" bağlantıları gider) → e-postadaki bağlantıda AÇIK onay → geri alınamaz anonimleştirme
// (account-erasure `anonymize`, `self` kipi: yönetici yoluyla aynı kapsam, engel ve idempotency). Silme yalnız e-posta
// bağlantısı tıklanınca olur; sayfa açılışı hiçbir şey yapmaz.
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import { sendSafely, type Mailer } from "../../mail/mailer.ts";
import type { AccountErasureStore, ErasureBlocker } from "../account-erasure/store.ts";
import { hashToken, newToken, type PasswordHasher } from "../auth/crypto.ts";
import type { LoginGuard } from "../rate-limit/limiter.ts";
import { rateLimitError } from "../rate-limit/limiter.ts";
import type { MfaStore } from "../security/store.ts";
import { cancelledMail, confirmMail, deletedMail } from "./mail.ts";
import type { AccountDeletionStore, DeletionRow } from "./store.ts";

export type AccountDeletionDeps = {
  store: AccountDeletionStore;
  erasure: AccountErasureStore;
  mfa?: MfaStore;
  hasher: PasswordHasher;
  mailer: Mailer;
  loginGuard?: LoginGuard;
  /** account.selfDeletionEnabled (varsayılan kapalı). */
  isEnabled: () => Promise<boolean>;
  now: () => Date;
  tokenPepper: string;
  webUrl: string;
};

/** Onay bağlantısı ömrü, saatlik talep sınırı ve ardışık talepler arası en kısa süre. */
export const LINK_TTL_MS = 24 * 60 * 60 * 1000;
export const HOURLY_LIMIT = 3;
export const COOLDOWN_MS = 60 * 1000;
/** Silme audit/kayıt gerekçesi (kullanıcı başlatmasında serbest metin yok). */
export const SELF_REASON = "Kullanıcının kendi silme talebi";

const conflict = (message: string, code: string) => new ApiError("CONFLICT", message, [{ code }]);

const BLOCKED: Record<ErasureBlocker, () => ApiError> = {
  legal_hold: () => conflict("Hesabın üzerinde bir saklama yükümlülüğü var; şu an silinemez. Destek ile iletişime geç.", "legal_hold"),
  active_sanction: () => conflict("Hesabında süresi dolmamış bir yaptırım var; yaptırım bitene kadar silinemez.", "active_sanction"),
  has_role: () => conflict("Hesabın yönetici veya moderatör rolü var; silinmeden önce rolün kaldırılmalı. Destek ile iletişime geç.", "has_role"),
  export_in_progress: () => conflict("Veri paketi talebin sürüyor; paket hazırlanıp teslim edilene veya başarısız olana kadar bekle.", "export_in_progress"),
};

export const deletionView = (row: DeletionRow) => ({
  id: row.id,
  status: row.status,
  expiresAt: row.expiresAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  finishedAt: row.finishedAt?.toISOString() ?? null,
  failure: row.failure,
});

export function registerAccountDeletionRoutes(route: Route, deps: AccountDeletionDeps): void {
  const { store, erasure, mailer, now, tokenPepper, webUrl } = deps;
  const disabled = () => new ApiError("FEATURE_DISABLED", "Hesap silme şu an kapalı.");
  const invalidLink = () => new ApiError("TOKEN_INVALID_OR_EXPIRED", "Bağlantı geçersiz veya süresi dolmuş.");
  const mfaEnabled = async (userId: string, sessionId: string) => (deps.mfa ? (await deps.mfa.status(userId, sessionId, now())).enabled : false);

  route("me.deletion.preview", async ({ viewer }) => {
    const at = now();
    const preview = await erasure.preview(viewer!.id, at);
    if (!preview) throw new ApiError("NOT_FOUND", "Hesap bulunamadı.");
    const [enabled, latest, mfa] = await Promise.all([deps.isEnabled(), store.latest(viewer!.id), mfaEnabled(viewer!.id, viewer!.sessionId)]);
    return {
      status: 200,
      body: {
        data: {
          username: preview.username,
          enabled,
          canRequest: enabled && !preview.anonymized && preview.blockers.length === 0,
          blockers: preview.blockers,
          mfaRequired: mfa,
          request: latest ? deletionView(latest) : null,
          willRemove: preview.willRemove,
          willRetain: preview.willRetain,
        },
      },
    };
  });

  route("me.deletion.request", async ({ viewer, body, request }) => {
    if (!(await deps.isEnabled())) throw disabled();
    // Yeniden kimlik doğrulama: yanlış parola giriş başarısızlık sayacına eklenir (çalınmış oturumla parola denenemez).
    await deps.loginGuard?.check(viewer!.user.email, request.ip, request.log);
    if (!(await deps.hasher.verify(viewer!.user.passwordHash, body.password))) {
      await deps.loginGuard?.fail(viewer!.user.email, request.ip);
      throw new ApiError("INVALID_CREDENTIALS", "Parola hatalı.");
    }
    const at = now();
    // Engeller talep açılmadan bildirilir; kesin karar onay anındaki silme transaction'ındadır (aynı kurallar yeniden denetlenir).
    const preview = await erasure.preview(viewer!.id, at);
    const blocker = preview?.blockers[0];
    if (blocker) throw BLOCKED[blocker]();

    const raw = newToken();
    const result = await store.request({
      userId: viewer!.id,
      sessionId: viewer!.sessionId,
      actorId: viewer!.id,
      requestId: request.id,
      now: at,
      confirmUsername: body.confirmUsername,
      mfaEnabled: await mfaEnabled(viewer!.id, viewer!.sessionId),
      tokenHash: hashToken(raw, tokenPepper),
      expiresAt: new Date(at.getTime() + LINK_TTL_MS),
      hourlyLimit: HOURLY_LIMIT,
      cooldownMs: COOLDOWN_MS,
    });
    if (result.kind === "limited") throw rateLimitError(result.retryAfterMs / 1000);
    if (result.kind === "rejected") {
      if (result.reason === "confirmation_mismatch") throw conflict("Yazdığın kullanıcı adı hesabınkiyle eşleşmiyor; hiçbir şey değişmedi.", "confirmation_mismatch");
      if (result.reason === "mfa_required") throw conflict("Hesabı silmeden önce bu oturumda MFA ile yeniden doğrula.", "mfa_required");
      throw new ApiError("NOT_FOUND", "Hesap bulunamadı.");
    }
    try {
      await mailer.send(confirmMail(webUrl, result.email, raw));
    } catch {
      request.log.error({ requestId: result.row.id, failure: "mail_failed" }, "hesap silme onay bağlantısı gönderilemedi");
      await store.cancelOwn({ userId: viewer!.id, actorId: viewer!.id, requestId: request.id, now: now() });
      return { status: 202, body: { data: { status: "SEND_FAILED" as const, expiresAt: null } } };
    }
    return { status: 202, body: { data: { status: "CONFIRMATION_SENT" as const, expiresAt: result.row.expiresAt.toISOString() } } };
  });

  route("me.deletion.cancel", async ({ viewer, request }) => {
    const result = await store.cancelOwn({ userId: viewer!.id, actorId: viewer!.id, requestId: request.id, now: now() });
    return { status: 200, body: { data: { cancelled: result.cancelled } } };
  });

  route("auth.deletion.confirm", async ({ body, request }) => {
    const at = now();
    const prepared = await store.prepare(hashToken(body.token, tokenPepper), at);
    if (prepared.kind === "rejected") throw invalidLink();
    if (prepared.kind === "done") return { status: 200, body: { data: { status: "unchanged" as const } } };
    const result = await erasure.anonymize({
      userId: prepared.userId,
      actorId: prepared.userId,
      reason: SELF_REASON,
      confirmUsername: "",
      requestId: request.id,
      now: at,
      self: true,
      // Kilit altında: talep hâlâ açık mı (iptal ile onay yarışırsa iptal kazanır) ve silmeyle aynı transaction'da kapanır.
      onLocked: (tx) => store.isOpen(tx, prepared.deletionId, at),
      onDone: (tx) => store.markCompleted(tx, prepared.deletionId, at),
    });
    if (result.kind === "rejected") {
      const reason = result.reason;
      if (reason === "legal_hold" || reason === "active_sanction" || reason === "has_role" || reason === "export_in_progress") {
        await store.fail(prepared.deletionId, reason, now());
        throw BLOCKED[reason]();
      }
      // Kilidi kaybeden eşzamanlı onay: kazanan talebi kapattıysa bu istek de başarılıdır (idempotent), aksi halde bağlantı geçersizdir.
      if (reason === "stale" && (await store.prepare(hashToken(body.token, tokenPepper), now())).kind === "done") {
        return { status: 200, body: { data: { status: "unchanged" as const } } };
      }
      throw invalidLink();
    }
    if (result.kind === "anonymized") await sendSafely(mailer, deletedMail(prepared.email), request.log);
    return { status: 200, body: { data: { status: result.kind === "anonymized" ? ("deleted" as const) : ("unchanged" as const) } } };
  });

  route("auth.deletion.cancel", async ({ body, request }) => {
    const result = await store.cancelByToken({ tokenHash: hashToken(body.token, tokenPepper), requestId: request.id, now: now() });
    if (result.kind === "rejected") {
      if (result.reason === "already_deleted") throw conflict("Hesap zaten silinmiş; bu işlem geri alınamaz.", "already_deleted");
      throw invalidLink();
    }
    if (result.fresh) await sendSafely(mailer, cancelledMail(webUrl, result.email), request.log);
    return { status: 200, body: { data: { cancelled: true as const } } };
  });
}

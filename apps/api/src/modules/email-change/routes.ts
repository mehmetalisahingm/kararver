// E-posta değişimi endpoint'leri — #181. Sözleşme: contracts/domains/auth.ts (me.emailChange.*, auth.emailChange.*) ve
// admin.ts (admin.users.emailChange.*). Kurallar: docs/KV-33_ADMIN_USERS.md §11.
//
// Akış (kullanıcı): parola ile sahiplik kanıtı → yeni adrese doğrulama + eski adrese onay/reddet bağlantısı → iki tıklama
// tamamlanınca e-posta değişir, oturumlar kapanır. Destek yolunda eski adres onayı yoktur ama yeni adres doğrulaması vardır;
// eski adrese itiraz bağlantısı gider. Doğrulamayı atlayan bir yol yoktur.
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import { sendSafely, type Mailer } from "../../mail/mailer.ts";
import { authorizeTarget } from "../admin-users/routes.ts";
import type { AdminUserStore } from "../admin-users/store.ts";
import { hashToken, newToken, type PasswordHasher } from "../auth/crypto.ts";
import { normalizeEmail } from "../auth/routes.ts";
import type { LoginGuard } from "../rate-limit/limiter.ts";
import { rateLimitError } from "../rate-limit/limiter.ts";
import { appliedNewMail, appliedOldMail, deniedMail, newAddressMail, oldAddressMail, takenAddressMail } from "./mail.ts";
import { maskEmail, type EmailChangeRow, type EmailChangeStore } from "./store.ts";

export type EmailChangeDeps = {
  store: EmailChangeStore;
  users: AdminUserStore;
  hasher: PasswordHasher;
  mailer: Mailer;
  loginGuard?: LoginGuard;
  /** account.emailChangeEnabled (varsayılan kapalı). */
  isEnabled: () => Promise<boolean>;
  now: () => Date;
  tokenPepper: string;
  webUrl: string;
};

/** Bağlantı ömrü, kullanıcı başına saatlik talep sınırı ve ardışık talepler arası en kısa süre. */
export const LINK_TTL_MS = 24 * 60 * 60 * 1000;
export const HOURLY_LIMIT = 3;
export const COOLDOWN_MS = 60 * 1000;
const LIST_LIMIT = 10;

const conflict = (message: string, code: string) => new ApiError("CONFLICT", message, [{ code }]);

export const emailChangeView = (row: EmailChangeRow) => ({
  id: row.id,
  origin: row.origin,
  status: row.status,
  newEmailMasked: row.status === "OPEN" && row.newEmail ? maskEmail(row.newEmail) : null,
  requiresOld: row.requiresOld,
  newConfirmed: row.newConfirmedAt !== null,
  oldConfirmed: row.oldConfirmedAt !== null,
  expiresAt: row.expiresAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  finishedAt: row.finishedAt?.toISOString() ?? null,
  failure: row.failure,
});

export function registerEmailChangeRoutes(route: Route, deps: EmailChangeDeps): void {
  const { store, users, hasher, mailer, now, tokenPepper, webUrl } = deps;
  const disabled = () => new ApiError("FEATURE_DISABLED", "E-posta değişimi şu an kapalı.");
  const userNotFound = () => new ApiError("NOT_FOUND", "Kullanıcı bulunamadı.");
  const invalidLink = () => new ApiError("TOKEN_INVALID_OR_EXPIRED", "Bağlantı geçersiz veya süresi dolmuş.");

  /** Başlatma ortak gövdesi: token üretimi, talep, e-postalar. Başarısız gönderimde talep açık kalmaz. */
  async function begin(
    ctx: { request: { id: string; log: Parameters<typeof sendSafely>[2] } },
    input: { userId: string; actorId: string; origin: "USER" | "ADMIN"; reason: string | null; newEmail: string },
  ) {
    const at = now();
    const rawNew = newToken();
    const rawOld = newToken();
    const expiresAt = new Date(at.getTime() + LINK_TTL_MS);
    const result = await store.start({
      userId: input.userId,
      actorId: input.actorId,
      requestId: ctx.request.id,
      now: at,
      origin: input.origin,
      reason: input.reason,
      newEmail: input.newEmail.trim(),
      newEmailNormalized: normalizeEmail(input.newEmail),
      newTokenHash: hashToken(rawNew, tokenPepper),
      oldTokenHash: hashToken(rawOld, tokenPepper),
      expiresAt,
      hourlyLimit: HOURLY_LIMIT,
      cooldownMs: COOLDOWN_MS,
    });
    if (result.kind === "limited") throw rateLimitError(result.retryAfterMs / 1000);
    if (result.kind === "rejected") {
      if (result.reason === "not_found") throw userNotFound();
      if (result.reason === "forbidden") throw new ApiError("FORBIDDEN", "Bu işlem için yetkiniz yok.");
      if (result.reason === "user_deleted") throw conflict("Silinmiş (anonimleştirilmiş) hesabın e-postası değiştirilemez.", "user_deleted");
      if (result.reason === "same_email") throw conflict("Yeni e-posta adresi mevcut adresle aynı.", "same_email");
      throw conflict("Hesapta açık bir e-posta değişimi talebi var; önce iptal et.", "request_open");
    }
    const accepted = (status: "VERIFICATION_SENT" | "SEND_FAILED", until: Date | null) => ({
      status: 202,
      body: { data: { status, expiresAt: until?.toISOString() ?? null } },
    });
    if (result.kind === "taken") {
      // Dışarıya fark sızmaz: aynı 202; adresin sahibine bilgilendirme gider.
      await sendSafely(mailer, takenAddressMail(webUrl, result.ownerEmail), ctx.request.log);
      return accepted("VERIFICATION_SENT", expiresAt);
    }
    try {
      await mailer.send(newAddressMail(webUrl, input.newEmail.trim(), rawNew));
      await mailer.send(oldAddressMail(webUrl, result.oldEmail, rawOld, maskEmail(input.newEmail.trim()), input.origin));
    } catch {
      ctx.request.log.error({ requestId: result.row.id, failure: "mail_failed" }, "e-posta değişimi bağlantıları gönderilemedi");
      await store.failSend(result.row.id, now());
      return accepted("SEND_FAILED", null);
    }
    return accepted("VERIFICATION_SENT", expiresAt);
  }

  route("me.emailChange.request", async (ctx) => {
    const { viewer, body, request } = ctx;
    if (!(await deps.isEnabled())) throw disabled();
    // Parola yanlışları giriş başarısızlık sayacına eklenir: bu uç nokta parola denemeye açılmaz (çalınmış oturum senaryosu).
    await deps.loginGuard?.check(viewer!.user.email, request.ip, request.log);
    if (!(await hasher.verify(viewer!.user.passwordHash, body.password))) {
      await deps.loginGuard?.fail(viewer!.user.email, request.ip);
      throw new ApiError("INVALID_CREDENTIALS", "Parola hatalı.");
    }
    return begin(ctx, { userId: viewer!.id, actorId: viewer!.id, origin: "USER", reason: null, newEmail: body.newEmail });
  });

  route("me.emailChange.get", async ({ viewer }) => {
    const row = await store.latest(viewer!.id);
    return { status: 200, body: { data: row ? emailChangeView(row) : null } };
  });

  route("me.emailChange.cancel", async ({ viewer, request }) => {
    const result = await store.cancelOwn({ userId: viewer!.id, actorId: viewer!.id, requestId: request.id, now: now() });
    if (result.kind === "rejected") throw userNotFound();
    return { status: 200, body: { data: { cancelled: result.kind === "cancelled" } } };
  });

  route("auth.emailChange.confirm", async ({ body, request }) => {
    const result = await store.confirm({ tokenHash: hashToken(body.token, tokenPepper), requestId: request.id, now: now() });
    if (result.kind === "rejected") {
      if (result.reason === "email_taken") throw conflict("Yeni e-posta adresi bu arada başka bir hesapta kullanıldı; talep sonlandı.", "email_taken");
      throw invalidLink();
    }
    if (result.kind === "applied" && result.applied) {
      const { oldEmail, newEmail } = result.applied;
      await sendSafely(mailer, appliedOldMail(webUrl, oldEmail, maskEmail(newEmail)), request.log);
      await sendSafely(mailer, appliedNewMail(webUrl, newEmail), request.log);
    }
    return { status: 200, body: { data: { status: result.kind, step: result.step } } };
  });

  route("auth.emailChange.deny", async ({ body, request }) => {
    const result = await store.deny({ tokenHash: hashToken(body.token, tokenPepper), requestId: request.id, now: now() });
    if (result.kind === "rejected") {
      if (result.reason === "already_applied") throw conflict("E-posta zaten değiştirilmiş; destek ile iletişime geç.", "already_applied");
      throw invalidLink();
    }
    if (result.fresh) await sendSafely(mailer, deniedMail(webUrl, result.oldEmail), request.log);
    return { status: 200, body: { data: { denied: true as const } } };
  });

  route("admin.users.emailChange.start", async (ctx) => {
    const { params, body, viewer } = ctx;
    if (!(await deps.isEnabled())) throw disabled();
    await authorizeTarget(users, ctx, params.id);
    return begin(ctx, { userId: params.id, actorId: viewer!.id, origin: "ADMIN", reason: body.reason, newEmail: body.newEmail });
  });

  route("admin.users.emailChange.list", async (ctx) => {
    await authorizeTarget(users, ctx, ctx.params.id);
    const rows = await store.list(ctx.params.id, LIST_LIMIT);
    if (!rows) throw userNotFound();
    return { status: 200, body: { data: rows.map(emailChangeView) } };
  });

  route("admin.users.emailChange.cancel", async (ctx) => {
    const { params, body, viewer, request } = ctx;
    await authorizeTarget(users, ctx, params.id);
    const result = await store.cancelByAdmin({ userId: params.id, reason: body.reason, actorId: viewer!.id, requestId: request.id, now: now() });
    if (result.kind === "rejected") {
      if (result.reason === "forbidden") throw new ApiError("FORBIDDEN", "Bu işlem için yetkiniz yok.");
      throw userNotFound();
    }
    return { status: 200, body: { data: { cancelled: result.kind === "cancelled" } } };
  });
}

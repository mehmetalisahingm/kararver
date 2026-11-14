// SA #180: authenticated TOTP setup and fresh session-bound verification.
// All write endpoints depend on DB transaction/row locks in MfaStore.
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { PasswordHasher } from "../auth/crypto.ts";
import type { MfaStore } from "./store.ts";

/**
 * #373 (Utku) P1: parola soran MFA uçları parola kahini olmamalı. Oturumu çalınan biri yanlış/doğru parolayı hata
 * kodundan ayırt edememeli; bu yüzden parola ve ikinci etken redleri aynı yanıtı verir. Deneme sayısı ayrıca
 * hız sınırıyla (ENDPOINT_RULES "mfa.reauth.hour") sınırlıdır.
 */
const reauthFailed = () => new ApiError("FORBIDDEN", "Kimliğin yeniden doğrulanamadı. Bilgileri kontrol edip tekrar dene.", [{ code: "reauth_failed" }]);

export function registerMfaRoutes(route: Route, deps: {
  store: MfaStore; hasher: PasswordHasher; now: () => Date;
}): void {
  route("me.mfa.status", async ({ viewer }) => {
    const state = await deps.store.status(viewer!.id, viewer!.sessionId, deps.now());
    return { status: 200, body: { data: { enabled: state.enabled,
      stepUpExpiresAt: state.stepUpExpiresAt?.toISOString() ?? null } } };
  });
  route("me.mfa.setup", async ({ viewer, body, request }) => {
    if (!viewer!.emailVerified) throw new ApiError("FORBIDDEN", "E-posta doğrulanmış olmalı.");
    const ok = await deps.hasher.verify(viewer!.user.passwordHash, body.password);
    if (!ok) throw reauthFailed();
    const result = await deps.store.begin({ userId: viewer!.id, sessionId: viewer!.sessionId,
      email: viewer!.user.email, now: deps.now(), requestId: request.id });
    if (result.kind === "session") throw new ApiError("UNAUTHENTICATED", "Oturum geçersiz.");
    if (result.kind === "conflict") throw new ApiError("CONFLICT", "MFA zaten etkin.");
    return { status: 200, body: { data: { secret: result.secret, uri: result.uri,
      expiresAt: result.expiresAt.toISOString() } } };
  });
  route("me.mfa.confirm", async ({ viewer, body, request }) => {
    const result = await deps.store.confirm({ userId: viewer!.id, sessionId: viewer!.sessionId,
      code: body.code, now: deps.now(), requestId: request.id });
    if (result.kind !== "enabled") throw new ApiError("FORBIDDEN", "MFA doğrulaması başarısız veya süresi dolmuş.");
    return { status: 200, body: { data: { enabled: true, recoveryCodes: result.recoveryCodes } } };
  });
  route("me.mfa.stepup", async ({ viewer, body, request }) => {
    const result = await deps.store.stepUp({ userId: viewer!.id, sessionId: viewer!.sessionId,
      code: body.code, now: deps.now(), requestId: request.id });
    if (result.kind !== "verified") throw new ApiError("FORBIDDEN", "MFA doğrulaması başarısız veya süresi dolmuş.");
    return { status: 200, body: { data: { stepUpExpiresAt: result.expiresAt.toISOString() } } };
  });
  route("me.mfa.recover", async ({ viewer, body, request }) => {
    // Yanlış parola ile yanlış kurtarma kodu aynı yanıtı verir (parola kahini yok).
    if (!(await deps.hasher.verify(viewer!.user.passwordHash, body.password))) throw reauthFailed();
    const result = await deps.store.recover({ userId: viewer!.id, sessionId: viewer!.sessionId,
      code: body.code, now: deps.now(), requestId: request.id });
    if (result.kind !== "verified") throw reauthFailed();
    return { status: 200, body: { data: { stepUpExpiresAt: result.expiresAt.toISOString() } } };
  });
  // #180/#291 doğrulayıcı yenileme: eski sır onaya kadar geçerli; kullanıcı kilitlenmez.
  route("me.mfa.reenroll.begin", async ({ viewer, body, request }) => {
    // #373 P1: ikinci etken (taze step-up) parolaDAN ÖNCE. Step-up'sız istekte parola hiç denenmez; step-up'sız ve
    // yanlış parolalı istek aynı yanıtı alır. MFA etkin değilse parola da denenmez.
    const state = await deps.store.status(viewer!.id, viewer!.sessionId, deps.now());
    if (!state.enabled) throw new ApiError("CONFLICT", "MFA etkin değil.", [{ code: "mfa_not_enabled" }]);
    if (!state.stepUpExpiresAt) throw reauthFailed();
    if (!(await deps.hasher.verify(viewer!.user.passwordHash, body.password))) throw reauthFailed();
    const result = await deps.store.reenrollBegin({ userId: viewer!.id, sessionId: viewer!.sessionId,
      email: viewer!.user.email, now: deps.now(), requestId: request.id });
    if (result.kind === "session") throw new ApiError("UNAUTHENTICATED", "Oturum geçersiz.");
    if (result.kind === "not_enabled") throw new ApiError("CONFLICT", "MFA etkin değil.", [{ code: "mfa_not_enabled" }]);
    if (result.kind === "key_required")
      throw new ApiError("CONFLICT", "Doğrulayıcı yenileme bu ortamda henüz açık değil.", [{ code: "mfa_key_required" }]);
    if (result.kind !== "created") throw reauthFailed(); // stepup_required: eşzamanlı istek step-up'ı tüketti
    return { status: 200, body: { data: { secret: result.secret, uri: result.uri,
      expiresAt: result.expiresAt.toISOString() } } };
  });
  route("me.mfa.reenroll.confirm", async ({ viewer, body, request }) => {
    const result = await deps.store.reenrollConfirm({ userId: viewer!.id, sessionId: viewer!.sessionId,
      code: body.code, now: deps.now(), requestId: request.id });
    if (result.kind === "session") throw new ApiError("UNAUTHENTICATED", "Oturum geçersiz.");
    if (result.kind !== "reenrolled") throw new ApiError("FORBIDDEN", "Yeni doğrulayıcı kodu doğrulanamadı veya süresi doldu. Eski doğrulayıcın geçerli.");
    return { status: 200, body: { data: { enabled: true, recoveryCodes: result.recoveryCodes } } };
  });
}

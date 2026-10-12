// SA #180: authenticated TOTP setup and fresh session-bound verification.
// All write endpoints depend on DB transaction/row locks in MfaStore.
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { PasswordHasher } from "../auth/crypto.ts";
import type { MfaStore } from "./store.ts";

export function registerMfaRoutes(route: Route, deps: {
  store: MfaStore; hasher: PasswordHasher; now: () => Date;
}): void {
  route("me.mfa.status", async ({ viewer }) => {
    const state = await deps.store.status(viewer!.id, viewer!.sessionId, deps.now());
    return { status: 200, body: { data: { enabled: state.enabled,
      stepUpExpiresAt: state.stepUpExpiresAt?.toISOString() ?? null } } };
  });
  route("me.mfa.setup", async ({ viewer, body }) => {
    if (!viewer!.user.emailVerifiedAt) throw new ApiError("FORBIDDEN", "E-posta doğrulanmış olmalı.");
    const ok = await deps.hasher.verify(viewer!.user.passwordHash, body.password);
    if (!ok) throw new ApiError("FORBIDDEN", "Kimlik yeniden doğrulanamadı.");
    const result = await deps.store.begin({ userId: viewer!.id, sessionId: viewer!.sessionId,
      email: viewer!.user.email, now: deps.now() });
    if (result.kind === "session") throw new ApiError("UNAUTHENTICATED", "Oturum geçersiz.");
    if (result.kind === "conflict") throw new ApiError("CONFLICT", "MFA zaten etkin.");
    return { status: 200, body: { data: { secret: result.secret, uri: result.uri,
      expiresAt: result.expiresAt.toISOString() } } };
  });
  route("me.mfa.confirm", async ({ viewer, body }) => {
    const status = await deps.store.confirm({ userId: viewer!.id, sessionId: viewer!.sessionId,
      code: body.code, now: deps.now() });
    if (status !== "enabled") throw new ApiError("FORBIDDEN", "MFA doğrulaması başarısız veya süresi dolmuş.");
    return { status: 200, body: { data: { enabled: true } } };
  });
  route("me.mfa.stepup", async ({ viewer, body }) => {
    const result = await deps.store.stepUp({ userId: viewer!.id, sessionId: viewer!.sessionId,
      code: body.code, now: deps.now() });
    if (result.kind !== "verified") throw new ApiError("FORBIDDEN", "MFA doğrulaması başarısız veya süresi dolmuş.");
    return { status: 200, body: { data: { stepUpExpiresAt: result.expiresAt.toISOString() } } };
  });
}

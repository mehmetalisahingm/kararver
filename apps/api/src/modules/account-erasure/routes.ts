// Hesap anonimleştirme ve yasal saklama endpoint'leri — #181. Sözleşme: contracts/domains/admin.ts
// (admin.users.erasure.*, admin.users.legalHold.*). Kurallar, kapsam ve saklama tablosu: docs/KV-33_ADMIN_USERS.md §10.
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import { authorizeTarget } from "../admin-users/routes.ts";
import type { AdminUserStore } from "../admin-users/store.ts";
import type { AccountErasureStore, AnonymizeRejection, ErasurePreviewRow, LegalHoldRow } from "./store.ts";

export type AccountErasureDeps = { store: AccountErasureStore; users: AdminUserStore; now: () => Date };

const conflict = (message: string, code: string) => new ApiError("CONFLICT", message, [{ code }]);

const ANONYMIZE_CONFLICTS: Record<Exclude<AnonymizeRejection, "not_found" | "forbidden">, () => ApiError> = {
  mfa_required: () => conflict("Hesap silmeden önce bu oturumda MFA ile yeniden doğrula.", "mfa_required"),
  confirmation_mismatch: () => conflict("Yazılı teyit hesabın kullanıcı adıyla eşleşmiyor; hiçbir şey değişmedi.", "confirmation_mismatch"),
  legal_hold: () => conflict("Hesapta yasal saklama var; kaldırılana kadar anonimleştirilemez.", "legal_hold"),
  active_sanction: () => conflict("Hesapta süresi dolmamış yaptırım var; yaptırım kalkana veya dolana kadar anonimleştirilemez.", "active_sanction"),
  has_role: () => conflict("Hesabın yönetici/moderatör rolü var; önce rolü kaldır.", "has_role"),
  export_in_progress: () => conflict("Kullanıcının veri paketi talebi sürüyor; paket hazırlanıp teslim edilene veya başarısız olana kadar bekle.", "export_in_progress"),
};

export const legalHoldView = (hold: LegalHoldRow) => ({ id: hold.id, reason: hold.reason, placedAt: hold.createdAt.toISOString(), placedById: hold.placedById });

export const erasurePreviewView = (row: ErasurePreviewRow) => ({
  userId: row.userId,
  username: row.username,
  anonymized: row.anonymized,
  anonymizedAt: row.anonymizedAt?.toISOString() ?? null,
  canAnonymize: !row.anonymized && row.blockers.length === 0,
  blockers: row.blockers,
  legalHold: row.legalHold ? legalHoldView(row.legalHold) : null,
  willRemove: row.willRemove,
  willRetain: row.willRetain,
});

export function registerAccountErasureRoutes(route: Route, deps: AccountErasureDeps): void {
  const { store, users, now } = deps;
  const userNotFound = () => new ApiError("NOT_FOUND", "Kullanıcı bulunamadı.");
  const forbidden = () => new ApiError("FORBIDDEN", "Bu işlem için yetkiniz yok.");

  route("admin.users.erasure.preview", async (ctx) => {
    // İstek öncesi karar (hedef rolü DB'den); kendi hesabı için kullanılamaz (sanctionTarget).
    await authorizeTarget(users, ctx, ctx.params.id);
    const row = await store.preview(ctx.params.id, now());
    if (!row) throw userNotFound();
    return { status: 200, body: { data: erasurePreviewView(row) } };
  });

  route("admin.users.erasure.create", async (ctx) => {
    const { params, body, viewer, request } = ctx;
    await authorizeTarget(users, ctx, params.id);
    const result = await store.anonymize({ userId: params.id, reason: body.reason, confirmUsername: body.confirmUsername, actorId: viewer!.id, actorSessionId: viewer!.sessionId, requestId: request.id, now: now() });
    if (result.kind === "rejected") {
      if (result.reason === "not_found") throw userNotFound();
      if (result.reason === "forbidden") throw forbidden();
      throw ANONYMIZE_CONFLICTS[result.reason]();
    }
    return { status: 200, body: { data: { status: result.kind, anonymizedAt: result.at.toISOString() } } };
  });

  route("admin.users.legalHold.put", async ({ params, body, viewer, request }) => {
    const result = await store.placeHold({ userId: params.id, reason: body.reason, actorId: viewer!.id, requestId: request.id, now: now() });
    if (result.kind === "rejected") {
      if (result.reason === "not_found") throw userNotFound();
      if (result.reason === "forbidden") throw forbidden();
      throw conflict("Anonimleştirilmiş hesaba yasal saklama konmaz.", "user_deleted");
    }
    return { status: 200, body: { data: { legalHold: legalHoldView(result.hold) } } };
  });

  route("admin.users.legalHold.release", async ({ params, body, viewer, request }) => {
    const result = await store.releaseHold({ userId: params.id, reason: body.reason, actorId: viewer!.id, requestId: request.id, now: now() });
    if (result.kind === "rejected") {
      if (result.reason === "not_found") throw userNotFound();
      throw forbidden();
    }
    return { status: 200, body: { data: { legalHold: null } } };
  });
}

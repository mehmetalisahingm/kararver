// Global rol ataması — KV-33 (#35). Sözleşme: contracts/domains/admin.ts (admin.roles.put). Yetki KV-04 user.role.assign
// (yalnız SUPER_ADMIN; kendi rolünü değiştirme ve son aktif SUPER_ADMIN'i düşürme 409 CONFLICT). İlk SUPER_ADMIN bu
// endpoint'le değil admin:bootstrap CLI'ı ile atanır (KV-12).
//
// Handler hedefin rolünü ve aktif SUPER_ADMIN sayısını DB'den okuyup ctx.authorize çağırır; store aynı kararı
// transaction içinde SUPER_ADMIN rol satırları kilitliyken yeniden verir (iki SUPER_ADMIN'in birbirini aynı anda
// düşürmesi). Audit: user.role.assign / grant (USER → rol) | revoke (rol → USER) | change (rolden role).
import type { Role } from "@kararver/db";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import { superAdminCountForRoleRule, type AdminUserStore } from "../admin-users/store.ts";

export type RoleRouteDeps = { store: AdminUserStore; now: () => Date };

export function registerRoleRoutes(route: Route, deps: RoleRouteDeps): void {
  const { store, now } = deps;

  route("admin.roles.put", async ({ params, body, viewer, request, authorize }) => {
    const target = await store.target(params.id);
    if (!target) throw new ApiError("NOT_FOUND", "Kullanıcı bulunamadı.");
    await authorize({
      targetUserId: target.id,
      targetRoles: target.role ? [target.role] : [],
      newRole: body.role,
      activeSuperAdminCount: superAdminCountForRoleRule(await store.activeSuperAdminCount(), target),
    });

    const result = await store.setRole({ userId: params.id, role: body.role as Role, reason: body.reason, actorId: viewer!.id, requestId: request.id, now: now() });
    if (result.kind === "rejected") {
      switch (result.reason) {
        case "not_found":
          throw new ApiError("NOT_FOUND", "Kullanıcı bulunamadı.");
        case "forbidden":
          throw new ApiError("FORBIDDEN", "Bu işlem için yetkiniz yok.");
        case "self":
          throw new ApiError("CONFLICT", "Kendi rolünüzü değiştiremezsiniz.", [{ code: "self" }]);
        case "last_super_admin":
          throw new ApiError("CONFLICT", "Son aktif SUPER_ADMIN düşürülemez.", [{ code: "last_super_admin" }]);
      }
    }
    return { status: 200, body: { data: { userId: params.id, roles: [result.role] } } };
  });
}

import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import { superAdminCountForRoleRule, type AdminUserStore } from "../admin-users/store.ts";
import type { RoleApprovalStore } from "./approval-store.ts";

export function registerRoleApprovalRoutes(route: Route, deps: {
  store: RoleApprovalStore; users: AdminUserStore; now: () => Date;
}): void {
  const view = (r: { id: string; targetUserId: string; requestedRole: string; status: string; expiresAt: Date }) =>
    ({ id: r.id, userId: r.targetUserId, role: r.requestedRole, status: r.status, expiresAt: r.expiresAt.toISOString() });

  route("admin.roleApprovals.get", async ({ params, authorize }) => {
    const data = await deps.store.get(params.id);
    if (!data) throw new ApiError("NOT_FOUND", "Onay talebi bulunamadı.");
    const target = await deps.users.target(data.userId);
    if (!target) throw new ApiError("NOT_FOUND", "Hedef kullanıcı bulunamadı.");
    await authorize({ targetUserId: target.id, targetRoles: target.role ? [target.role] : [],
      newRole: data.role, activeSuperAdminCount: superAdminCountForRoleRule(await deps.users.activeSuperAdminCount(), target) });
    return { status: 200, body: { data: { ...data, expiresAt: data.expiresAt.toISOString() } } };
  });

  route("admin.roleApprovals.request", async ({ body, viewer, request, authorize }) => {
    const target = await deps.users.target(body.userId);
    if (!target) throw new ApiError("NOT_FOUND", "Hedef kullanıcı bulunamadı.");
    await authorize({ targetUserId: target.id, targetRoles: target.role ? [target.role] : [],
      newRole: body.role, activeSuperAdminCount: superAdminCountForRoleRule(await deps.users.activeSuperAdminCount(), target) });
    // Prevent impossible approval requests for a new SUPER_ADMIN under the single-owner policy.
    if (body.role === "SUPER_ADMIN" && target.role !== "SUPER_ADMIN")
      throw new ApiError("FORBIDDEN", "Yeni SUPER_ADMIN ataması kapalı.", [{ code: "super_admin_reserved" }]);
    const result = await deps.store.request({ actorId: viewer!.id, sessionId: viewer!.sessionId,
      targetUserId: body.userId, role: body.role, reason: body.reason, requestId: request.id, now: deps.now() });
    if (result.kind === "rejected") throw new ApiError(result.reason === "forbidden" ? "FORBIDDEN" : "CONFLICT", "Onay talebi oluşturulamadı.");
    return { status: 201, body: { data: view(result.data) } };
  });

  route("admin.roleApprovals.approve", async ({ params, body, viewer, request, authorize }) => {
    const pending = await deps.store.target(params.id);
    if (!pending) throw new ApiError("CONFLICT", "Onay verilemedi.");
    const target = await deps.users.target(pending.targetUserId);
    if (!target) throw new ApiError("NOT_FOUND", "Hedef kullanıcı bulunamadı.");
    await authorize({ targetUserId: target.id, targetRoles: target.role ? [target.role] : [],
      newRole: pending.requestedRole, activeSuperAdminCount: superAdminCountForRoleRule(await deps.users.activeSuperAdminCount(), target) });
    // A pending request from an older release must not approve a forbidden promotion either.
    if (pending.requestedRole === "SUPER_ADMIN" && target.role !== "SUPER_ADMIN")
      throw new ApiError("FORBIDDEN", "Yeni SUPER_ADMIN ataması kapalı.", [{ code: "super_admin_reserved" }]);
    const result = await deps.store.approve({ actorId: viewer!.id, sessionId: viewer!.sessionId,
      approvalId: params.id, reason: body.reason, requestId: request.id, now: deps.now() });
    if (result.kind === "rejected") throw new ApiError(result.reason === "forbidden" ? "FORBIDDEN" : "CONFLICT", "Onay verilemedi.");
    return { status: 200, body: { data: view(result.data) } };
  });
}

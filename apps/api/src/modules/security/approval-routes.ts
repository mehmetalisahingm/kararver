import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import { superAdminCountForRoleRule, type AdminUserStore } from "../admin-users/store.ts";
import type { RoleApprovalStore } from "./approval-store.ts";

export function registerRoleApprovalRoutes(route: Route, deps: {
  store: RoleApprovalStore; users: AdminUserStore; now: () => Date;
}): void {
  const view = (r: { id: string; targetUserId: string; requestedRole: string; status: string; expiresAt: Date }) =>
    ({ id: r.id, userId: r.targetUserId, role: r.requestedRole, status: r.status, expiresAt: r.expiresAt.toISOString() });

  route("admin.roleApprovals.request", async ({ body, viewer, request, authorize }) => {
    const target = await deps.users.target(body.userId);
    if (!target) throw new ApiError("NOT_FOUND", "Hedef kullanıcı bulunamadı.");
    await authorize({ targetUserId: target.id, targetRoles: target.role ? [target.role] : [],
      newRole: body.role, activeSuperAdminCount: superAdminCountForRoleRule(await deps.users.activeSuperAdminCount(), target) });
    const result = await deps.store.request({ actorId: viewer!.id, sessionId: viewer!.sessionId,
      targetUserId: body.userId, role: body.role, reason: body.reason, requestId: request.id, now: deps.now() });
    if (result.kind === "rejected") throw new ApiError(result.reason === "forbidden" ? "FORBIDDEN" : "CONFLICT", "Onay talebi oluşturulamadı.");
    return { status: 201, body: { data: view(result.data) } };
  });

  route("admin.roleApprovals.approve", async ({ params, body, viewer, request, authorize }) => {
    const result = await deps.store.approve({ actorId: viewer!.id, sessionId: viewer!.sessionId,
      approvalId: params.id, reason: body.reason, requestId: request.id, now: deps.now() });
    if (result.kind === "rejected") throw new ApiError(result.reason === "forbidden" ? "FORBIDDEN" : "CONFLICT", "Onay verilemedi.");
    const target = await deps.users.target(result.data.targetUserId);
    if (!target) throw new ApiError("NOT_FOUND", "Hedef kullanıcı bulunamadı.");
    await authorize({ targetUserId: target.id, targetRoles: target.role ? [target.role] : [],
      newRole: result.data.requestedRole, activeSuperAdminCount: superAdminCountForRoleRule(await deps.users.activeSuperAdminCount(), target) });
    return { status: 200, body: { data: view(result.data) } };
  });
}

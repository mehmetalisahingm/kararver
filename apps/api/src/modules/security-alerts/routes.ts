// #185 güvenlik alarmı onayı (admin.securityAlerts.ack). Yetki SUPER_ADMIN (router kapısı, KV-04 security.alert.ack).
// Onay "incelendi" işaretidir: alarmı kapatmaz; ikinci onay 409 already_acknowledged ve audit yazmaz.
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { SecurityAlertRecord, SecurityAlertStore } from "./store.ts";

export type SecurityAlertRouteDeps = { store: SecurityAlertStore; now: () => Date };

/** Sözleşmedeki SecurityAlertView; ops paneli ile aynı biçim (avatar gösterilmez). */
export const securityAlertView = (a: SecurityAlertRecord) => ({
  id: a.id,
  rule: a.rule,
  severity: a.severity,
  status: a.status,
  actor: a.actor ? { ...a.actor, avatarUrl: null } : null,
  peakCount: a.peakCount,
  openedAt: a.openedAt.toISOString(),
  lastSeenAt: a.lastSeenAt.toISOString(),
  resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
  acknowledgedAt: a.acknowledgedAt ? a.acknowledgedAt.toISOString() : null,
  acknowledgedBy: a.acknowledgedBy ? { ...a.acknowledgedBy, avatarUrl: null } : null,
});

export function registerSecurityAlertRoutes(route: Route, deps: SecurityAlertRouteDeps): void {
  route("admin.securityAlerts.ack", async ({ params, body, viewer, request }) => {
    const result = await deps.store.acknowledge({ id: params.id, actorId: viewer!.id, reason: body.reason, requestId: request.id, at: deps.now() });
    if (result.kind === "not_found") throw new ApiError("NOT_FOUND", "Alarm bulunamadı.");
    if (result.kind === "already_acknowledged")
      throw new ApiError("CONFLICT", "Bu alarm zaten incelendi olarak işaretlenmiş.", [{ code: "already_acknowledged" }]);
    return { status: 200, body: { data: securityAlertView(result.alert) } };
  });
}

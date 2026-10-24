// Audit okuma — KV-39 (#41). Sözleşme: contracts/domains/admin.ts (admin.audit.list). Yetki ADMIN+ (router kapısı).
// Yazma/silme endpoint'i yoktur; kayıtlar append-only (trigger audit_logs_append_only). Sıra created_at ↓, id ↓.
// Cursor filtrelere bağlıdır: başka süzgeçle verilen cursor INVALID_CURSOR olur.
// before/after yanıtta redact.ts'ten geçer (#185): hassas adlı alanların değeri "[gizli]"; kayıt değişmez.
// admin.audit.export (#185): SUPER_ADMIN, taze step-up, ≤ 31 gün / ≤ AUDIT_EXPORT_MAX_ROWS; export'un kendisi audit'e yazılır.
import { AUDIT_EXPORT_MAX_ROWS, auditOutcomeOf } from "@kararver/contracts";
import { decodeCursor, encodeCursor, invalidCursor } from "../../http/cursor.ts";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import { buildAuditExportFile } from "./export.ts";
import { redactAuditSummary } from "./redact.ts";
import type { AuditQuery, AuditStore } from "./store.ts";

export type AuditRouteDeps = { store: AuditStore; mediaPublicBaseUrl: string; now?: () => Date };

const FILTER_KEYS = ["actorId", "targetType", "targetId", "action", "operation", "source", "requestId", "reasonContains", "outcome"] as const;

export function registerAuditRoutes(route: Route, deps: AuditRouteDeps): void {
  route("admin.audit.list", async ({ query }) => {
    const filters = {
      actorId: query.actorId as string | undefined,
      targetType: query.targetType as string | undefined,
      targetId: query.targetId as string | undefined,
      action: query.action as string | undefined,
      operation: query.operation as string | undefined,
      source: query.source as AuditQuery["source"],
      from: query.from ? new Date(query.from as string) : undefined,
      to: query.to ? new Date(query.to as string) : undefined,
      requestId: query.requestId as string | undefined,
      reasonContains: query.reasonContains as string | undefined,
      outcome: query.outcome as AuditQuery["outcome"],
    };
    const filter = `audit:${JSON.stringify([filters.actorId, filters.targetType, filters.targetId, filters.action, filters.operation, filters.source, query.from, query.to, filters.requestId, filters.reasonContains, filters.outcome])}`;
    const cursor = decodeCursor(query.cursor, filter);
    let after: AuditQuery["after"] = null;
    if (cursor) {
      const at = new Date(String(cursor.keys[0]));
      if (Number.isNaN(at.getTime())) throw invalidCursor();
      after = { createdAt: at, id: cursor.id };
    }
    const limit = query.limit as number;
    const rows = await deps.store.list({ ...filters, after }, limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit && last ? encodeCursor(filter, [last.createdAt.toISOString()], last.id) : null;
    const data = page.map((r) => ({
      id: r.id,
      actor: r.actor
        ? {
            id: r.actor.id,
            username: r.actor.username,
            displayName: r.actor.displayName,
            avatarUrl: r.actor.avatarPublicKey ? `${deps.mediaPublicBaseUrl}/${r.actor.avatarPublicKey}` : null,
          }
        : null,
      source: r.source,
      action: r.action,
      operation: r.operation,
      outcome: auditOutcomeOf(r.action, r.operation),
      target: r.target,
      before: redactAuditSummary(r.before),
      after: redactAuditSummary(r.after),
      reason: r.reason,
      requestId: r.requestId,
      createdAt: r.createdAt.toISOString(),
    }));
    return { status: 200, body: { data, page: { nextCursor, hasMore: nextCursor !== null } } };
  });

  route("admin.audit.export", async ({ body, viewer, request }) => {
    const at = (deps.now ?? (() => new Date()))();
    const filters = Object.fromEntries(FILTER_KEYS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
    const result = await deps.store.exportWithAudit({
      query: { ...filters, from: new Date(body.from), to: new Date(body.to) },
      maxRows: AUDIT_EXPORT_MAX_ROWS,
      actorId: viewer!.id,
      sessionId: viewer!.sessionId,
      requestId: request.id,
      reason: body.reason,
      at,
      summary: { format: body.format, from: body.from, to: body.to, filters },
    });
    if (result.kind === "stepup_required") throw new ApiError("FORBIDDEN", "Önce doğrulayıcı kodunla kimliğini doğrula.", [{ code: "stepup_required" }]);
    if (result.kind === "too_many")
      throw new ApiError("VALIDATION_ERROR", `Bu aralıkta ${AUDIT_EXPORT_MAX_ROWS}'den fazla kayıt var; aralığı daralt.`, [{ code: "too_many_rows" }]);
    return { status: 200, body: { data: buildAuditExportFile(result.rows, body.format, { from: body.from, to: body.to, filters }, at) } };
  });
}

// Audit okuma — KV-39 (#41). Sözleşme: contracts/domains/admin.ts (admin.audit.list). Yetki ADMIN+ (router kapısı).
// Yazma/silme endpoint'i yoktur; kayıtlar append-only (trigger audit_logs_append_only). Sıra created_at ↓, id ↓.
// Cursor filtrelere bağlıdır: başka süzgeçle verilen cursor INVALID_CURSOR olur.
import { decodeCursor, encodeCursor, invalidCursor } from "../../http/cursor.ts";
import type { Route } from "../../http/route.ts";
import type { AuditQuery, AuditStore } from "./store.ts";

export type AuditRouteDeps = { store: AuditStore; mediaPublicBaseUrl: string };

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
    };
    const filter = `audit:${JSON.stringify([filters.actorId, filters.targetType, filters.targetId, filters.action, filters.operation, filters.source, query.from, query.to])}`;
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
      target: r.target,
      before: r.before,
      after: r.after,
      reason: r.reason,
      requestId: r.requestId,
      createdAt: r.createdAt.toISOString(),
    }));
    return { status: 200, body: { data, page: { nextCursor, hasMore: nextCursor !== null } } };
  });
}

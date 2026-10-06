// Yönetici kullanıcı ve yaptırım endpoint'leri — KV-33 (#35). Sözleşme: contracts/domains/admin.ts (admin.users.*,
// admin.sanctions.*). Rol ataması (admin.roles.put) rbac/roles-routes.ts'tedir. Kurallar: docs/KV-33_ADMIN_USERS.md.
//
// Yetki KV-04: user.read (ADMIN+), user.sanction / user.sanction.lift (sanctionTarget: admin hedef SUPER_ADMIN ister,
// kendine yaptırım yok). Handler hedefin rolünü DB'den okuyup ctx.authorize çağırır; store aynı kararı transaction
// içinde kilitlerden sonra taze veriyle yeniden verir (eşzamanlı rol/yaptırım değişikliği).
//
// sanction.applied / sanction.lifted olayları store'da, mutation ile aynı transaction'da outbox'a yazılır (KV-21 PR-2).
// Süresi dolan SUSPEND'in users.status senkronu worker'dadır (KV-33 PR-C, sanctions.expire).
// Kapsam dışı: itiraz endpoint'i (KV-04 §5/1, ertelendi).
import type { SanctionType } from "@kararver/db";
import { decodeCursor, encodeCursor } from "../../http/cursor.ts";
import { ApiError } from "../../http/errors.ts";
import { idempotencyKeyReused, readIdempotencyScope } from "../../http/idempotency.ts";
import type { Route, RouteContext } from "../../http/route.ts";
import type { AdminUserStore, ApplyRejection, LiftRejection, TargetInfo, TimeCursor } from "./store.ts";
import { toActivity, toAdminUserDetail, toAdminUserSummary, toReport, toSanction } from "./view.ts";

export type AdminUserDeps = { store: AdminUserStore; now: () => Date; mediaPublicBaseUrl: string };

const userNotFound = () => new ApiError("NOT_FOUND", "Kullanıcı bulunamadı.");
const conflict = (message: string, code: string) => new ApiError("CONFLICT", message, [{ code }]);

export const SANCTION_REJECTIONS: Record<Exclude<ApplyRejection | LiftRejection, "not_found" | "forbidden" | "report_not_found">, () => ApiError> = {
  report_mismatch: () => conflict("Rapor bu kullanıcının içeriğine ait değil.", "report_mismatch"),
  already_active: () => conflict("Bu kullanıcıda aynı tipte aktif bir yaptırım var.", "already_active"),
  user_deleted: () => conflict("Silinmiş hesaba yeni yaptırım uygulanamaz.", "user_deleted"),
  last_super_admin: () => conflict("Son aktif SUPER_ADMIN askıya alınamaz veya yasaklanamaz.", "last_super_admin"),
  already_lifted: () => conflict("Yaptırım zaten kaldırılmış.", "already_lifted"),
  expired: () => conflict("Yaptırımın süresi dolmuş; kaldırılacak bir şey yok.", "expired"),
};

export function sanctionRejection(reason: ApplyRejection | LiftRejection): ApiError {
  if (reason === "not_found") return new ApiError("NOT_FOUND", "Kullanıcı veya yaptırım bulunamadı.");
  if (reason === "forbidden") return new ApiError("FORBIDDEN", "Bu işlem için yetkiniz yok.");
  if (reason === "report_not_found") return new ApiError("NOT_FOUND", "Rapor bulunamadı.");
  return SANCTION_REJECTIONS[reason]();
}

/** Hedefi DB'den okur ve KV-04 kararını verir (rol istekten alınmaz, KV-04 §4.2). */
export async function authorizeTarget(store: AdminUserStore, ctx: RouteContext, userId: string): Promise<TargetInfo> {
  const target = await store.target(userId);
  if (!target) throw userNotFound();
  await ctx.authorize({ targetUserId: target.id, targetRoles: target.role ? [target.role] : [] });
  return target;
}

function timeCursor(cursor: string | undefined, list: string): TimeCursor {
  const at = decodeCursor(cursor, list);
  return at ? { createdAt: new Date(at.keys[0] as string), id: at.id } : null;
}

function timePage<T extends { id: string; createdAt: Date }, V>(list: string, rows: T[], limit: number, view: (row: T) => V) {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = rows.length > limit && last ? encodeCursor(list, [last.createdAt.toISOString()], last.id) : null;
  return { data: page.map(view), page: { nextCursor, hasMore: nextCursor !== null } };
}

export function registerAdminUserRoutes(route: Route, deps: AdminUserDeps): void {
  const { store, now, mediaPublicBaseUrl: base } = deps;

  route("admin.users.list", async ({ query }) => {
    // Cursor arama ve durum filtresine bağlıdır; filtre değişince eski cursor 400 INVALID_CURSOR.
    const list = `admin.users.list:${query.status ?? "*"}:${query.q ?? ""}`;
    const at = decodeCursor(query.cursor, list);
    const rows = await store.list({ q: query.q, status: query.status, afterId: at?.id ?? null }, query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor = rows.length > query.limit && last ? encodeCursor(list, [], last.id) : null;
    return { status: 200, body: { data: page.map((u) => toAdminUserSummary(u, base)), page: { nextCursor, hasMore: nextCursor !== null } } };
  });

  route("admin.users.get", async ({ params }) => {
    const user = await store.get(params.id, now());
    if (!user) throw userNotFound();
    return { status: 200, body: { data: toAdminUserDetail(user, base) } };
  });

  route("admin.users.sanctions", async ({ params, query }) => {
    if (!(await store.target(params.id))) throw userNotFound();
    const list = `admin.users.sanctions:${params.id}`;
    const rows = await store.listSanctions(params.id, timeCursor(query.cursor, list), query.limit + 1);
    return { status: 200, body: timePage(list, rows, query.limit, (s) => toSanction(s, base)) };
  });

  route("admin.users.reports", async ({ params, query }) => {
    if (!(await store.target(params.id))) throw userNotFound();
    const list = `admin.users.reports:${params.id}:${query.side}`;
    const rows = await store.listReports(params.id, query.side, timeCursor(query.cursor, list), query.limit + 1);
    return { status: 200, body: timePage(list, rows, query.limit, toReport) };
  });

  route("admin.users.activity", async ({ params, query }) => {
    if (!(await store.target(params.id))) throw userNotFound();
    const list = `admin.users.activity:${params.id}`;
    const rows = await store.listActivity(params.id, timeCursor(query.cursor, list), query.limit + 1);
    return { status: 200, body: timePage(list, rows, query.limit, toActivity) };
  });

  route("admin.sanctions.create", async (ctx) => {
    const { params, body, viewer, request } = ctx;
    await authorizeTarget(store, ctx, params.id);
    const at = now();
    const endsAt = body.endsAt === null ? null : new Date(body.endsAt);
    if (endsAt && endsAt <= at) {
      throw new ApiError("VALIDATION_ERROR", "Bitiş zamanı gelecekte olmalı.", [{ field: "endsAt", code: "past" }]);
    }
    // Anahtar hedef kullanıcıya bağlı: aynı anahtar başka kullanıcıya gelen istekte geçmiş sonucu döndürmez.
    const scope = readIdempotencyScope(request, { userId: viewer!.id, route: `admin.sanctions.create:${params.id}`, body, now: at, required: false });
    const result = await store.applySanction(scope, {
      userId: params.id,
      type: body.type as SanctionType,
      reason: body.reason,
      endsAt,
      reportId: body.reportId,
      actorId: viewer!.id,
      requestId: request.id,
      now: at,
    });
    if (result.kind === "key_reused") throw idempotencyKeyReused();
    if (result.kind === "rejected") throw sanctionRejection(result.reason);
    const sanction = await store.findSanction(params.id, result.resourceId);
    if (!sanction) throw new Error(`admin.sanctions.create: yazılan yaptırım okunamadı (${result.resourceId})`);
    return { status: 201, body: { data: toSanction(sanction, base) } };
  });

  route("admin.sanctions.lift", async (ctx) => {
    const { params, body, viewer, request } = ctx;
    await authorizeTarget(store, ctx, params.id);
    const result = await store.liftSanction({
      userId: params.id,
      sanctionId: params.sanctionId,
      reason: body.reason,
      actorId: viewer!.id,
      requestId: request.id,
      now: now(),
    });
    if (result.kind === "rejected") throw sanctionRejection(result.reason);
    const sanction = await store.findSanction(params.id, params.sanctionId);
    return { status: 200, body: { data: toSanction(sanction!, base) } };
  });
}

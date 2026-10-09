// Admin kategori yönetimi — KV-26 (#28), KV-41 (#43). Sözleşme: packages/contracts/src/domains/admin.ts (admin.categories.*)
// Yetki: category.manage (ADMIN+, KV-04), router'ın kapısında verilir; kaynağa bağlı kural yoktur.
// Silme yok: kategori pasife alınır (isActive=false). Create/update audit kaydı mutasyonla aynı transaction'da yazılır.
import { ApiError } from "../../http/errors.ts";
import { decodeCursor, encodeCursor } from "../../http/cursor.ts";
import { idempotencyKeyReused, readIdempotencyScope } from "../../http/idempotency.ts";
import type { Route } from "../../http/route.ts";
import type { AdminCategoryRow, CategoryAdminStore, CategoryInput } from "./store.ts";

export type CategoryAdminDeps = { store: CategoryAdminStore; now: () => Date };

const INT4_MAX = 2_147_483_647;

const toAdminCategory = (c: AdminCategoryRow) => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  description: c.description,
  iconKey: c.iconKey,
  sortOrder: c.sortOrder,
  isActive: c.isActive,
  pollCount: c.pollCount,
});

function slugTaken(): ApiError {
  return new ApiError("CONFLICT", "Bu slug başka bir kategoride kullanılıyor.", [{ field: "slug", code: "taken" }]);
}

/** Sözleşme sortOrder'ı yalnız tam sayı ister; sütun int4 olduğundan taşan değer 500 yerine 400 olur. */
function input(body: Record<string, unknown>): Partial<CategoryInput> {
  const { reason: _reason, ...fields } = body;
  const sortOrder = fields.sortOrder as number | undefined;
  if (sortOrder !== undefined && Math.abs(sortOrder) > INT4_MAX) {
    throw new ApiError("VALIDATION_ERROR", "sortOrder aralık dışında.", [{ field: "sortOrder", code: "too_big" }]);
  }
  return fields as Partial<CategoryInput>;
}

export function registerCategoryAdminRoutes(route: Route, deps: CategoryAdminDeps): void {
  const { store, now } = deps;

  async function load(id: string) {
    const row = await store.get(id);
    if (!row) throw new ApiError("NOT_FOUND", "Kategori bulunamadı.");
    return toAdminCategory(row);
  }

  route("admin.categories.list", async ({ query }) => {
    const filter = "admin.categories";
    const after = decodeCursor(query.cursor, filter);
    const rows = await store.list({ after, limit: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > query.limit && last ? encodeCursor(filter, [last.sortOrder], last.id) : null;
    return { status: 200, body: { data: page.map(toAdminCategory), page: { nextCursor, hasMore: nextCursor !== null } } };
  });

  route("admin.categories.create", async ({ body, viewer, request }) => {
    const at = now();
    const scope = readIdempotencyScope(request, { userId: viewer!.id, route: "admin.categories.create", body, now: at, required: false });
    const result = await store.create(scope, input(body) as CategoryInput, {
      actorId: viewer!.id,
      requestId: request.id,
      now: at,
      reason: body.reason,
    });
    if (result.kind === "key_reused") throw idempotencyKeyReused();
    if (result.kind === "rejected") throw slugTaken();
    return { status: 201, body: { data: await load(result.resourceId) } };
  });

  route("admin.categories.update", async ({ params, body, viewer, request }) => {
    const outcome = await store.update(params.id, input(body), {
      actorId: viewer!.id,
      requestId: request.id,
      now: now(),
      reason: body.reason,
    });
    if (outcome === "NOT_FOUND") throw new ApiError("NOT_FOUND", "Kategori bulunamadı.");
    if (outcome === "SLUG_TAKEN") throw slugTaken();
    return { status: 200, body: { data: await load(params.id) } };
  });
}
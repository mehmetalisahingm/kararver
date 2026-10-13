// Toplu içerik işi endpoint'leri — #181. Sözleşme: contracts/domains/admin.ts (admin.users.contentJobs.*). Kurallar,
// sınırlar ve geri alma: docs/KV-33_ADMIN_USERS.md §9. İş çalıştırıcıda işlenir (runner.ts); burada önizleme, ayrı onay,
// listeleme, geri alma ve durdurma vardır.
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { AdminUserStore } from "../admin-users/store.ts";
import { authorizeTarget } from "../admin-users/routes.ts";
import { scopeOf, type ContentJobStore, type CreateRejection, type JobRow, type UndoRejection } from "./store.ts";

export type ContentJobDeps = { store: ContentJobStore; users: AdminUserStore; now: () => Date };

/** Tek işte işlenebilecek en çok içerik; önizleme geçerlilik süresi. */
export const MAX_ITEMS = 500;
export const PREVIEW_TTL_MS = 15 * 60 * 1000;
const LIST_LIMIT = 20;

const conflict = (message: string, code: string) => new ApiError("CONFLICT", message, [{ code }]);

const CREATE_CONFLICTS: Record<Exclude<CreateRejection, "not_found" | "forbidden">, () => ApiError> = {
  user_deleted: () => conflict("Silinmiş (anonimleştirilmiş) hesaba toplu içerik işlemi uygulanamaz.", "user_deleted"),
  preview_expired: () => conflict("Önizleme eskidi. Önizlemeyi yenile.", "preview_expired"),
  preview_stale: () => conflict("Önizlemeden sonra içerik değişti; sayılar farklı. Önizlemeyi yenile.", "preview_stale"),
  nothing_to_do: () => conflict("Bu işleme uygun içerik yok.", "nothing_to_do"),
  too_many: () => conflict(`Tek işte en çok ${MAX_ITEMS} içerik işlenir; kapsamı daralt (yalnız anketler veya yalnız yorumlar).`, "too_many"),
  job_open: () => conflict("Bu hesapta devam eden bir toplu işlem var; bitmesini veya durdurulmasını bekle.", "job_open"),
};
const UNDO_CONFLICTS: Record<Exclude<UndoRejection, "not_found" | "forbidden">, () => ApiError> = {
  user_deleted: CREATE_CONFLICTS.user_deleted,
  job_open: CREATE_CONFLICTS.job_open,
  not_undoable: () => conflict("Bu iş geri alınamaz: bitmemiş, geri yüklenecek içeriği yok veya zaten geri alınmış.", "not_undoable"),
};

export const contentJobView = (row: JobRow) => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  scope: scopeOf(row),
  reason: row.reason,
  expected: { polls: row.expectedPolls, comments: row.expectedComments },
  applied: row.applied,
  unchanged: row.unchanged,
  failed: row.failed,
  skipped: row.skipped,
  failure: row.failure,
  undoOfId: row.undoOfId,
  canUndo: row.canUndo,
  createdAt: row.createdAt.toISOString(),
  startedAt: row.startedAt?.toISOString() ?? null,
  finishedAt: row.finishedAt?.toISOString() ?? null,
});

export function registerContentJobRoutes(route: Route, deps: ContentJobDeps): void {
  const { store, users, now } = deps;
  const userNotFound = () => new ApiError("NOT_FOUND", "Kullanıcı bulunamadı.");

  route("admin.users.contentJobs.preview", async (ctx) => {
    // İstek öncesi karar (hedef rolü DB'den); store işlemleri kilitlerden sonra aynı kararı yeniden verir.
    await authorizeTarget(users, ctx, ctx.params.id);
    const at = now();
    const affected = await store.preview(ctx.params.id, ctx.query.action, ctx.query.scope, at);
    if (!affected) throw userNotFound();
    return {
      status: 200,
      body: { data: { action: ctx.query.action, scope: ctx.query.scope, affected, total: affected.polls + affected.comments, cutoffAt: at.toISOString(), maxItems: MAX_ITEMS } },
    };
  });

  route("admin.users.contentJobs.create", async (ctx) => {
    const { params, body, viewer, request } = ctx;
    await authorizeTarget(users, ctx, params.id);
    const result = await store.create({
      userId: params.id,
      action: body.action,
      scope: body.scope,
      cutoffAt: new Date(body.cutoffAt),
      expected: body.expected,
      reason: body.reason,
      maxItems: MAX_ITEMS,
      previewTtlMs: PREVIEW_TTL_MS,
      actorId: viewer!.id,
      requestId: request.id,
      now: now(),
    });
    if (result.kind === "rejected") {
      if (result.reason === "not_found") throw userNotFound();
      if (result.reason === "forbidden") throw new ApiError("FORBIDDEN", "Bu işlem için yetkiniz yok.");
      throw CREATE_CONFLICTS[result.reason]();
    }
    return { status: 202, body: { data: contentJobView(result.job) } };
  });

  route("admin.users.contentJobs.list", async (ctx) => {
    await authorizeTarget(users, ctx, ctx.params.id);
    const rows = await store.list(ctx.params.id, LIST_LIMIT);
    return { status: 200, body: { data: rows.map(contentJobView) } };
  });

  route("admin.users.contentJobs.undo", async (ctx) => {
    const { params, body, viewer, request } = ctx;
    await authorizeTarget(users, ctx, params.id);
    const result = await store.undo({ userId: params.id, jobId: params.jobId, reason: body.reason, actorId: viewer!.id, requestId: request.id, now: now() });
    if (result.kind === "rejected") {
      if (result.reason === "not_found") throw new ApiError("NOT_FOUND", "İş bulunamadı.");
      if (result.reason === "forbidden") throw new ApiError("FORBIDDEN", "Bu işlem için yetkiniz yok.");
      throw UNDO_CONFLICTS[result.reason]();
    }
    return { status: 202, body: { data: contentJobView(result.job) } };
  });

  route("admin.users.contentJobs.cancel", async (ctx) => {
    const { params, body, viewer, request } = ctx;
    await authorizeTarget(users, ctx, params.id);
    const result = await store.cancel({ userId: params.id, jobId: params.jobId, reason: body.reason, actorId: viewer!.id, requestId: request.id, now: now() });
    if (result.kind === "rejected") {
      if (result.reason === "not_found") throw new ApiError("NOT_FOUND", "İş bulunamadı.");
      if (result.reason === "forbidden") throw new ApiError("FORBIDDEN", "Bu işlem için yetkiniz yok.");
      throw conflict("İş zaten bitmiş; durdurulacak bir şey yok.", "not_cancellable");
    }
    return { status: 200, body: { data: contentJobView(result.job) } };
  });
}

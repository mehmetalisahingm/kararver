// Toplu moderasyon endpoint'leri — #183. Sözleşme: contracts/domains/moderation.ts (admin.moderation.{polls,comments}.bulk[Preview],
// admin.moderation.batches.list). Kurallar ve sınırlar: docs/KV-37_BULK_MODERATION.md.
//
// Güvenlik özeti: yetki yalnız backend RBAC'tadır ve KAYIT BAŞINADIR (her kaydın topluluğu DB'den okunur, `ctx.authorize` ile
// aynı kural); kapsam dışı kayıt dokunulmadan "forbidden" olur ve içeriği (etiket) önizlemede bile görünmez. Onay, önizlenen
// durumun özetine (digest) bağlıdır. Kararlar mevcut tekil moderasyon yolundan geçer; kayıtlar kimlik sırasıyla ve ayrı
// transaction'larda işlenir (kısmi başarısızlık raporlanır, biri diğerini etkilemez, kilit sırası deterministik).
import { BULK_APPROVAL_PENDING_MAX, BULK_APPROVAL_THRESHOLD, BULK_APPROVAL_TTL_MINUTES, BULK_APPROVAL_WINDOW_MINUTES, BULK_MAX_ITEMS } from "@kararver/contracts";
import { decodeCursor, encodeCursor } from "../../http/cursor.ts";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import { toPublicUser } from "../admin-users/view.ts";
import type { RbacStore } from "../rbac/store.ts";
import { rateLimitError } from "../rate-limit/limiter.ts";
import { BATCH_HOURLY_LIMIT, batchDigest, type BulkModerationStore } from "./bulk.ts";
import { approvalView, registerBulkApprovalRoutes } from "./bulk-approval-routes.ts";
import type { BulkApprovalStore } from "./bulk-approval.ts";
import { createPlanner, executeBatch, type Plan } from "./bulk-core.ts";
import { registerUndoRoutes } from "./undo-routes.ts";
import type { ContentKind, ModerationStore } from "./store.ts";

export type BulkModerationDeps = {
  store: ModerationStore;
  batches: BulkModerationStore;
  /** İkinci onay talepleri (KV-37 §8). */
  approvals: BulkApprovalStore;
  /** Onay anında başlatanın yetkisini yeniden kurmak için. */
  rbac: RbacStore;
  now: () => Date;
  mediaPublicBaseUrl: string;
};

export { BATCH_HOURLY_LIMIT };
const HOUR_MS = 60 * 60 * 1000;

/** Pencere toplamı (onaysız uygulanan) + bu işlemin değişecek kayıt sayısı eşiğe ulaşıyorsa ikinci onay gerekir. */
export const approvalRequired = (willChange: number, windowApplied: number): boolean => willChange > 0 && windowApplied + willChange >= BULK_APPROVAL_THRESHOLD;

export function registerBulkModerationRoutes(route: Route, deps: BulkModerationDeps): void {
  registerUndoRoutes(route, deps);
  registerBulkApprovalRoutes(route, deps);
  const { store, batches, approvals, now } = deps;
  const plan = createPlanner(batches);
  const base = deps.mediaPublicBaseUrl;

  const registerKind = (kind: ContentKind) => {
    route(`admin.moderation.${kind}.bulkPreview`, async (ctx) => {
      const { query } = ctx;
      const ids = query.ids.split(",");
      const { plans, states } = await plan(ctx, kind, query.action, ids);
      const count = (o: Plan["outcome"]) => plans.filter((p) => p.outcome === o).length;
      const windowApplied = await batches.unapprovedAppliedSince(ctx.viewer!.id, new Date(now().getTime() - BULK_APPROVAL_WINDOW_MINUTES * 60_000));
      return {
        status: 200,
        body: {
          data: {
            kind,
            action: query.action,
            maxItems: BULK_MAX_ITEMS,
            digest: batchDigest(kind, query.action, ids, states),
            summary: { willChange: count("WILL_CHANGE"), noChange: count("NO_CHANGE"), blocked: count("BLOCKED") },
            approval: { required: approvalRequired(count("WILL_CHANGE"), windowApplied), threshold: BULK_APPROVAL_THRESHOLD, windowMinutes: BULK_APPROVAL_WINDOW_MINUTES, windowApplied },
            items: plans.map((p) => ({
              id: p.id,
              label: p.label,
              status: p.state?.status ?? null,
              communityId: p.state?.communityId ?? null,
              outcome: p.outcome,
              blocked: p.blocked,
            })),
          },
        },
      };
    });

    route(`admin.moderation.${kind}.bulk`, async (ctx) => {
      const { body, viewer, request } = ctx;
      const at = now();
      const { plans, states } = await plan(ctx, kind, body.action, body.ids);
      if (batchDigest(kind, body.action, body.ids, states) !== body.digest) {
        throw new ApiError("CONFLICT", "Seçilen kayıtlar önizlemeden sonra değişti; önizlemeyi yenile.", [{ code: "preview_stale" }]);
      }
      if ((await batches.recentBatchCount(viewer!.id, new Date(at.getTime() - HOUR_MS))) >= BATCH_HOURLY_LIMIT) throw rateLimitError(HOUR_MS / 1000 / 4);

      // İkinci onay: pencere toplamı eşiğe ulaşıyorsa hiçbir şey uygulanmaz, bekleyen bir talep açılır (KV-37 §8).
      const willChange = plans.filter((p) => p.outcome === "WILL_CHANGE").length;
      const windowApplied = await batches.unapprovedAppliedSince(viewer!.id, new Date(at.getTime() - BULK_APPROVAL_WINDOW_MINUTES * 60_000));
      if (approvalRequired(willChange, windowApplied)) {
        const created = await approvals.create({
          initiatorId: viewer!.id,
          kind,
          action: body.action,
          reason: body.reason,
          digest: body.digest,
          ids: [...body.ids].sort(),
          willChange,
          requestId: request.id,
          now: at,
          expiresAt: new Date(at.getTime() + BULK_APPROVAL_TTL_MINUTES * 60_000),
        });
        if (created.kind === "too_many") {
          throw new ApiError("CONFLICT", `En çok ${BULK_APPROVAL_PENDING_MAX} bekleyen onay talebin olabilir; önce bekleyenleri sonuçlandır veya geri çek.`, [{ code: "too_many_pending" }]);
        }
        return { status: 202, body: { data: approvalView(created.approval, at, base) } };
      }

      const admin = (await ctx.moderationScope()).all;
      const batchId = await batches.startBatch({ actorId: viewer!.id, kind, action: body.action, reason: body.reason, digest: body.digest, requestId: request.id, total: body.ids.length, now: at });
      const { counts, items } = await executeBatch(deps, { batchId, kind, action: body.action, reason: body.reason, plans, actorId: viewer!.id, actorIsAdmin: admin, requestId: request.id, at });
      return { status: 200, body: { data: { batchId, summary: { total: body.ids.length, ...counts }, items } } };
    });
  };
  registerKind("polls");
  registerKind("comments");

  route("admin.moderation.batches.list", async ({ query, viewer, moderationScope }) => {
    const key = "admin.moderation.batches.list";
    const cursor = decodeCursor(query.cursor, key);
    const scope = await moderationScope();
    const rows = await batches.listBatches({ ...(scope.all ? {} : { actorId: viewer!.id }), after: cursor ? { at: new Date(cursor.keys[0] as string), id: cursor.id } : null }, query.limit);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor = rows.length > query.limit && last ? encodeCursor(key, [last.createdAt.toISOString()], last.id) : null;
    return {
      status: 200,
      body: {
        data: page.map((b) => ({
          id: b.id,
          kind: b.kind,
          action: b.action,
          reason: b.reason,
          actor: toPublicUser(b.actor, base),
          total: b.total,
          applied: b.applied,
          unchanged: b.unchanged,
          failed: b.failed,
          createdAt: b.createdAt.toISOString(),
          finishedAt: b.finishedAt?.toISOString() ?? null,
          undoOfId: b.undoOfId,
          undone: b.undone,
          undoable: b.undoable,
        })),
        page: { nextCursor, hasMore: nextCursor !== null },
      },
    };
  });
}

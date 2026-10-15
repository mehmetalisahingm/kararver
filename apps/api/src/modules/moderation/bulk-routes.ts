// Toplu moderasyon endpoint'leri — #183. Sözleşme: contracts/domains/moderation.ts (admin.moderation.{polls,comments}.bulk[Preview],
// admin.moderation.batches.list). Kurallar ve sınırlar: docs/KV-37_BULK_MODERATION.md.
//
// Güvenlik özeti: yetki yalnız backend RBAC'tadır ve KAYIT BAŞINADIR (her kaydın topluluğu DB'den okunur, `ctx.authorize` ile
// aynı kural); kapsam dışı kayıt dokunulmadan "forbidden" olur ve içeriği (etiket) önizlemede bile görünmez. Onay, önizlenen
// durumun özetine (digest) bağlıdır. Kararlar mevcut tekil moderasyon yolundan geçer; kayıtlar kimlik sırasıyla ve ayrı
// transaction'larda işlenir (kısmi başarısızlık raporlanır, biri diğerini etkilemez, kilit sırası deterministik).
import { BULK_MAX_ITEMS } from "@kararver/contracts";
import { decodeCursor, encodeCursor } from "../../http/cursor.ts";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import { toPublicUser } from "../admin-users/view.ts";
import { rateLimitError } from "../rate-limit/limiter.ts";
import { batchDigest, type BatchItemRecord, type BulkAction, type BulkItemState, type BulkModerationStore } from "./bulk.ts";
import { statusTransition, type ContentKind, type ModerationStore } from "./store.ts";

export type BulkModerationDeps = {
  store: ModerationStore;
  batches: BulkModerationStore;
  now: () => Date;
  mediaPublicBaseUrl: string;
};

/** Aktör başına saatlik parti sınırı. */
export const BATCH_HOURLY_LIMIT = 20;
const HOUR_MS = 60 * 60 * 1000;

type Blocked = "not_found" | "forbidden" | "invalid_transition" | "admin_required";
type Plan = {
  id: string;
  state: BulkItemState | null;
  /** Yetkili kayıt için etiket; aksi null. */
  label: string | null;
  outcome: "WILL_CHANGE" | "NO_CHANGE" | "BLOCKED";
  blocked: Blocked | null;
};

export function registerBulkModerationRoutes(route: Route, deps: BulkModerationDeps): void {
  const { store, batches, now } = deps;
  const base = deps.mediaPublicBaseUrl;

  /**
   * Kayıt başına karar: bulunamadı → kapsam (ctx.authorize, RBAC kuralının kendisi) → geçiş tablosu → ADMIN şartı.
   * Hiçbir kayıt bulunamazsa 404 (yetkisiz kaynak ipucu vermez, hata zaten kimlik varlığını söylemez).
   */
  async function plan(
    ctx: { authorize(resource: { communityId: string | null }): Promise<void>; moderationScope(): Promise<{ all: boolean }> },
    kind: ContentKind,
    action: BulkAction,
    ids: string[],
  ): Promise<{ plans: Plan[]; states: Map<string, BulkItemState> }> {
    const states = await batches.inspect(kind, ids);
    if (states.size === 0) throw new ApiError("NOT_FOUND", "Seçilen kayıtların hiçbiri bulunamadı.");
    const admin = (await ctx.moderationScope()).all;
    const plans: Plan[] = [];
    for (const id of [...ids].sort()) {
      const state = states.get(id) ?? null;
      if (!state) {
        plans.push({ id, state: null, label: null, outcome: "BLOCKED", blocked: "not_found" });
        continue;
      }
      try {
        await ctx.authorize({ communityId: state.communityId });
      } catch (err) {
        if (err instanceof ApiError && err.code === "FORBIDDEN") {
          plans.push({ id, state, label: null, outcome: "BLOCKED", blocked: "forbidden" });
          continue;
        }
        throw err;
      }
      const next = statusTransition(state.status, action);
      if (next === "invalid") plans.push({ id, state, label: state.label, outcome: "BLOCKED", blocked: "invalid_transition" });
      else if (next === "same") plans.push({ id, state, label: state.label, outcome: "NO_CHANGE", blocked: null });
      else if (state.status === "REMOVED" && !admin) plans.push({ id, state, label: state.label, outcome: "BLOCKED", blocked: "admin_required" });
      else plans.push({ id, state, label: state.label, outcome: "WILL_CHANGE", blocked: null });
    }
    return { plans, states };
  }

  const registerKind = (kind: ContentKind) => {
    route(`admin.moderation.${kind}.bulkPreview`, async (ctx) => {
      const { query } = ctx;
      const ids = query.ids.split(",");
      const { plans, states } = await plan(ctx, kind, query.action, ids);
      const count = (o: Plan["outcome"]) => plans.filter((p) => p.outcome === o).length;
      return {
        status: 200,
        body: {
          data: {
            kind,
            action: query.action,
            maxItems: BULK_MAX_ITEMS,
            digest: batchDigest(kind, query.action, ids, states),
            summary: { willChange: count("WILL_CHANGE"), noChange: count("NO_CHANGE"), blocked: count("BLOCKED") },
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

      const admin = (await ctx.moderationScope()).all;
      const batchId = await batches.startBatch({ actorId: viewer!.id, kind, action: body.action, reason: body.reason, digest: body.digest, requestId: request.id, total: body.ids.length, now: at });
      const counts = { applied: 0, unchanged: 0, failed: 0 };
      const items: Array<{ id: string; result: "APPLIED" | "UNCHANGED" | "FAILED"; code: string | null; fromStatus: string | null; toStatus: string | null }> = [];

      for (const p of plans) {
        let record: BatchItemRecord;
        if (p.blocked === "not_found" || p.blocked === "forbidden" || p.blocked === "invalid_transition" || p.blocked === "admin_required") {
          counts.failed += 1;
          record = { targetId: p.id, communityId: p.state?.communityId ?? null, result: "FAILED", detail: p.blocked, fromStatus: p.state?.status ?? null, toStatus: null, moderationActionId: null };
        } else {
          // Karar anında kilitli yeniden okuma tekil yoldadır: önizleme ile bu an arasında değişen kayıt burada ayıklanır.
          const result = await store.apply({
            kind,
            id: p.id,
            actorId: viewer!.id,
            action: body.action,
            reason: body.reason,
            now: at,
            requestId: request.id,
            actorIsAdmin: admin,
            communityId: p.state!.communityId,
          });
          if (result.kind === "applied") {
            counts.applied += 1;
            record = { targetId: p.id, communityId: p.state!.communityId, result: "APPLIED", detail: null, fromStatus: result.trail.from, toStatus: result.trail.to, moderationActionId: result.trail.actionId };
          } else if (result.kind === "unchanged") {
            counts.unchanged += 1;
            record = { targetId: p.id, communityId: p.state!.communityId, result: "UNCHANGED", detail: null, fromStatus: result.outcome.status, toStatus: result.outcome.status, moderationActionId: null };
          } else {
            counts.failed += 1;
            const detail = result.kind === "conflict" ? result.reason : result.kind === "forbidden" ? "admin_required" : "not_found";
            record = { targetId: p.id, communityId: p.state!.communityId, result: "FAILED", detail, fromStatus: p.state!.status, toStatus: null, moderationActionId: null };
          }
        }
        await batches.recordItem(batchId, record, at);
        items.push({ id: record.targetId, result: record.result, code: record.detail, fromStatus: record.fromStatus, toStatus: record.toStatus });
      }
      await batches.finishBatch(batchId, counts, now());
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
        })),
        page: { nextCursor, hasMore: nextCursor !== null },
      },
    };
  });
}

// Toplu moderasyonun ortak çekirdeği — #183. Hem doğrudan uygulama (bulk-routes) hem de ikinci onaydan sonra uygulama
// (bulk-approval-routes) AYNI planlayıcıyı ve AYNI uygulayıcıyı kullanır: ikinci onay yeni bir yazma yolu açmaz.
//
// Planlama kayıt başına yetkiyi `ctx.authorize` (RBAC kuralının kendisi) ile verir; kapsam dışı kayıt dokunulmadan "forbidden" olur
// ve içeriği (etiket) önizlemede bile görünmez. Uygulama her kaydı mevcut tekil moderasyon yolundan (ModerationStore.apply) geçirir.
import { ApiError } from "../../http/errors.ts";
import type { BatchItemRecord, BulkAction, BulkItemState, BulkModerationStore } from "./bulk.ts";
import { statusTransition, type ContentKind, type ModerationStore } from "./store.ts";

export type Blocked = "not_found" | "forbidden" | "invalid_transition" | "admin_required";
export type Plan = {
  id: string;
  state: BulkItemState | null;
  /** Yetkili kayıt için etiket; aksi null. */
  label: string | null;
  outcome: "WILL_CHANGE" | "NO_CHANGE" | "BLOCKED";
  blocked: Blocked | null;
};

/** Planlayıcının ihtiyacı olan yetki yüzeyi: `ctx` ile veya bir aktör için kurulmuş `Access` ile aynı şekil. */
export type PlanAccess = {
  authorize(resource: { communityId: string | null }): Promise<void>;
  moderationScope(): Promise<{ all: boolean }>;
};

/**
 * Kayıt başına karar: bulunamadı → kapsam (authorize) → geçiş tablosu → ADMIN şartı.
 * Hiçbir kayıt bulunamazsa 404 (yetkisiz kaynak ipucu vermez, hata zaten kimlik varlığını söylemez).
 */
export function createPlanner(batches: BulkModerationStore) {
  return async function plan(
    access: PlanAccess,
    kind: ContentKind,
    action: BulkAction,
    ids: string[],
  ): Promise<{ plans: Plan[]; states: Map<string, BulkItemState> }> {
    const states = await batches.inspect(kind, ids);
    if (states.size === 0) throw new ApiError("NOT_FOUND", "Seçilen kayıtların hiçbiri bulunamadı.");
    const admin = (await access.moderationScope()).all;
    const plans: Plan[] = [];
    for (const id of [...ids].sort()) {
      const state = states.get(id) ?? null;
      if (!state) {
        plans.push({ id, state: null, label: null, outcome: "BLOCKED", blocked: "not_found" });
        continue;
      }
      try {
        await access.authorize({ communityId: state.communityId });
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
  };
}

export type BatchItemView = { id: string; result: "APPLIED" | "UNCHANGED" | "FAILED"; code: string | null; fromStatus: string | null; toStatus: string | null };

/**
 * Planı kayıt kayıt uygular (her kayıt kendi transaction'ında, kimlik sırasıyla; biri başarısız olursa diğerleri etkilenmez) ve
 * partiyi bitirir. Karar anında kilitli yeniden okuma tekil yoldadır: planlama ile bu an arasında değişen kayıt burada ayıklanır.
 */
export async function executeBatch(
  deps: { store: ModerationStore; batches: BulkModerationStore; now: () => Date },
  input: { batchId: string; kind: ContentKind; action: BulkAction; reason: string; plans: Plan[]; actorId: string; actorIsAdmin: boolean; requestId: string | null; at: Date },
): Promise<{ counts: { applied: number; unchanged: number; failed: number }; items: BatchItemView[] }> {
  const { store, batches } = deps;
  const counts = { applied: 0, unchanged: 0, failed: 0 };
  const items: BatchItemView[] = [];
  for (const p of input.plans) {
    let record: BatchItemRecord;
    if (p.blocked === "not_found" || p.blocked === "forbidden" || p.blocked === "invalid_transition" || p.blocked === "admin_required") {
      counts.failed += 1;
      record = { targetId: p.id, communityId: p.state?.communityId ?? null, result: "FAILED", detail: p.blocked, fromStatus: p.state?.status ?? null, toStatus: null, moderationActionId: null };
    } else {
      const result = await store.apply({
        kind: input.kind,
        id: p.id,
        actorId: input.actorId,
        action: input.action,
        reason: input.reason,
        now: input.at,
        requestId: input.requestId,
        actorIsAdmin: input.actorIsAdmin,
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
    await batches.recordItem(input.batchId, record, input.at);
    items.push({ id: record.targetId, result: record.result, code: record.detail, fromStatus: record.fromStatus, toStatus: record.toStatus });
  }
  await batches.finishBatch(input.batchId, counts, deps.now());
  return { counts, items };
}

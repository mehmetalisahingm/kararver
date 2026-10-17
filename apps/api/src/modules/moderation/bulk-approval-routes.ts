// Yüksek hacimli toplu moderasyon için ikinci onay endpoint'leri — #183, KV-37 §8. Sözleşme: contracts/domains/moderation.ts
// (admin.moderation.bulkApprovals.{list,get,approve,reject,cancel}). Talebi açan `bulk` endpoint'i bulk-routes.ts'tedir.
//
// Onay, talebi başlatanın YETKİSİYLE yeniden planlar (başlatanın rolü/atandığı topluluklar şimdiki haliyle), özeti (digest)
// talep anındakiyle karşılaştırır ve aynı planlayıcı/uygulayıcıyla partiyi başlatan adına uygular: ikinci onay, ikinci bir
// yazma yolu veya yetki yükseltmesi değildir. Onaylayan ADMIN+ olmalı, başlatandan farklı olmalı ve taze MFA step-up vermelidir.
import { ApiError } from "../../http/errors.ts";
import type { Route, RouteContext } from "../../http/route.ts";
import { decodeCursor, encodeCursor } from "../../http/cursor.ts";
import { toPublicUser } from "../admin-users/view.ts";
import { createAccess } from "../rbac/access.ts";
import { batchDigest } from "./bulk.ts";
import type { ApprovalRecord } from "./bulk-approval.ts";
import { createPlanner, executeBatch, type PlanAccess } from "./bulk-core.ts";
import type { BulkModerationDeps } from "./bulk-routes.ts";
import type { ContentKind } from "./store.ts";

const conflict = (message: string, code: string) => new ApiError("CONFLICT", message, [{ code }]);

/** Sözleşmedeki görünüm. Süresi dolmuş bekleyen talep okunurken EXPIRED sayılır (arka plan işi yoktur). */
export function approvalView(a: ApprovalRecord, now: Date, base: string) {
  const status = a.status === "PENDING" && a.expiresAt <= now ? ("EXPIRED" as const) : a.status;
  return {
    id: a.id,
    kind: a.kind,
    action: a.action,
    reason: a.reason,
    itemCount: a.willChange,
    status,
    initiator: toPublicUser(a.initiator, base),
    createdAt: a.createdAt.toISOString(),
    expiresAt: a.expiresAt.toISOString(),
    decidedBy: a.decidedBy ? toPublicUser(a.decidedBy, base) : null,
    decidedAt: a.decidedAt?.toISOString() ?? null,
    decisionReason: a.decisionReason,
    batchId: a.batchId,
  };
}

export function registerBulkApprovalRoutes(route: Route, deps: BulkModerationDeps): void {
  const { store, batches, approvals, rbac, now } = deps;
  const base = deps.mediaPublicBaseUrl;
  const plan = createPlanner(batches);

  /**
   * Başlatanın ŞİMDİKİ yetkisi: etkin hesap + kendi işleminin kapısı + kayıt başına authorize. Rolü/hesabı artık uygun değilse null
   * (onay verilmez; sessizce onaylayanın yetkisine yükselmez).
   */
  async function initiatorAccess(initiatorId: string, kind: ContentKind, at: Date): Promise<PlanAccess | null> {
    const u = await approvals.initiator(initiatorId);
    if (!u || u.deleted || u.status !== "ACTIVE") return null;
    const access = createAccess(rbac, { id: u.id, status: u.status, emailVerified: u.emailVerified }, kind === "polls" ? "moderation.poll.apply" : "moderation.comment.apply", at);
    try {
      await access.gate();
    } catch (err) {
      if (err instanceof ApiError) return null;
      throw err;
    }
    return { authorize: (resource) => access.authorize(resource), moderationScope: () => access.moderationScope() };
  }

  /** Talebin kayıt başına şimdiki sonucu ve özetin değişip değişmediği. */
  async function evaluate(a: ApprovalRecord, at: Date) {
    const access = await initiatorAccess(a.initiatorId, a.kind, at);
    if (!access) return null;
    const { plans, states } = await plan(access, a.kind, a.action, a.ids);
    // Özet değiştiyse VEYA başlatanın yetkisiyle değişecek kayıt sayısı talepteki sayıdan farklıysa (ör. kapsamı daraldı) eski sayılır.
    const willChange = plans.filter((p) => p.outcome === "WILL_CHANGE").length;
    return { access, plans, states, stale: batchDigest(a.kind, a.action, a.ids, states) !== a.digest || willChange !== a.willChange };
  }

  /** Moderatör yalnız kendi talebini görür (başkasınınki varlığı da ele verilmeden 404). */
  async function visible(id: string, viewerId: string, admin: boolean): Promise<ApprovalRecord> {
    const a = await approvals.get(id);
    if (!a || (!admin && a.initiatorId !== viewerId)) throw new ApiError("NOT_FOUND", "Onay talebi bulunamadı.");
    return a;
  }

  route("admin.moderation.bulkApprovals.list", async ({ query, viewer, moderationScope }) => {
    const scope = await moderationScope();
    const key = `admin.moderation.bulkApprovals.list:${query.status ?? "*"}:${scope.all ? "all" : viewer!.id}`;
    const cursor = decodeCursor(query.cursor, key);
    const at = now();
    const rows = await approvals.list(
      { ...(scope.all ? {} : { initiatorId: viewer!.id }), ...(query.status ? { status: query.status } : {}), after: cursor ? { at: new Date(cursor.keys[0] as string), id: cursor.id } : null, now: at },
      query.limit,
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor = rows.length > query.limit && last ? encodeCursor(key, [last.createdAt.toISOString()], last.id) : null;
    return { status: 200, body: { data: page.map((a) => approvalView(a, at, base)), page: { nextCursor, hasMore: nextCursor !== null } } };
  });

  route("admin.moderation.bulkApprovals.get", async ({ params, viewer, moderationScope }) => {
    const admin = (await moderationScope()).all;
    const a = await visible(params.id, viewer!.id, admin);
    const at = now();
    const ev = await evaluate(a, at);
    const items = ev
      ? ev.plans.map((p) => ({ id: p.id, label: p.label, status: p.state?.status ?? null, communityId: p.state?.communityId ?? null, outcome: p.outcome, blocked: p.blocked }))
      : [];
    // Başlatanın yetkisi kalmadıysa (veya talep zaten kapandıysa durum değişikliği normaldir): yalnız açık talepte "eski" uyarısı.
    const stale = a.status === "PENDING" && (ev === null || ev.stale);
    return { status: 200, body: { data: { ...approvalView(a, at, base), items, stale } } };
  });

  route("admin.moderation.bulkApprovals.approve", async ({ params, body, viewer, request }) => {
    const at = now();
    const a = await approvals.get(params.id);
    if (!a) throw new ApiError("NOT_FOUND", "Onay talebi bulunamadı.");
    if (a.status !== "PENDING" || a.expiresAt <= at) throw conflict("Bu talep artık açık değil.", "closed");
    if (a.initiatorId === viewer!.id) throw new ApiError("FORBIDDEN", "Kendi talebini onaylayamazsın; başka bir yönetici onaylamalı.", [{ code: "self_approval" }]);
    const ev = await evaluate(a, at);
    if (!ev) throw conflict("Talebi başlatan artık bu işlem için yetkili değil; talebi reddet.", "initiator_changed");
    if (ev.stale) throw conflict("Kayıtlar talepten sonra değişti; talebi reddet ve işlemi yeniden başlat.", "preview_stale");

    const result = await approvals.approve({ approvalId: a.id, approverId: viewer!.id, sessionId: viewer!.sessionId, reason: body.reason, requestId: request.id, now: at });
    if (result.kind === "rejected") {
      if (result.reason === "closed") throw conflict("Bu talep artık açık değil.", "closed");
      if (result.reason === "self_approval") throw new ApiError("FORBIDDEN", "Kendi talebini onaylayamazsın; başka bir yönetici onaylamalı.", [{ code: "self_approval" }]);
      if (result.reason === "stepup_required") throw new ApiError("FORBIDDEN", "Önce doğrulayıcı kodunla kimliğini doğrula.", [{ code: "stepup_required" }]);
      if (result.reason === "initiator_changed") throw conflict("Talebi başlatan artık bu işlem için yetkili değil; talebi reddet.", "initiator_changed");
      throw new ApiError("FORBIDDEN", "Bu işlem için yetkin yok.");
    }
    const executed = await executeBatch(deps, {
      batchId: result.batchId,
      kind: a.kind,
      action: a.action,
      reason: a.reason,
      plans: ev.plans,
      actorId: a.initiatorId,
      // Yönetici bayrağı onay transaction'ında kilitli okunan rolden gelir (planlama ile onay arasında rol değişmiş olabilir).
      actorIsAdmin: result.initiatorIsAdmin,
      requestId: request.id,
      at,
    });
    return {
      status: 200,
      body: { data: { approval: approvalView(result.approval, at, base), result: { batchId: result.batchId, summary: { total: a.ids.length, ...executed.counts }, items: executed.items } } },
    };
  });

  /** reject: başlatandan farklı ADMIN+ (kapı endpoint'te); cancel: yalnız başlatan, başkasının talebi 404. */
  const decline = (mode: "reject" | "cancel") => async ({ params, body, viewer, request }: RouteContext) => {
    const at = now();
    const existing = await approvals.get(params.id);
    if (!existing || (mode === "cancel" && existing.initiatorId !== viewer!.id)) throw new ApiError("NOT_FOUND", "Onay talebi bulunamadı.");
    const result = await approvals.decline({ approvalId: params.id, actorId: viewer!.id, mode, reason: body.reason, requestId: request.id, now: at });
    if (result.kind === "rejected") {
      if (result.reason === "closed") throw conflict("Bu talep artık açık değil.", "closed");
      if (result.reason === "self_approval") throw new ApiError("FORBIDDEN", "Kendi talebini reddedemezsin; geri çekebilirsin.", [{ code: "self_approval" }]);
      throw new ApiError("NOT_FOUND", "Onay talebi bulunamadı.");
    }
    return { status: 200, body: { data: approvalView(result.approval, at, base) } };
  };
  route("admin.moderation.bulkApprovals.reject", decline("reject"));
  route("admin.moderation.bulkApprovals.cancel", decline("cancel"));
}

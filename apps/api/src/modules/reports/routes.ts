// Rapor endpoint'leri — KV-24 (#26). Sözleşme: packages/contracts/src/domains/moderation.ts
// Rapor içeriği silmez veya gizlemez; moderasyon kuyruğuna düşer (MVP_PLAN §13). Kuyrukta hedef başına tek satır
// görünür (reportCount), sonuçlandırma o hedefin açık raporlarının hepsini birlikte kapatır.
// Yetki KV-04: report.queue.read (kuyruk kapsamı: MODERATOR atandığı topluluklar, ADMIN+ tümü),
// report.resolve (hedefin topluluğu DB'den okunur; topluluğu olmayan hedef — kullanıcı raporu — yalnız ADMIN+).
// İz: sonuçlandırma audit_logs'a (report.resolve) ve report.resolved olayı outbox'a, rapor oluşturma report.created
// olayı ile mutasyonla aynı transaction'da yazılır (store). Kapsam dışı: içeriğe işlem uygulama (admin.moderation.*,
// KV-37), rapor hız sınırı (KV-19, #21).
import { decodeCursor, encodeCursor } from "../../http/cursor.ts";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { QueueItem, ReportStore } from "./store.ts";

export type ReportDeps = { store: ReportStore; now: () => Date };

const reportView = (r: QueueItem) => ({
  id: r.id,
  target: r.target,
  excerpt: r.excerpt,
  contentStatus: r.contentStatus,
  targetUser: r.targetUser,
  reason: r.reason,
  note: r.note,
  status: r.status,
  reportCount: r.reportCount,
  communityId: r.communityId,
  createdAt: r.createdAt.toISOString(),
  resolvedAt: r.resolvedAt?.toISOString() ?? null,
});

export function registerReportRoutes(route: Route, deps: ReportDeps): void {
  route("reports.create", async ({ body, viewer }) => {
    const target = body.target as { type: "POLL" | "COMMENT" | "MEDIA" | "USER"; id: string };
    if (target.type === "USER" && target.id === viewer!.id) {
      throw new ApiError("VALIDATION_ERROR", "Kendinizi raporlayamazsınız.", [{ field: "target", code: "self_report" }]);
    }
    if (!(await deps.store.isReportable(target))) throw new ApiError("NOT_FOUND", "Raporlanacak içerik bulunamadı.");

    const filed = await deps.store.file({ reporterId: viewer!.id, target, reason: body.reason, details: body.note || null, now: deps.now() });
    return { status: 202, body: { data: { reportId: filed.reportId } } };
  });

  route("admin.reports.list", async ({ query, moderationScope }) => {
    const scope = await moderationScope();
    // Cursor durum/tür/topluluk filtresine bağlıdır; filtre değişince eski cursor 400 INVALID_CURSOR olur.
    const list = `admin.reports.list:${query.status}:${query.targetType ?? "*"}:${query.communityId ?? "*"}`;
    const at = decodeCursor(query.cursor, list);
    const rows = await deps.store.listQueue(
      {
        status: query.status,
        targetType: query.targetType,
        communityId: query.communityId,
        scope,
        after: at ? { sortAt: new Date(at.keys[0] as string), id: at.id } : null,
      },
      query.limit + 1,
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const sortAt = last && (query.status === "OPEN" ? last.createdAt : last.resolvedAt);
    const nextCursor = rows.length > query.limit && last && sortAt ? encodeCursor(list, [sortAt.toISOString()], last.id) : null;
    return { status: 200, body: { data: page.map(reportView), page: { nextCursor, hasMore: nextCursor !== null } } };
  });

  route("admin.reports.resolve", async ({ params, body, viewer, authorize, request }) => {
    const report = await deps.store.findForResolve(params.id);
    if (!report) throw new ApiError("NOT_FOUND", "Rapor bulunamadı.");
    await authorize({ communityId: report.communityId });

    if (report.status !== "OPEN") {
      // Aynı karar tekrarlanırsa idempotent; farklı karar kapanmış raporu değiştiremez.
      if (report.status === body.resolution) return { status: 200, body: { data: reportView(report) } };
      throw new ApiError("CONFLICT", "Rapor zaten sonuçlandırılmış.", [{ code: "already_resolved" }]);
    }
    const result = await deps.store.resolve({
      reportId: report.id,
      actorId: viewer!.id,
      resolution: body.resolution,
      note: body.note,
      now: deps.now(),
      requestId: request.id,
    });
    if (result.kind === "not_found") throw new ApiError("NOT_FOUND", "Rapor bulunamadı.");
    if (result.kind === "conflict") throw new ApiError("CONFLICT", "Rapor başka bir moderatör tarafından sonuçlandırıldı.", [{ code: "already_resolved" }]);
    return { status: 200, body: { data: reportView(result.item) } };
  });
}

// Rapor endpoint'i — KV-24 (#26). Sözleşme: packages/contracts/src/domains/moderation.ts
// Rapor içeriği silmez veya gizlemez; moderasyon kuyruğuna düşer (MVP_PLAN §13).
// Kapsam dışı: admin.reports.list/resolve (moderator yetki seviyesi, KV-12 #14), report.created olayı
// (olay outbox'ı henüz yok, KV-04), kullanıcı başına rapor hız sınırı (KV-19, #21).
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { ReportStore } from "./store.ts";

export type ReportDeps = { store: ReportStore };

export function registerReportRoutes(route: Route, deps: ReportDeps): void {
  route("reports.create", async ({ body, viewer }) => {
    const target = body.target as { type: "POLL" | "COMMENT" | "MEDIA" | "USER"; id: string };
    if (target.type === "USER" && target.id === viewer!.id) {
      throw new ApiError("VALIDATION_ERROR", "Kendinizi raporlayamazsınız.", [{ field: "target", code: "self_report" }]);
    }
    if (!(await deps.store.isReportable(target))) throw new ApiError("NOT_FOUND", "Raporlanacak içerik bulunamadı.");

    const filed = await deps.store.file({ reporterId: viewer!.id, target, reason: body.reason, details: body.note || null });
    return { status: 202, body: { data: { reportId: filed.reportId } } };
  });
}

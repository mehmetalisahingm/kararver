// Rapor modülünün veri erişim arayüzü — KV-24 (#26). Üretim uygulaması: prisma-store.ts.
// Kurallar: DATA_MODEL.md §9 (hedef başına ayrı FK, kullanıcı + hedef başına tek satır).

export type ReportTargetType = "POLL" | "COMMENT" | "MEDIA" | "USER";
export type ReportReason = "SPAM" | "INAPPROPRIATE" | "HARASSMENT" | "HATE" | "PERSONAL_INFO" | "MISLEADING" | "COPYRIGHT" | "OTHER";

export type NewReport = {
  reporterId: string;
  target: { type: ReportTargetType; id: string };
  reason: ReportReason;
  details: string | null;
};

/** created: yeni satır · pending: aynı hedefe açık raporu vardı · reopened: kapanmış rapor yeniden açıldı. */
export type FiledReport = { reportId: string; outcome: "created" | "pending" | "reopened" };

export interface ReportStore {
  /** Raporlayanın görebileceği bir hedef mi: kaldırılmamış içerik, yayınlanmış görsel, silinmemiş hesap. */
  isReportable(target: { type: ReportTargetType; id: string }): Promise<boolean>;
  file(report: NewReport): Promise<FiledReport>;
}

// Rapor modülünün veri erişim arayüzü — KV-24 (#26). Üretim uygulaması: prisma-store.ts.
// Kurallar: DATA_MODEL.md §9 (hedef başına ayrı FK, kullanıcı + hedef başına tek satır).
import type { ModerationScope } from "../rbac/access.ts";

export type ReportTargetType = "POLL" | "COMMENT" | "MEDIA" | "USER";
export type ReportReason = "SPAM" | "INAPPROPRIATE" | "HARASSMENT" | "HATE" | "PERSONAL_INFO" | "MISLEADING" | "COPYRIGHT" | "OTHER";
export type ReportStatus = "OPEN" | "ACTIONED" | "DISMISSED";

export type NewReport = {
  reporterId: string;
  target: { type: ReportTargetType; id: string };
  reason: ReportReason;
  details: string | null;
  /** İşlemin anı: `report.created` olayının zamanı. */
  now: Date;
};

/** created: yeni satır · pending: aynı hedefe açık raporu vardı · reopened: kapanmış rapor yeniden açıldı. */
export type FiledReport = { reportId: string; outcome: "created" | "pending" | "reopened" };

export type QueueFilter = {
  status: ReportStatus;
  targetType?: ReportTargetType;
  communityId?: string;
  scope: ModerationScope;
  /** Sıralama anahtarı: OPEN için created_at (artan), kapanmışlar için resolved_at (azalan). */
  after: { sortAt: Date; id: string } | null;
};

export type QueueItem = {
  id: string;
  target: { type: ReportTargetType; id: string };
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  reportCount: number;
  communityId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
};

export type ResolveInput = {
  reportId: string;
  actorId: string;
  resolution: "ACTIONED" | "DISMISSED";
  note: string;
  now: Date;
  /** X-Request-Id: audit kaydına yazılır. */
  requestId: string | null;
};

export interface ReportStore {
  /** Raporlayanın görebileceği bir hedef mi: kaldırılmamış içerik, yayınlanmış görsel, silinmemiş hesap. */
  isReportable(target: { type: ReportTargetType; id: string }): Promise<boolean>;
  file(report: NewReport): Promise<FiledReport>;

  /**
   * Moderasyon kuyruğu: hedef başına tek satır (aynı hedefin aynı durumdaki raporları gruplanır, `reportCount`).
   * Temsilci satır grubun en eski raporudur. OPEN kuyruğu en eski önce, kapanmışlar en son sonuçlanan önce sıralanır.
   */
  listQueue(filter: QueueFilter, limit: number): Promise<QueueItem[]>;
  /** Sonuçlandırma için rapor + hedefin topluluğu (yetki kapsamı). */
  findForResolve(id: string): Promise<QueueItem | null>;
  /** Hedefin bütün açık raporlarını birlikte kapatır; DISMISSED ise moderasyon geçmişine DISMISS_REPORT yazar. */
  resolve(input: ResolveInput): Promise<{ kind: "resolved"; item: QueueItem } | { kind: "conflict" } | { kind: "not_found" }>;
}

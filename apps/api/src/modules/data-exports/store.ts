// KVKK veri dışa aktarma talepleri — #181. Üretim uygulaması: prisma-store.ts. Kurallar: docs/KV-33_ADMIN_USERS.md §8.
// Paketi worker hazırlar (apps/worker/src/jobs/data-exports); bu modül talep açar, hazır paketin bağlantısını kullanıcıya
// gönderir ve kullanıcının indirmesini yetkilendirir. Yönetici paket içeriğine hiçbir yolla erişmez.
export type ExportStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED" | "EXPIRED";

export type ExportRow = {
  id: string;
  status: ExportStatus;
  createdAt: Date;
  readyAt: Date | null;
  expiresAt: Date | null;
  sizeBytes: number | null;
  failure: string | null;
  deliveredAt: Date | null;
  downloadCount: number;
};

export type ExportMutation = { actorId: string; requestId: string; now: Date };

export type RequestRejection = "not_found" | "forbidden" | "user_deleted" | "account_restricted";
export type DeliverRejection = "not_found" | "forbidden" | "not_ready" | "expired";

export type RequestResult = { kind: "created" | "existing"; row: ExportRow } | { kind: "rejected"; reason: RequestRejection };
export type DeliverResult =
  | { kind: "issued"; email: string; linkExpiresAt: Date }
  | { kind: "rejected"; reason: DeliverRejection }
  | { kind: "limited"; retryAfterMs: number };

export type DownloadTicket = { exportId: string; objectKey: string; encKey: Buffer };

export interface DataExportStore {
  /** Hesabın var olup olmadığı (liste için 404 kararı). */
  userExists(userId: string): Promise<boolean>;
  list(userId: string, limit: number): Promise<ExportRow[]>;
  /**
   * Hedef kilitlenir, yetki taze veriyle yeniden verilir. Açık (PENDING/PROCESSING/READY) talep varsa o döner ve audit
   * yazılmaz; yoksa yeni talep + audit aynı transaction'da yazılır.
   */
  request(input: ExportMutation & { userId: string; reason: string }): Promise<RequestResult>;
  /**
   * READY paket için yeni indirme token'ı (önceki bağlantıyı geçersiz kılar) + audit; sıklık sınırı audit kayıtlarından.
   * Bağlantı süresi min(şimdi + ttl, paket süresi). E-postayı çağıran gönderir.
   */
  deliver(
    input: ExportMutation & { userId: string; exportId: string; reason: string; tokenHash: string; ttlMs: number; cooldownMs: number; hourlyLimit: number },
  ): Promise<DeliverResult>;
  /** Token + sahip + süre + indirme hakkı doğruysa paketin yeri ve anahtarı; aksi halde null. Hiçbir şey yazmaz. */
  findDownloadable(input: { userId: string; tokenHash: string; now: Date; maxDownloads: number }): Promise<DownloadTicket | null>;
  /**
   * Paket başarıyla çözüldükten sonra: indirme sayacı artar (koşullu: hak bitmişse false) ve audit yazılır, aynı transaction.
   * Eşzamanlı indirmelerde sayaç hakkı aşmaz.
   */
  recordDownload(input: { userId: string; exportId: string; requestId: string; now: Date; maxDownloads: number }): Promise<boolean>;
}

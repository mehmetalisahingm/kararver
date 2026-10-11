// KVKK veri dışa aktarma endpoint'leri — #181. Sözleşme: contracts/domains/admin.ts (admin.users.dataExports.*,
// dataExports.download). Kurallar, kapsam ve dışarıda bırakılanlar: docs/KV-33_ADMIN_USERS.md §8.
//
// Akış: yönetici talep açar (SUPER_ADMIN, gerekçeli) → worker paketi hazırlar (şifreli, 7 gün) → yönetici kimlik
// doğrulamasını gerekçeyle beyan edip bağlantıyı gönderir → bağlantı YALNIZ kullanıcının kayıtlı e-postasına gider →
// kullanıcı kendi oturumuyla + token'la indirir. Yönetici paket içeriğini, token'ı veya bağlantıyı hiçbir yerde görmez.
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { Mail, Mailer } from "../../mail/mailer.ts";
import { hashToken, newToken } from "../auth/crypto.ts";
import type { MediaStorage } from "../media/storage.ts";
import { rateLimitError } from "../rate-limit/limiter.ts";
import { decryptPackage } from "./crypto.ts";
import type { DataExportStore, DeliverRejection, ExportRow, RequestRejection } from "./store.ts";

export type DataExportDeps = {
  store: DataExportStore;
  storage: Pick<MediaStorage, "readPrivate">;
  mailer: Mailer;
  now: () => Date;
  tokenPepper: string;
  webUrl: string;
};

/** İndirme bağlantısı ömrü (paket ömründen uzun olamaz), gönderim sınırı ve teslim başına indirme hakkı. */
export const LINK_TTL_MS = 24 * 60 * 60 * 1000;
export const DELIVER_COOLDOWN_MS = 60 * 1000;
export const DELIVER_HOURLY_LIMIT = 3;
export const MAX_DOWNLOADS = 3;
const LIST_LIMIT = 20;

const conflict = (message: string, code: string) => new ApiError("CONFLICT", message, [{ code }]);

const REQUEST_CONFLICTS: Record<Exclude<RequestRejection, "not_found" | "forbidden">, () => ApiError> = {
  user_deleted: () => conflict("Silinmiş (anonimleştirilmiş) hesap için veri paketi hazırlanamaz.", "user_deleted"),
  account_restricted: () => conflict("Kısıtlı (askıda/yasaklı) hesap veri paketini indirmek için giriş yapamaz.", "account_restricted"),
};
const DELIVER_CONFLICTS: Record<Exclude<DeliverRejection, "not_found" | "forbidden">, () => ApiError> = {
  not_ready: () => conflict("Paket henüz hazır değil.", "not_ready"),
  expired: () => conflict("Paketin süresi dolmuş; yeni talep açılmalı.", "expired"),
};

export const dataExportView = (row: ExportRow) => ({
  id: row.id,
  status: row.status,
  requestedAt: row.createdAt.toISOString(),
  readyAt: row.readyAt?.toISOString() ?? null,
  expiresAt: row.expiresAt?.toISOString() ?? null,
  sizeBytes: row.sizeBytes,
  failure: row.failure,
  deliveredAt: row.deliveredAt?.toISOString() ?? null,
  downloadCount: row.downloadCount,
});

export function dataExportMail(webUrl: string, to: string, raw: string): Mail {
  return {
    to,
    subject: "KararVer — verilerin indirmeye hazır",
    // Token URL fragment'ında taşınır: sunucu loglarına ve Referer başlığına düşmez.
    text: `Merhaba,\n\nKararVer hesabına ait kişisel veri paketin hazır. Hesabınla giriş yapmışken bağlantıyı aç (24 saat geçerli, en çok 3 indirme):\n${webUrl}/veri-indir#token=${raw}\n\nBu isteği sen yapmadıysan bağlantıyı açma ve destek ile iletişime geç; bağlantı yalnız bu hesapla giriş yapıldığında çalışır.`,
  };
}

export function registerDataExportRoutes(route: Route, deps: DataExportDeps): void {
  const { store, storage, now } = deps;
  const userNotFound = () => new ApiError("NOT_FOUND", "Kullanıcı bulunamadı.");
  const invalidLink = () => new ApiError("TOKEN_INVALID_OR_EXPIRED", "Bağlantı geçersiz veya süresi dolmuş.");

  route("admin.users.dataExports.create", async ({ params, body, viewer, request }) => {
    const result = await store.request({ userId: params.id, reason: body.reason, actorId: viewer!.id, requestId: request.id, now: now() });
    if (result.kind === "rejected") {
      if (result.reason === "not_found") throw userNotFound();
      if (result.reason === "forbidden") throw new ApiError("FORBIDDEN", "Bu işlem için yetkiniz yok.");
      throw REQUEST_CONFLICTS[result.reason]();
    }
    return { status: 202, body: { data: dataExportView(result.row) } };
  });

  route("admin.users.dataExports.list", async ({ params }) => {
    if (!(await store.userExists(params.id))) throw userNotFound();
    const rows = await store.list(params.id, LIST_LIMIT);
    return { status: 200, body: { data: rows.map(dataExportView) } };
  });

  route("admin.users.dataExports.deliver", async ({ params, body, viewer, request }) => {
    const raw = newToken();
    const result = await store.deliver({
      userId: params.id,
      exportId: params.exportId,
      reason: body.reason,
      tokenHash: hashToken(raw, deps.tokenPepper),
      ttlMs: LINK_TTL_MS,
      cooldownMs: DELIVER_COOLDOWN_MS,
      hourlyLimit: DELIVER_HOURLY_LIMIT,
      actorId: viewer!.id,
      requestId: request.id,
      now: now(),
    });
    if (result.kind === "limited") throw rateLimitError(result.retryAfterMs / 1000);
    if (result.kind === "rejected") {
      if (result.reason === "not_found") throw new ApiError("NOT_FOUND", "Veri paketi talebi bulunamadı.");
      if (result.reason === "forbidden") throw new ApiError("FORBIDDEN", "Bu işlem için yetkiniz yok.");
      throw DELIVER_CONFLICTS[result.reason]();
    }
    let sent = true;
    try {
      await deps.mailer.send(dataExportMail(deps.webUrl, result.email, raw));
    } catch (err) {
      sent = false;
      request.log.error({ err }, "veri paketi bağlantısı e-postası gönderilemedi");
    }
    return { status: 202, body: { data: { sent, linkExpiresAt: result.linkExpiresAt.toISOString() } } };
  });

  route("dataExports.download", async ({ body, viewer, request }) => {
    const at = now();
    // Hem token hem sahip oturum gerekir; başkasının oturumuyla gelen token aynı hatayı alır (varlık sızmaz).
    const ticket = await store.findDownloadable({ userId: viewer!.id, tokenHash: hashToken(body.token, deps.tokenPepper), now: at, maxDownloads: MAX_DOWNLOADS });
    if (!ticket) throw invalidLink();
    let data: unknown;
    try {
      const blob = await storage.readPrivate(ticket.objectKey);
      if (!blob) throw new Error("paket nesnesi yok");
      data = decryptPackage(blob, ticket.encKey, ticket.exportId);
    } catch (err) {
      request.log.error({ err, exportId: ticket.exportId }, "veri paketi okunamadı");
      throw new ApiError("INTERNAL_ERROR", "Veri paketi şu an okunamadı. Daha sonra tekrar dene.");
    }
    // Hak, paket başarıyla çözüldükten sonra düşer; eşzamanlı indirmelerde sayaç hakkı aşmaz (aşan taraf geçersiz bağlantı alır).
    if (!(await store.recordDownload({ userId: viewer!.id, exportId: ticket.exportId, requestId: request.id, now: at, maxDownloads: MAX_DOWNLOADS }))) {
      throw invalidLink();
    }
    return { status: 200, body: { data } };
  });
}

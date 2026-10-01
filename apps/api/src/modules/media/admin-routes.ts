// Görsel inceleme kuyruğu ve moderatör kararı — KV-24 (#26) / KV-16 (#18). Sözleşme: contracts/domains/moderation.ts
// (admin.media.list, admin.media.decide). Yetki KV-04: media.queue.read (kuyruk kapsamı), media.review
// (görselin topluluğu DB'den okunur; moderatör yalnız atandığı topluluktaki görseli karara bağlar).
//
// Depolama sırası güvenli ve tekrar denenebilirdir:
//   APPROVE: önce public'e kopyala, sonra DB. DB kararı hata/conflict verirse bu isteğin public kopyası silinir.
//   REJECT : public anahtar karar öncesi ve karar sonrası idempotent silinir. İkinci silme, eşzamanlı APPROVE'ın
//            ilk silmeden sonra oluşturduğu kopyayı da temizler. Tekrar REJECT (unchanged) de temizliği yeniden dener.
//
// Bilinen açık: signed preview URL'lerine ve reddedilmiş görsel erişimine audit kaydı (KV-08 §7) audit_logs tablosu
// KV-39 (#41, Utku) ile gelince eklenecek; o zamana kadar izi `moderation_actions` (karar) taşır, erişim izlenmez.
import { ApiError } from "../../http/errors.ts";
import { decodeCursor, encodeCursor } from "../../http/cursor.ts";
import type { Route } from "../../http/route.ts";
import { publicObjectKeyFor, type MediaStorage } from "./storage.ts";
import type { MediaStore } from "./store.ts";
import { toMediaView } from "./view.ts";

export type MediaAdminDeps = { store: MediaStore; storage: MediaStorage; now: () => Date; mediaPublicBaseUrl: string };

const notFound = () => new ApiError("NOT_FOUND", "Görsel bulunamadı.");

export function registerMediaAdminRoutes(route: Route, deps: MediaAdminDeps): void {
  const { store, storage, mediaPublicBaseUrl } = deps;

  route("admin.media.list", async ({ query, moderationScope }) => {
    const scope = await moderationScope();
    const list = `admin.media.list:${query.status}`;
    const at = decodeCursor(query.cursor, list);
    const rows = await store.listForReview(
      { status: query.status, scope, after: at ? { createdAt: new Date(at.keys[0] as string), id: at.id } : null },
      query.limit + 1,
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor = rows.length > query.limit && last ? encodeCursor(list, [last.createdAt.toISOString()], last.id) : null;
    const now = deps.now();
    const data = await Promise.all(page.map((m) => toMediaView(m, storage, mediaPublicBaseUrl, now, { previewRejected: scope.all })));
    return { status: 200, body: { data, page: { nextCursor, hasMore: nextCursor !== null } } };
  });

  route("admin.media.decide", async ({ params, body, viewer, authorize, moderationScope }) => {
    const media = await store.findForReview(params.id);
    if (!media) throw notFound();
    await authorize({ communityId: media.communityId });

    const conflict = (message: string, code: string) => new ApiError("CONFLICT", message, [{ code }]);
    if (media.status === "PENDING") throw conflict("Görsel henüz işleniyor.", "still_processing");
    const publicKey = publicObjectKeyFor(media.id);

    if (body.decision === "APPROVE" && media.status !== "APPROVED") {
      if (media.processedObjectKey === null) throw conflict("Görselin işlenmiş kopyası yok.", "no_processed_copy");
      await storage.publishFromPrivate(media.processedObjectKey, publicKey);
    }

    // REJECT'te ilk silme, zaten yayında olan nesnenin DB kararı uygulanmadan önce kapatılmasını sağlar.
    // Status'u kilitsiz okumaya bağlamıyoruz: yarışta APPROVE sonradan kopyalayabilir, aşağıdaki ikinci silme onu yakalar.
    if (body.decision === "REJECT") await storage.deletePublic(media.publicObjectKey ?? publicKey);

    let result: Awaited<ReturnType<MediaStore["applyDecision"]>>;
    try {
      result = await store.applyDecision({ id: media.id, actorId: viewer!.id, decision: body.decision, reason: body.reason, now: deps.now() });
    } catch (err) {
      // APPROVE public kopyayı DB'den önce yazar. DB transaction'ı patlarsa bilinen public anahtarı temizlemeye çalış.
      if (body.decision === "APPROVE") await storage.deletePublic(publicKey).catch(() => undefined);
      throw err;
    }

    if (result.kind === "not_found") {
      if (body.decision === "APPROVE") await storage.deletePublic(publicKey).catch(() => undefined);
      throw notFound();
    }
    if (result.kind === "conflict") {
      if (body.decision === "APPROVE") await storage.deletePublic(publicKey).catch(() => undefined);
      throw conflict(
        result.reason === "no_processed_copy" ? "Görselin işlenmiş kopyası yok." : "Görselin durumu bu kararı uygulamaya elverişli değil.",
        result.reason,
      );
    }

    // Kritik yarış koruması: REJECT kararı kilidi aldıktan önce/sonra eşzamanlı APPROVE public'e kopyalamış olabilir.
    // Silme idempotenttir; unchanged REJECT de stale public nesneyi temizler. Hata olursa 500 dönerek tekrar denemeyi sağlar.
    if (body.decision === "REJECT") await storage.deletePublic(publicKey);

    const scope = await moderationScope();
    return { status: 200, body: { data: await toMediaView(result.media, storage, mediaPublicBaseUrl, deps.now(), { previewRejected: scope.all }) } };
  });
}

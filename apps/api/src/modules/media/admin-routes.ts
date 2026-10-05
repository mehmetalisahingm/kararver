// Görsel inceleme kuyruğu ve moderatör kararı — KV-24 (#26) / KV-16 (#18). Sözleşme: contracts/domains/moderation.ts
// (admin.media.list, admin.media.decide). Yetki KV-04: media.queue.read (kuyruk kapsamı), media.review
// (görselin topluluğu DB'den okunur; moderatör yalnız atandığı topluluktaki görseli karara bağlar).
//
// Depolama sırası güvenli ve tekrar denenebilirdir:
//   APPROVE: önce public'e kopyala, sonra DB. DB kararı hata/conflict verirse bu isteğin public kopyası silinir.
//   REJECT : public anahtar karar öncesi ve karar sonrası idempotent silinir. İkinci silme, eşzamanlı APPROVE'ın
//            ilk silmeden sonra oluşturduğu kopyayı da temizler. Tekrar REJECT (unchanged) de temizliği yeniden dener.
//
// İz (KV-39): karar `moderation_actions`'a ve audit_logs'a (media.review), yasak ekleme/silme audit_logs'a
// (media.ban.manage), önizleme URL'i alan her görsel erişimi audit_logs'a (media.queue.read / preview) yazılır;
// hepsi mutasyonla aynı transaction'da, önizleme audit'i URL'ler döndürülmeden önce.
import { ApiError } from "../../http/errors.ts";
import { decodeCursor, encodeCursor } from "../../http/cursor.ts";
import type { Route } from "../../http/route.ts";
import { publicObjectKeyFor, type MediaStorage } from "./storage.ts";
import type { BanRecord, MediaStore } from "./store.ts";
import { toMediaView } from "./view.ts";

export type MediaAdminDeps = { store: MediaStore; storage: MediaStorage; now: () => Date; mediaPublicBaseUrl: string };

const notFound = () => new ApiError("NOT_FOUND", "Görsel bulunamadı.");

const conflict = (message: string, code: string) => new ApiError("CONFLICT", message, [{ code }]);

const CONFLICT_MESSAGES = {
  no_processed_copy: "Görselin işlenmiş kopyası yok.",
  not_reviewable: "Görselin durumu bu kararı uygulamaya elverişli değil.",
  banned: "Yasaklı görsel onaylanamaz; önce yasağı kaldırın.",
} as const;

export function registerMediaAdminRoutes(route: Route, deps: MediaAdminDeps): void {
  const { store, storage, mediaPublicBaseUrl } = deps;

  route("admin.media.list", async ({ query, moderationScope, viewer, request }) => {
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
    // Önizleme URL'i alan her görselin erişimi audit'e yazılır (KV-08 §7); yazılamazsa URL'ler dönmez.
    await store.recordPreviews({ mediaIds: data.filter((v) => v.preview).map((v) => v.id), actorId: viewer!.id, requestId: request.id, now });
    return { status: 200, body: { data, page: { nextCursor, hasMore: nextCursor !== null } } };
  });

  route("admin.media.decide", async ({ params, body, viewer, authorize, moderationScope, request }) => {
    const media = await store.findForReview(params.id);
    if (!media) throw notFound();
    await authorize({ communityId: media.communityId });

    if (media.status === "PENDING") throw conflict("Görsel henüz işleniyor.", "still_processing");
    const publicKey = publicObjectKeyFor(media.id);
    if (body.decision === "APPROVE" && media.banned) throw conflict("Yasaklı görsel onaylanamaz; önce yasağı kaldırın.", "banned");

    if (body.decision === "APPROVE" && media.status !== "APPROVED") {
      if (media.processedObjectKey === null) throw conflict("Görselin işlenmiş kopyası yok.", "no_processed_copy");
      await storage.publishFromPrivate(media.processedObjectKey, publicKey);
    }

    // REJECT'te ilk silme, zaten yayında olan nesnenin DB kararı uygulanmadan önce kapatılmasını sağlar.
    // Status'u kilitsiz okumaya bağlamıyoruz: yarışta APPROVE sonradan kopyalayabilir, aşağıdaki ikinci silme onu yakalar.
    if (body.decision === "REJECT") await storage.deletePublic(media.publicObjectKey ?? publicKey);

    let result: Awaited<ReturnType<MediaStore["applyDecision"]>>;
    try {
      result = await store.applyDecision({ id: media.id, actorId: viewer!.id, decision: body.decision, reason: body.reason, now: deps.now(), requestId: request.id });
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
      throw conflict(CONFLICT_MESSAGES[result.reason], result.reason);
    }

    // Kritik yarış koruması: REJECT kararı kilidi aldıktan önce/sonra eşzamanlı APPROVE public'e kopyalamış olabilir.
    // Silme idempotenttir; unchanged REJECT de stale public nesneyi temizler. Hata olursa 500 dönerek tekrar denemeyi sağlar.
    if (body.decision === "REJECT") await storage.deletePublic(publicKey);

    const scope = await moderationScope();
    const view = await toMediaView(result.media, storage, mediaPublicBaseUrl, deps.now(), { previewRejected: scope.all });
    if (view.preview) await store.recordPreviews({ mediaIds: [view.id], actorId: viewer!.id, requestId: request.id, now: deps.now() });
    return { status: 200, body: { data: view } };
  });

  // ── Yasaklı görsel listesi (KV-38, #40): yetki media.ban.manage (ADMIN+), kaynağa bağlı kural yoktur ──
  const banView = (b: BanRecord) => ({
    id: b.id,
    sourceMediaId: b.sourceMediaId,
    reason: b.reason,
    matchesExact: b.matchesExact,
    matchesSimilar: b.matchesSimilar,
    createdBy: {
      id: b.createdBy.id,
      username: b.createdBy.username,
      displayName: b.createdBy.displayName,
      avatarUrl: b.createdBy.avatarPublicKey ? `${mediaPublicBaseUrl}/${b.createdBy.avatarPublicKey}` : null,
    },
    createdAt: b.createdAt.toISOString(),
  });

  route("admin.media.bans.list", async ({ query }) => {
    const at = decodeCursor(query.cursor, "admin.media.bans.list");
    const rows = await store.listBans(at ? { createdAt: new Date(at.keys[0] as string), id: at.id } : null, query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor = rows.length > query.limit && last ? encodeCursor("admin.media.bans.list", [last.createdAt.toISOString()], last.id) : null;
    return { status: 200, body: { data: page.map(banView), page: { nextCursor, hasMore: nextCursor !== null } } };
  });

  route("admin.media.bans.create", async ({ body, viewer, request }) => {
    const result = await store.createBan({ mediaId: body.mediaId, actorId: viewer!.id, reason: body.reason, requestId: request.id, now: deps.now() });
    if (result.kind === "not_found") throw notFound();
    if (result.kind === "conflict") {
      throw conflict(
        result.reason === "not_rejected" ? "Yalnız reddedilmiş görsel yasaklanabilir; önce reddedin." : "Görselin parmak izi yok; yasaklanamaz.",
        result.reason,
      );
    }
    return { status: result.kind === "created" ? 201 : 200, body: { data: banView(result.ban) } };
  });

  route("admin.media.bans.delete", async ({ params, viewer, request }) => {
    await store.deleteBan({ id: params.id, actorId: viewer!.id, requestId: request.id, now: deps.now() });
    return { status: 204, body: null };
  });
}

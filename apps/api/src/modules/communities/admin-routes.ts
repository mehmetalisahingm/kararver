// Topluluk yönetimi — KV-32 (#34). Sözleşme: packages/contracts/src/domains/communities.ts (admin.communities.*)
// Yetki KV-04: community.create / community.update / community.moderator.assign → ADMIN+ (router kapısı);
// kaynağa bağlı kural yoktur. Moderatörlük community_memberships.role'den her istekte okunur (rbac/prisma-store.ts),
// bu yüzden atama ve kaldırma açık oturumda bir sonraki istekte etkilidir.
//
// Kapatma (status=HIDDEN): topluluk public liste/sayfadan, katılımdan ve yeni anket açmaktan çıkar; üyelikler,
// anketler ve moderatör rolleri silinmez, geri açılınca olduğu gibi döner.
//
// İz (KV-39): açma, düzenleme/kapatma (yalnız değişen alanlar önce/sonra olarak, gerekçeyle) ve moderatör atama/kaldırma
// audit_logs'a işlemle aynı transaction'da yazılır; değişiklik olmayan idempotent çağrı iz bırakmaz. Sözleşmede
// kapatılmış topluluğu listeleyen bir admin okuma endpoint'i yok; yönetici kapatılmış topluluğu kimliğiyle PATCH eder.
import { ApiError } from "../../http/errors.ts";
import { idempotencyKeyReused, readIdempotencyScope } from "../../http/idempotency.ts";
import type { Route } from "../../http/route.ts";
import type { CommunityRejection, CommunityStore } from "./store.ts";
import { toDetail } from "./view.ts";

export type CommunityAdminDeps = { store: CommunityStore; now: () => Date; mediaPublicBaseUrl: string };

const notFound = () => new ApiError("NOT_FOUND", "Topluluk bulunamadı.");

function rejection(reason: CommunityRejection): ApiError {
  if (reason === "slug_taken") return new ApiError("CONFLICT", "Bu slug başka bir toplulukta kullanılıyor.", [{ field: "slug", code: "taken" }]);
  // Sözleşmede MEDIA_NOT_USABLE bu endpoint için tanımlı değil; geçersiz alan olarak 400.
  return new ApiError("VALIDATION_ERROR", "Bu görsel topluluk görseli olarak kullanılamaz.", [{ field: "imageMediaId", code: "not_usable" }]);
}

export function registerCommunityAdminRoutes(route: Route, deps: CommunityAdminDeps): void {
  const { store, now } = deps;

  /** Yönetici görünümü: kapatılmış topluluk da döner; viewer.role yöneticinin üyeliğidir (çoğunlukla null). */
  async function detail(id: string, viewerId: string) {
    const community = await store.findAnyById(id);
    if (!community) throw notFound();
    return toDetail(community, { role: await store.roleOf(id, viewerId) }, deps.mediaPublicBaseUrl);
  }

  route("admin.communities.create", async ({ body, viewer, request }) => {
    const scope = readIdempotencyScope(request, { userId: viewer!.id, route: "admin.communities.create", body, now: now(), required: false });
    const result = await store.createCommunity(
      scope,
      {
        slug: body.slug,
        name: body.name,
        description: body.description || null,
        imageMediaId: body.imageMediaId ?? null,
        membersVisibility: body.membersVisibility,
      },
      viewer!.id,
      { actorId: viewer!.id, requestId: request.id, now: now() },
    );
    if (result.kind === "key_reused") throw idempotencyKeyReused();
    if (result.kind === "rejected") throw rejection(result.reason);
    return { status: 201, body: { data: await detail(result.id, viewer!.id) } };
  });

  route("admin.communities.update", async ({ params, body, viewer, request }) => {
    const { reason, description, ...rest } = body;
    const outcome = await store.updateCommunity(
      params.id,
      {
        ...rest,
        // Boş açıklama göndermek açıklamayı temizler.
        ...(description !== undefined && { description: description || null }),
      },
      { actorId: viewer!.id, requestId: request.id, now: now(), reason },
    );
    if (outcome === "NOT_FOUND") throw notFound();
    if (outcome !== "OK") throw rejection(outcome);
    return { status: 200, body: { data: await detail(params.id, viewer!.id) } };
  });

  route("admin.communities.moderators.put", async ({ params, body, viewer, request }) => {
    const outcome = await store.assignModerator(params.id, params.userId, { actorId: viewer!.id, requestId: request.id, now: now(), reason: body.reason });
    if (outcome === "COMMUNITY_NOT_FOUND") throw notFound();
    if (outcome === "USER_NOT_FOUND") throw new ApiError("NOT_FOUND", "Kullanıcı bulunamadı.");
    return { status: 200, body: { data: { role: "MODERATOR" } } };
  });

  route("admin.communities.moderators.delete", async ({ params, viewer, request }) => {
    if ((await store.removeModerator(params.id, params.userId, { actorId: viewer!.id, requestId: request.id, now: now() })) === "COMMUNITY_NOT_FOUND") throw notFound();
    return { status: 204, body: null };
  });
}

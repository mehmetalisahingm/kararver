// KV-25 (#27) — kaynak ölçümlü, kişisel veri taşımayan paylaşım bağlantısı.
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { ShareStore } from "./store.ts";

export function registerShareRoutes(route: Route, deps: { store: ShareStore; webUrl: string }): void {
  route("shares.create", async ({ params, body }) => {
    const share = await deps.store.create(params.id, body.channel);
    if (!share) throw new ApiError("NOT_FOUND", "İçerik bulunamadı.");

    const url = new URL(share.canonicalPath, deps.webUrl);
    // Kaynak etiketi opaktır; kullanıcı/session/e-posta gibi veri URL'ye yazılmaz.
    url.searchParams.set("src", share.id);
    return {
      status: 201,
      body: { data: { shareId: share.id, url: url.toString() } },
    };
  });
}

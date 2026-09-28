// Hesap sahibinin kendi profili — KV-09 (#11). Herkese açık profil sayfası profiles modülündedir (Mehmet, KV-22).
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { AuthStore } from "../auth/store.ts";
import { toMe } from "./me.ts";

export function registerUserRoutes(route: Route, deps: { store: AuthStore; mediaPublicBaseUrl: string }): void {
  const { store, mediaPublicBaseUrl } = deps;

  route("me.get", async ({ viewer }) => ({ status: 200, body: { data: toMe(viewer!.user, mediaPublicBaseUrl) } }));

  route("me.update", async ({ viewer, body }) => {
    if (body.avatarMediaId && !(await store.isUsableAvatar(viewer!.id, body.avatarMediaId))) {
      throw new ApiError("MEDIA_NOT_USABLE", "Bu görsel profil fotoğrafı olarak kullanılamaz.", [{ field: "avatarMediaId", code: "not_usable" }]);
    }
    const user = await store.updateProfile(viewer!.id, {
      displayName: body.displayName,
      bio: body.bio === "" ? null : body.bio,
      avatarMediaId: body.avatarMediaId,
    });
    return { status: 200, body: { data: toMe(user, mediaPublicBaseUrl) } };
  });
}

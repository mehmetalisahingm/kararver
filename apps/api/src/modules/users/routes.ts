// Hesap sahibinin kendi profili — KV-09 (#11). Herkese açık profil sayfası profiles modülündedir (Mehmet, KV-22).
import { decodeCursor, encodeCursor, invalidCursor } from "../../http/cursor.ts";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { AuthStore } from "../auth/store.ts";
import { toMe, type RolesOf } from "./me.ts";

const POINTS_LEDGER_CURSOR = "points-ledger:v1";

export function registerUserRoutes(route: Route, deps: { store: AuthStore; mediaPublicBaseUrl: string; rolesOf: RolesOf; publishCost?: () => Promise<number>; emailVerificationRequired?: boolean }): void {
  const { store, mediaPublicBaseUrl, rolesOf } = deps;

  route("me.get", async ({ viewer }) => ({ status: 200, body: { data: toMe(viewer!.user, mediaPublicBaseUrl, await rolesOf(viewer!.id), deps.emailVerificationRequired) } }));

  route("me.update", async ({ viewer, body }) => {
    if (body.avatarMediaId && !(await store.isUsableAvatar(viewer!.id, body.avatarMediaId))) {
      throw new ApiError("MEDIA_NOT_USABLE", "Bu görsel profil fotoğrafı olarak kullanılamaz.", [{ field: "avatarMediaId", code: "not_usable" }]);
    }
    const user = await store.updateProfile(viewer!.id, {
      displayName: body.displayName,
      bio: body.bio === "" ? null : body.bio,
      avatarMediaId: body.avatarMediaId,
    });
    return { status: 200, body: { data: toMe(user, mediaPublicBaseUrl, await rolesOf(user.id), deps.emailVerificationRequired) } };
  });

  route("points.get", async ({ viewer }) => {
    const summary = await store.getPointsSummary(viewer!.id, deps.publishCost ? await deps.publishCost() : undefined);
    return { status: 200, body: { data: summary } };
  });

  route("points.ledger", async ({ viewer, query }) => {
    const cursor = decodeCursor(query.cursor, POINTS_LEDGER_CURSOR);
    let after: { createdAt: Date; id: string } | null = null;
    if (cursor) {
      const [rawDate] = cursor.keys;
      if (cursor.keys.length !== 1 || typeof rawDate !== "string") throw invalidCursor();
      const createdAt = new Date(rawDate);
      if (Number.isNaN(createdAt.getTime())) throw invalidCursor();
      after = { createdAt, id: cursor.id };
    }

    const rows = await store.listPointLedger(viewer!.id, after, query.limit + 1);
    const hasMore = rows.length > query.limit;
    const data = rows.slice(0, query.limit);
    const last = data.at(-1);
    return {
      status: 200,
      body: {
        data: data.map((entry) => ({
          id: entry.id,
          delta: entry.delta,
          balanceAfter: entry.balanceAfter,
          reason: entry.reason,
          referenceId: entry.referenceId,
          createdAt: entry.createdAt.toISOString(),
        })),
        page: {
          hasMore,
          nextCursor: hasMore && last ? encodeCursor(POINTS_LEDGER_CURSOR, [last.createdAt.toISOString()], last.id) : null,
        },
      },
    };
  });
}

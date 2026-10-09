import type { Route } from "../../http/route.ts";
import { readIdempotencyScope } from "../../http/idempotency.ts";
import type { PointAdminStore } from "./admin-store.ts";

export function registerPointAdminRoutes(route: Route, deps: { store: PointAdminStore; now: () => Date }): void {
  route("admin.points.adjust", async ({ body, params, viewer, request }) => {
    const now = deps.now();
    const scope = readIdempotencyScope(request, {
      userId: viewer!.id,
      route: "admin.points.adjust",
      body,
      now,
      required: true,
    })!;
    const entry = await deps.store.adjust({
      targetUserId: params.id,
      delta: body.delta,
      reason: body.reason,
      actorId: viewer!.id,
      requestId: request.id,
      now,
      scope,
    });
    return {
      status: 201,
      body: {
        data: {
          ...entry,
          createdAt: entry.createdAt.toISOString(),
        },
      },
    };
  });
}

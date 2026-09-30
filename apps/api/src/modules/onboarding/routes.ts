// KV-15 (#17) — ilgi seçimi / onboarding API.
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { OnboardingStore } from "./store.ts";

export function registerOnboardingRoutes(route: Route, store: OnboardingStore): void {
  route("interests.get", async ({ viewer }) => ({
    status: 200,
    body: { data: { categoryIds: await store.list(viewer!.id) } },
  }));

  route("interests.put", async ({ viewer, body }) => {
    const result = await store.replace(viewer!.id, body.categoryIds);
    if (!result.ok) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Seçilen kategorilerden biri kullanılamıyor.",
        [{ field: "body.categoryIds", code: "inactive_or_unknown" }],
      );
    }
    return { status: 200, body: { data: { categoryIds: result.categoryIds } } };
  });
}

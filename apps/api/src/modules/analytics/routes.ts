// KV-36 (#38): yalnız ADMIN+ görebilen gerçek ürün dashboard'u.
// Yetki sözleşmedeki metrics.read üzerinden router kapısında uygulanır.
import type { Route } from "../../http/route.ts";
import type { AnalyticsStore } from "./store.ts";

export function registerAnalyticsRoutes(route: Route, deps: { store: AnalyticsStore; now: () => Date }): void {
  route("admin.metrics.get", async ({ query }) => {
    const metrics = await deps.store.snapshot(query.range, deps.now());
    return {
      status: 200,
      body: {
        data: {
          ...metrics,
          generatedAt: metrics.generatedAt.toISOString(),
        },
      },
    };
  });
}

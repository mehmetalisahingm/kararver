import type { Route } from "../../http/route.ts";
import type { MetricsStore } from "./store.ts";

export function registerMetricsRoutes(route: Route, deps: { store: MetricsStore }): void {
  route("admin.metrics.get", async ({ query }) => ({ status: 200, body: { data: await deps.store.get(query.range as "7d" | "30d") } }));
}

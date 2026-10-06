import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { Decision, DecisionStore } from "./store.ts";
const view = (d: Decision) => ({ ...d, updatedAt: d.updatedAt.toISOString() });
export function registerDecisionRoutes(route: Route, deps: { store: DecisionStore; now: () => Date }) {
 route("decisions.get", async ({ params, viewer }) => {
  const state = await deps.store.get(params.id, viewer?.id ?? null);
  if (!state) throw new ApiError("NOT_FOUND", "İçerik bulunamadı.");
  return { status: 200, body: { data: { ...state, decision: state.decision ? view(state.decision) : null } } };
 });
 for (const following of [true, false]) route(following ? "follows.put" : "follows.delete", async ({ params, viewer }) => {
  await deps.store.follow(params.id, viewer!.id, following);
  return { status: 200, body: { data: { following } } };
 });
 route("decisions.put", async ({ params, viewer, body, authorize }) => ({ status: 200,
 body: { data: view(await deps.store.put(params.id, viewer!.id, body, deps.now(), authorize)) } }));
}

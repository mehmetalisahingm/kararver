import type { Route } from "../../http/route.ts";
import { buildOpsStatus, type OpsStatusDeps } from "./status.ts";

/** KV-186 (#186) `admin.ops.status`: yalnız SUPER_ADMIN (`ops.read`); yetki router'daki RBAC kapısındadır. */
export function registerOpsRoutes(route: Route, deps: OpsStatusDeps): void {
  route("admin.ops.status", async () => ({ status: 200, body: { data: await buildOpsStatus(deps) } }));
}

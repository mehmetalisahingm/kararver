// Sistem ayarı endpoint'leri — KV-40 (#42). Sözleşme: contracts/domains/admin.ts (config.get, admin.settings.*,
// admin.emergency.put). Yetki KV-04: settings.read (ADMIN), settings.update ve emergency.update (SUPER_ADMIN).
//
// Her değişiklik sürümü artırır (iyimser kilit: eski sürüm 409 VERSION_CONFLICT), tip/aralık contracts kayıt defteriyle
// doğrulanır (bilinmeyen anahtar 404, geçersiz değer 400) ve audit'e (settings.update / emergency.update) aynı
// transaction'da yazılır. Değişiklik bu süreçte anında, diğer API süreçlerinde en geç önbellek ömrü (5 sn) sonra etkilidir.
import { emergencySwitchSettings, parseSettingValue, type SettingKey } from "@kararver/contracts";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import { toPublicUser } from "../admin-users/view.ts";
import type { SettingsService } from "./service.ts";
import type { StoredSetting } from "./store.ts";

export type SettingsDeps = { service: SettingsService; mediaPublicBaseUrl: string };

/** Public config cache süresi (sözleşme: ≤ 60 sn). Acil durum anahtarı en fazla bu kadar gecikmeyle istemciye ulaşır. */
const PUBLIC_CONFIG_MAX_AGE_SECONDS = 30;

export function registerSettingsRoutes(route: Route, deps: SettingsDeps): void {
  const { service } = deps;
  const base = deps.mediaPublicBaseUrl;

  const view = (s: StoredSetting) => ({
    key: s.key,
    value: s.value,
    version: s.version,
    updatedAt: s.updatedAt.toISOString(),
    updatedBy: s.updatedBy ? toPublicUser(s.updatedBy, base) : null,
  });

  route("config.get", async ({ reply }) => {
    reply.header("Cache-Control", `public, max-age=${PUBLIC_CONFIG_MAX_AGE_SECONDS}`);
    return { status: 200, body: { data: await service.publicConfig() } };
  });

  route("admin.settings.list", async () => ({ status: 200, body: { data: (await service.list()).map(view) } }));

  route("admin.settings.update", async ({ params, body, viewer, request }) => {
    const checked = parseSettingValue(params.key, body.value);
    if (!checked.ok) {
      throw new ApiError(checked.code, checked.message, checked.code === "VALIDATION_ERROR" ? [{ field: "value", code: "invalid", message: checked.message }] : []);
    }
    const outcome = await service.update({
      key: params.key as SettingKey,
      value: checked.value,
      version: body.version,
      reason: body.reason,
      actorId: viewer!.id,
      requestId: request.id,
    });
    switch (outcome.kind) {
      case "conflict":
        throw new ApiError("VERSION_CONFLICT", "Ayar başka biri tarafından değiştirilmiş; güncel değeri görüp tekrar deneyin.", [
          { field: "version", code: "stale", message: `Güncel sürüm: ${outcome.current.version}` },
        ]);
      case "invalid":
        throw new ApiError("VALIDATION_ERROR", outcome.message, [{ field: "value", code: "conflicts_with_other_setting", message: outcome.message }]);
      default:
        return { status: 200, body: { data: view(outcome.setting) } };
    }
  });

  route("admin.emergency.put", async ({ body, viewer, request }) => {
    const changes: Partial<Record<SettingKey, boolean>> = {};
    for (const [name, value] of Object.entries(body.switches) as [keyof typeof emergencySwitchSettings, boolean][]) {
      changes[emergencySwitchSettings[name]] = value;
    }
    await service.putEmergency({ changes, reason: body.reason, actorId: viewer!.id, requestId: request.id });
    const v = await service.values();
    return {
      status: 200,
      body: {
        data: {
          registration: v["features.registration"] as boolean,
          pollCreation: v["features.pollCreation"] as boolean,
          comments: v["features.comments"] as boolean,
          uploads: v["features.uploads"] as boolean,
          maintenance: v["maintenance.enabled"] as boolean,
        },
      },
    };
  });
}

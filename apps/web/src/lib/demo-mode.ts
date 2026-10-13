// KV-06 / #187: demo verisi ve sahte yönetici yolları yalnız açıkça izinli ortamda açılır. Liste dışındaki her APP_ENV
// (tanımsız, staging, production, yazım hatası) ve Vercel production dağıtımı demo'yu reddeder. Aynı kural build'de
// (next.config.ts) ve sunucu açılışında (instrumentation.ts) uygulanır.

export const DEMO_APP_ENVS: readonly string[] = Object.freeze(["local", "preview"]);

export type DemoModeEnv = {
  NEXT_PUBLIC_KV_DATA_MODE?: string;
  APP_ENV?: string;
  VERCEL_ENV?: string;
};

/** Demo bu ortamda yasaksa hata mesajı, değilse null. Demo modu kapalıysa her ortamda null. */
export function demoModeViolation(env: DemoModeEnv): string | null {
  if (env.NEXT_PUBLIC_KV_DATA_MODE !== "demo") return null;
  if (env.VERCEL_ENV === "production") {
    return "NEXT_PUBLIC_KV_DATA_MODE=demo VERCEL_ENV=production dağıtımında kullanılamaz (KV-06, #187)";
  }
  const appEnv = env.APP_ENV ?? "";
  if (!DEMO_APP_ENVS.includes(appEnv)) {
    return `NEXT_PUBLIC_KV_DATA_MODE=demo APP_ENV=${appEnv || "(tanımsız)"} ortamında kullanılamaz (KV-06, #187); demo yalnız APP_ENV=${DEMO_APP_ENVS.join(" veya ")} ile açılır`;
  }
  return null;
}

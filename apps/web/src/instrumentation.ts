import { demoModeViolation } from "./lib/demo-mode.ts";

/** Log aramasında sabit olay adı (docs/KV-49_OPERATIONS.md "İzleme ve alarm"): görülürse yanlış build deploy edilmiştir. */
export const DEMO_MODE_FORBIDDEN = "demo_mode_forbidden";

/**
 * #187: sunucu açılışında demo sınırı. Build koruması (next.config.ts) atlatılmış ya da demo build'i staging/production
 * ortamında başlatılmışsa sunucu hiçbir sayfa sunmaz: Next her isteğe 500 döner. Süreç bilerek kapatılmaz
 * (process.exit Vercel serverless'ta belirsiz); asıl kat build korumasıdır. NEXT_PUBLIC_KV_DATA_MODE build'de koda
 * gömülür (açık erişim bu yüzden); APP_ENV ve VERCEL_ENV çalışma anındaki değerdir.
 */
export function register() {
  const env = {
    NEXT_PUBLIC_KV_DATA_MODE: process.env.NEXT_PUBLIC_KV_DATA_MODE,
    APP_ENV: process.env.APP_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
  const violation = demoModeViolation(env);
  if (!violation) return;
  console.error(
    JSON.stringify({
      level: "fatal",
      event: DEMO_MODE_FORBIDDEN,
      appEnv: env.APP_ENV ?? null,
      vercelEnv: env.VERCEL_ENV ?? null,
      dataMode: env.NEXT_PUBLIC_KV_DATA_MODE,
      message: violation,
    }),
  );
  throw new Error(`Web sunucusu başlatılmadı → ${violation}`);
}

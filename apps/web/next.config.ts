import type { NextConfig } from "next";

/**
 * KV-49 (#51) güvenlik başlıkları. Hiçbir kaynağı kısıtlamayan, kırılma riski olmayan set: çerçeveleme yasağı
 * (clickjacking), MIME tahmini kapalı, base/form/object sınırı, referrer ve tarayıcı izinleri. Script/görsel kısıtlayan
 * sıkı CSP (nonce veya SRI) ayrı iş: görseller API alan adından gelir ve canlıda denenmeden açılmamalı.
 */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  devIndicators: false,
  // Browser uses NEXT_PUBLIC_API_URL=/api; this rewrite keeps session requests same-origin.
  async rewrites() {
    const apiUrl = process.env.API_URL?.replace(/\/$/, "");
    if (!apiUrl) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

// KV-06: demo verisi staging/production'a taşınmaz. `next build` her zaman NODE_ENV=production verdiği için
// ölçüt APP_ENV'dir; APP_ENV yok/local/preview iken demo build'e izin verilir.
export default (): NextConfig => {
  if (process.env.NEXT_PUBLIC_KV_DATA_MODE === "demo" && ["production", "staging"].includes(process.env.APP_ENV ?? ""))
    throw new Error(`NEXT_PUBLIC_KV_DATA_MODE=demo APP_ENV=${process.env.APP_ENV} ortamında kullanılamaz (KV-06)`);
  return config;
};

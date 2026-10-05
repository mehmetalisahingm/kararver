import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
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

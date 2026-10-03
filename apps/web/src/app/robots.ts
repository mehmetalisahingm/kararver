import type { MetadataRoute } from "next";
import { webBaseUrl } from "../lib/server-public-polls";

export default function robots(): MetadataRoute.Robots {
  const production = process.env.APP_ENV === "production";
  const base = webBaseUrl();
  if (!production) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/hesap", "/bildirimler", "/giris", "/kayit", "/dogrula", "/sifre-sifirla", "/olustur"],
    },
    sitemap: new URL("/sitemap.xml", base).toString(),
  };
}

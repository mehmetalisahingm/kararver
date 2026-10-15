import type { MetadataRoute } from "next";
import { webBaseUrl } from "../lib/server-public-polls";
import { privatePaths } from "../lib/seo";

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
      disallow: privatePaths,
    },
    sitemap: new URL("/sitemap.xml", base).toString(),
  };
}

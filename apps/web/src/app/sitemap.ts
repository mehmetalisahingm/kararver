import type { MetadataRoute } from "next";
import { loadSitemapPolls, webBaseUrl } from "../lib/server-public-polls";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (process.env.APP_ENV !== "production") return [];
  const base = webBaseUrl();
  const polls = await loadSitemapPolls();
  return [
    { url: base.toString(), changeFrequency: "daily", priority: 1 },
    { url: new URL("/kesfet", base).toString(), changeFrequency: "hourly", priority: 0.9 },
    ...polls.map((poll) => ({
      url: new URL(`/karar/${poll.slug}-${poll.publicId}`, base).toString(),
      lastModified: new Date(poll.createdAt),
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
  ];
}

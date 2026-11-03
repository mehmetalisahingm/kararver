import type { Metadata } from "next";
import { legalRevision } from "./model";
import { publishedLegalBundle } from "./published";

export function legalMetadata(slug: string, version?: string): Metadata {
  const resolved = legalRevision(publishedLegalBundle(), slug, version);
  if (!resolved) return { title: "Sayfa bulunamadı · Kararver", robots: { index: false, follow: false } };
  const title = `${resolved.revision.title} · Sürüm ${resolved.revision.version} · Kararver`;
  return { title, alternates: { canonical: `/yasal/${slug}${version ? `/${version}` : ""}` } };
}

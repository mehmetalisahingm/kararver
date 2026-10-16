import type { Metadata } from "next";

export const privateMetadata: Metadata = { robots: { index: false, follow: false } };

export function publicRobots() {
  const enabled = process.env.APP_ENV === "production";
  return { index: enabled, follow: enabled };
}

export const privatePaths = [
  "/admin", "/hesap", "/bildirimler", "/giris", "/kayit", "/dogrula",
  "/sifremi-unuttum", "/sifre-yenile", "/veri-indir", "/ilgi-alanlari", "/olustur",
];

/**
 * #52: X and WhatsApp share the same server-rendered public summary.
 * A missing/removed poll never calls this helper (the page sends noindex instead).
 * Images are optional: do not advertise an unapproved or non-existent fallback.
 */
export function pollShareMetadata(input: {
  title: string;
  description: string;
  canonical: string;
  imageUrl?: string | null;
}): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: {
      type: "article",
      url: input.canonical,
      siteName: "Kararver",
      locale: "tr_TR",
      title: input.title,
      description: input.description,
      ...(input.imageUrl ? { images: [{ url: input.imageUrl, alt: input.title }] } : {}),
    },
    twitter: {
      card: input.imageUrl ? "summary_large_image" : "summary",
      title: input.title,
      description: input.description,
      ...(input.imageUrl ? { images: [input.imageUrl] } : {}),
    },
  };
}

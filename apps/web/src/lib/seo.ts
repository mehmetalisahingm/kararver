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

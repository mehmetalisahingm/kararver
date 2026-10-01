// Anket URL'i: /karar/<slug>-<publicId> (API_CONTRACTS.md §4.2). Slug sadece okunabilirlik
// içindir; kimlik publicId'dir.
import { randomInt } from "node:crypto";

const TR_MAP: Record<string, string> = { ş: "s", ı: "i", ğ: "g", ç: "c", ö: "o", ü: "u" };
const MAX_SLUG = 80;
const PUBLIC_ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // karışan karakterler (l, o, 0, 1) yok
export const PUBLIC_ID_LENGTH = 8;

export function slugify(title: string): string {
  const ascii = title
    .toLocaleLowerCase("tr")
    .replace(/[şığçöü]/g, (c) => TR_MAP[c]!)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  const slug = ascii.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length <= MAX_SLUG) return slug || "karar";
  const cut = slug.slice(0, MAX_SLUG);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > MAX_SLUG / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/, "");
}

export function newPublicId(): string {
  let id = "";
  for (let i = 0; i < PUBLIC_ID_LENGTH; i++) id += PUBLIC_ID_ALPHABET[randomInt(PUBLIC_ID_ALPHABET.length)];
  return id;
}

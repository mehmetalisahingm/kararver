// Oturum cookie'si için küçük okuma/yazma yardımcıları (TECH_DECISIONS.md §3.4).

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      return value || null;
    }
  }
  return null;
}

export type CookieOptions = { domain: string | null; secure: boolean; maxAgeSeconds: number };

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${options.maxAgeSeconds}`];
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

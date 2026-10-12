import { isIP } from "node:net";

/** Admin görünümleri tam IP veya serbest biçimli cihaz tanımlayıcıları taşımaz. */
export function sessionNetwork(address: string | null): string | null {
  if (!address) return null;
  const ip = address.split("%")[0]!;
  if (isIP(ip) === 4) return `${ip.split(".").slice(0, 3).join(".")}.0/24`;
  if (isIP(ip) !== 6) return null;
  if (/^::ffff:/i.test(ip) && isIP(ip.slice(7)) === 4) return sessionNetwork(ip.slice(7));
  // Expand only the prefix; compressed zeros before the third hextet still belong to /48.
  const [head, tail] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8-left.length-right.length)).fill("0"), ...right];
  return `${groups.slice(0, 3).map(group => Number.parseInt(group, 16).toString(16)).join(":")}::/48`;
}

export function sessionDevice(agent: string | null): string | null {
  if (!agent?.trim()) return null;
  const browser = /Edg(?:e|A|iOS)?\//.test(agent) ? "Edge" : /(?:Firefox|FxiOS)\//.test(agent) ? "Firefox" : /(?:Chrome|CriOS)\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Diğer tarayıcı";
  const os = /Android/.test(agent) ? "Android" : /iPhone|iPad|iPod/.test(agent) ? "iOS" : /Windows/.test(agent) ? "Windows" : /Macintosh|Mac OS X/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "Diğer cihaz";
  return `${browser} · ${os}`;
}

export function sessionView(session: { id: string; createdAt: Date; expiresAt: Date; lastSeenAt: Date | null; ipAddress: string | null; userAgent: string | null }) {
  return {
    id: session.id, createdAt: session.createdAt.toISOString(), expiresAt: session.expiresAt.toISOString(), lastSeenAt: session.lastSeenAt?.toISOString() ?? null,
    ipAddress: sessionNetwork(session.ipAddress), userAgent: sessionDevice(session.userAgent),
  };
}

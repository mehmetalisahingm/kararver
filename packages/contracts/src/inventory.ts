// docs/API_CONTRACTS.md içindeki envanter ve "açtığı iş" tablolarını registry'den üretir.
// Belge elle düzenlenmez: `pnpm --filter @kararver/contracts docs` ile yenilenir; test farkı yakalar.
import type { Auth, EndpointContract, Idempotency } from "./endpoint.ts";

const domainTitles: Record<string, string> = {
  auth: "Auth ve hesap",
  polls: "Anket / tartışma, oy, tepki",
  comments: "Yorum ve alternatif öneri",
  discovery: "Keşif: feed, arama, kategori, trend",
  growth: "Profil, kaydetme, takip, karar, paylaşım, puan",
  media: "Medya",
  moderation: "Rapor ve moderasyon",
  communities: "Topluluklar",
  notifications: "Bildirimler",
  admin: "Platform ve admin",
};

const authLabel: Record<Auth, string> = {
  public: "G",
  user: "U",
  verified: "V",
  owner: "O",
  moderator: "M",
  admin: "A",
  super_admin: "SA",
};

const idempotencyLabel: Record<Idempotency, string> = {
  none: "—",
  natural: "doğal",
  "key-optional": "key (ops.)",
  "key-required": "**key zorunlu**",
};

const successCodes = (e: EndpointContract) => Object.keys(e.responses).join("/");

export function renderInventory(endpoints: readonly EndpointContract[]): string {
  const lines: string[] = [];
  const domains = [...new Set(endpoints.map((e) => e.domain))];
  for (const domain of domains) {
    lines.push(`### ${domainTitles[domain] ?? domain}`, "");
    lines.push("| Endpoint | Yetki | Başarı | Idempotency | Sağlayıcı | Tüketici | Açtığı iş | Durum |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const e of endpoints.filter((x) => x.domain === domain)) {
      const status = e.availability.status === "ready" ? "hazır" : `planlı — tablo ${e.availability.tableIn} migration'ı ile gelecek`;
      lines.push(
        `| \`${e.method} ${e.path}\`<br>${e.summary} · \`${e.id}\` | ${authLabel[e.auth]} | ${successCodes(e)} | ${idempotencyLabel[e.idempotency]} | ${e.provider.owner} \`${e.provider.module}\` | ${e.consumers.join(", ")} | ${e.unblocks.join(" ")} | ${status} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function renderUnblocks(endpoints: readonly EndpointContract[]): string {
  const byIssue = new Map<string, string[]>();
  for (const e of endpoints) {
    for (const issue of e.unblocks) {
      byIssue.set(issue, [...(byIssue.get(issue) ?? []), `\`${e.method} ${e.path}\``]);
    }
  }
  const issues = [...byIssue.keys()].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const lines = ["| Issue | Sözleşmesi hazır endpointler |", "|---|---|"];
  for (const issue of issues) lines.push(`| ${issue} | ${[...new Set(byIssue.get(issue))].join(", ")} |`);
  return lines.join("\n");
}

/** Belgedeki `<!-- BEGIN:name -->` ... `<!-- END:name -->` bloğunun içeriğini değiştirir. */
export function replaceBlock(doc: string, name: string, content: string): string {
  const begin = `<!-- BEGIN:${name} -->`;
  const end = `<!-- END:${name} -->`;
  const start = doc.indexOf(begin);
  const stop = doc.indexOf(end);
  if (start === -1 || stop === -1 || stop < start) throw new Error(`Belgede ${name} bloğu bulunamadı`);
  return `${doc.slice(0, start + begin.length)}\n${content}\n${doc.slice(stop)}`;
}

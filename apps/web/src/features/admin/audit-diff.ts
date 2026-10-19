// Audit önce/sonra özetinin alan alan farkı (#185). Saf fonksiyon: ekran (audit-panel) ve testler kullanır.
// İç içe nesneler nokta yoluyla düzleşir (ör. settings.flags.comments); diziler tek değer olarak karşılaştırılır.
// Değerler metne çevrilir; ekranda metin düğümü olarak basılır (HTML yorumlanmaz).

export type AuditDiffKind = "added" | "removed" | "changed";
export type AuditDiffRow = { path: string; kind: AuditDiffKind; before: string | null; after: string | null };

export const diffKindLabels: Record<AuditDiffKind, { label: string; mark: string }> = {
  added: { label: "Eklendi", mark: "+" },
  removed: { label: "Kaldırıldı", mark: "−" },
  changed: { label: "Değişti", mark: "~" },
};

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function flatten(value: unknown, prefix: string, out: Map<string, unknown>): void {
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    // Boş nesne de bir değerdir: { a: {} } → { a: {} } farkı kaybolmasın.
    if (entries.length === 0 && prefix) out.set(prefix, value);
    for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return;
  }
  out.set(prefix, value);
}

export const formatDiffValue = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v) ?? String(v));

/** Özet nesne değilse (null, eski kayıt) boş kabul edilir; ham JSON ekranda ayrıca gösterilir. */
export function diffAuditSummary(before: unknown, after: unknown): AuditDiffRow[] {
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  if (isPlainObject(before)) flatten(before, "", a);
  if (isPlainObject(after)) flatten(after, "", b);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  const rows: AuditDiffRow[] = [];
  for (const path of paths) {
    const inBefore = a.has(path);
    const inAfter = b.has(path);
    const left = inBefore ? formatDiffValue(a.get(path)) : null;
    const right = inAfter ? formatDiffValue(b.get(path)) : null;
    if (inBefore && inAfter) {
      if (JSON.stringify(a.get(path)) !== JSON.stringify(b.get(path))) rows.push({ path, kind: "changed", before: left, after: right });
    } else rows.push({ path, kind: inAfter ? "added" : "removed", before: left, after: right });
  }
  return rows;
}

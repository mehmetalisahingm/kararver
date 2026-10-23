import { AUDIT_EXPORT_MAX_DAYS } from "@kararver/contracts";
import type { AuditRecord, AuditSearch } from "./admin-client.ts";

export const MAX_AUDIT_EXPORT_ROWS = 1000;
export type AuditExportFormat = "csv" | "json";

/** Quote every CSV field; guard text that spreadsheet apps can interpret as a formula. */
export function auditCsvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[\s\uFEFF\u200B-\u200F]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Sunucu export'u (admin.audit.export) uygulanmış süzgeçte tarih aralığı ister; sunucu da aynı kuralla reddeder. */
export function serverExportProblem(search: AuditSearch): string | null {
  if (!search.from || !search.to) return `Sunucudan dışa aktarmak için başlangıç ve bitiş tarihiyle süz (en çok ${AUDIT_EXPORT_MAX_DAYS} gün).`;
  const span = Date.parse(search.to) - Date.parse(search.from);
  if (!(span > 0) || span > AUDIT_EXPORT_MAX_DAYS * 86_400_000) return `Sunucu export'u en çok ${AUDIT_EXPORT_MAX_DAYS} günlük aralıkta yapılır; aralığı daralt.`;
  return null;
}

/** Metni dosya olarak indirir (tarayıcıda üretilen veya sunucudan gelen export). */
export function saveTextFile(text: string, contentType: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: contentType }));
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}

export function buildAuditExport(records: readonly AuditRecord[], format: AuditExportFormat, filters: AuditSearch, now: Date) {
  if (records.length > MAX_AUDIT_EXPORT_ROWS) throw new RangeError("Audit export row limit exceeded");
  // Export the API's sanitized view using an explicit projection. No extra response fields or URLs enter the file.
  const rows = records.map(entry => ({
    id: entry.id, createdAt: entry.createdAt, source: entry.source,
    actorId: entry.actor?.id ?? null, actorUsername: entry.actor?.username ?? null,
    actorDisplayName: entry.actor?.displayName ?? null,
    action: entry.action, operation: entry.operation,
    targetType: entry.target.type, targetId: entry.target.id, reason: entry.reason,
    before: entry.before, after: entry.after, requestId: entry.requestId,
  }));
  const text = format === "json"
    ? JSON.stringify({ schemaVersion: 1, exportedAt: now.toISOString(), scope: "loaded_records", count: rows.length, filters, records: rows }, null, 2)
    : "\uFEFF" + [
      ["id", "createdAt UTC", "source", "actorId", "actorUsername", "actorDisplayName", "action", "operation", "targetType", "targetId", "reason", "before", "after", "requestId"].map(auditCsvCell).join(","),
      ...rows.map(row => Object.values(row).map(value => auditCsvCell(value && typeof value === "object" ? JSON.stringify(value) : value)).join(",")),
    ].join("\r\n");
  return { text, contentType: format === "csv" ? "text/csv;charset=utf-8" : "application/json", filename: `kararver-audit-${now.toISOString().slice(0, 10)}.${format}` };
}

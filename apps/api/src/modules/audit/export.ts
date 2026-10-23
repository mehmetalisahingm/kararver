// Audit export dosyası — #185 (admin.audit.export). Dosya sunucuda, step-up'lı okumanın sonucundan üretilir.
// Projeksiyon tarayıcıdaki "yüklenen kayıtlar" export'uyla aynıdır (apps/web/src/features/admin/audit-export.ts):
// yalnız izinli alanlar; avatar bağlantısı ve e-posta girmez, before/after redact.ts'ten geçer.
import type { AuditExportFile } from "@kararver/contracts";
import type { z } from "zod";
import { redactAuditSummary } from "./redact.ts";
import type { AuditRecord } from "./store.ts";

type Format = z.infer<typeof AuditExportFile>["format"];

const COLUMNS = ["id", "createdAt UTC", "source", "actorId", "actorUsername", "actorDisplayName", "action", "operation", "targetType", "targetId", "reason", "before", "after", "requestId"];

/** Her alan tırnaklı (RFC 4180). Tablolama programının formül sayabileceği başlangıçlara apostrof eklenir. */
export function auditCsvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[\s﻿​-‏]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

const project = (r: AuditRecord) => ({
  id: r.id,
  createdAt: r.createdAt.toISOString(),
  source: r.source,
  actorId: r.actorId,
  actorUsername: r.actor?.username ?? null,
  actorDisplayName: r.actor?.displayName ?? null,
  action: r.action,
  operation: r.operation,
  targetType: r.target.type,
  targetId: r.target.id,
  reason: r.reason,
  before: redactAuditSummary(r.before),
  after: redactAuditSummary(r.after),
  requestId: r.requestId,
});

export function buildAuditExportFile(records: readonly AuditRecord[], format: Format, scope: { from: string; to: string; filters: Record<string, unknown> }, now: Date): z.infer<typeof AuditExportFile> {
  const rows = records.map(project);
  const content =
    format === "json"
      ? JSON.stringify({ schemaVersion: 1, exportedAt: now.toISOString(), scope: "server_range", from: scope.from, to: scope.to, filters: scope.filters, count: rows.length, records: rows }, null, 2)
      : "﻿" +
        [
          COLUMNS.map(auditCsvCell).join(","),
          ...rows.map((row) => Object.values(row).map((v) => auditCsvCell(v !== null && typeof v === "object" ? JSON.stringify(v) : v)).join(",")),
        ].join("\r\n");
  return {
    format,
    filename: `kararver-audit-${scope.from.slice(0, 10)}_${scope.to.slice(0, 10)}.${format}`,
    contentType: format === "csv" ? "text/csv;charset=utf-8" : "application/json",
    count: rows.length,
    generatedAt: now.toISOString(),
    content,
  };
}

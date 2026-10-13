import assert from "node:assert/strict";
import { test } from "node:test";
import { examples } from "@kararver/contracts/fixtures";
import { auditCsvCell, buildAuditExport, MAX_AUDIT_EXPORT_ROWS } from "../src/features/admin/audit-export.ts";
import type { AuditRecord } from "../src/features/admin/admin-client.ts";

const row = (examples.find(x => x.endpoint === "admin.audit.list" && x.name === "ok")!.body as { data: AuditRecord[] }).data[0];

test("CSV neutralizes formula prefixes, whitespace escapes, quotes, commas and line breaks", () => {
  for (const text of ["=HYPERLINK(\"https://example.test\")", "+1+1", "-1+1", "@SUM(1)", "\t=1+1", " \u200B=1+1", "\rmalicious", "\nmalicious"])
    assert.ok(auditCsvCell(text).startsWith('"\''), text);
  assert.equal(auditCsvCell('Yorum, "alıntı"\nyeni satır'), '"Yorum, ""alıntı""\nyeni satır"');
});

test("audit exports are bounded, preserve UTF-8 and explicitly identify the loaded subset", () => {
  const date = new Date("2026-10-12T12:00:00Z");
  const entry = { ...row, reason: "İşlem gerekçesi", unrecognizedSecret: "never-export", actor: { ...row.actor!, avatarUrl: "https://private.test/?token=secret" } } as AuditRecord;
  const json = buildAuditExport([entry], "json", { action: row.action }, date);
  const body = JSON.parse(json.text);
  assert.equal(body.scope, "loaded_records");
  assert.equal(body.count, 1);
  assert.equal(body.filters.action, row.action);
  assert.equal(body.records[0].reason, "İşlem gerekçesi");
  assert.equal(json.text.includes("never-export"), false);
  assert.equal(json.text.includes("private.test"), false);
  const csv = buildAuditExport([entry], "csv", {}, date);
  assert.ok(csv.text.startsWith("\uFEFF"));
  assert.ok(csv.text.includes("İşlem gerekçesi"));
  assert.throws(() => buildAuditExport(Array.from({ length: MAX_AUDIT_EXPORT_ROWS + 1 }, () => row), "json", {}, date), RangeError);
});

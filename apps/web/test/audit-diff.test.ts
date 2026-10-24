// #185 audit önce/sonra alan farkı, "gerekçede ara" ekran kontrolü ve zaman dilimi gün sınırları. Saf fonksiyonlar; tarayıcı gerektirmez.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { diffAuditSummary, diffKindLabels } from "../src/features/admin/audit-diff.ts";
import { dayStart, formatAuditTime, reasonSearchProblem } from "../src/features/admin/audit-filters.ts";

describe("audit önce/sonra farkı", () => {
  test("eklendi, kaldırıldı, değişti; değişmeyen alan listelenmez; yollar sıralı", () => {
    assert.deepEqual(diffAuditSummary({ status: "ACTIVE", role: "USER", note: "x" }, { status: "SUSPENDED", role: "USER", endsAt: "2026-11-01T00:00:00.000Z" }), [
      { path: "endsAt", kind: "added", before: null, after: "2026-11-01T00:00:00.000Z" },
      { path: "note", kind: "removed", before: "x", after: null },
      { path: "status", kind: "changed", before: "ACTIVE", after: "SUSPENDED" },
    ]);
  });

  test("iç içe nesne nokta yoluyla; dizi ve sayı/boolean JSON metni olarak", () => {
    assert.deepEqual(diffAuditSummary({ flags: { comments: true, uploads: true }, tags: ["a"] }, { flags: { comments: false, uploads: true }, tags: ["a", "b"], count: 2 }), [
      { path: "count", kind: "added", before: null, after: "2" },
      { path: "flags.comments", kind: "changed", before: "true", after: "false" },
      { path: "tags", kind: "changed", before: '["a"]', after: '["a","b"]' },
    ]);
  });

  test("null özet: önce yoksa her şey eklendi, sonra yoksa kaldırıldı; ikisi de yoksa fark yok", () => {
    assert.deepEqual(diffAuditSummary(null, { status: "ACTIVE" }).map((r) => r.kind), ["added"]);
    assert.deepEqual(diffAuditSummary({ status: "ACTIVE" }, null).map((r) => r.kind), ["removed"]);
    assert.deepEqual(diffAuditSummary(null, null), []);
    assert.deepEqual(diffAuditSummary({ a: 1 }, { a: 1 }), []);
  });

  test("HTML/komut dizisi değiştirilmeden metin olarak taşınır (ekran metin düğümü basar)", () => {
    const xss = '<img src=x onerror="window.__xss=1">';
    const [row] = diffAuditSummary({ note: "<script>window.__xss=1</script>" }, { note: xss });
    assert.deepEqual([row!.before, row!.after], ["<script>window.__xss=1</script>", xss]);
  });

  test("değişim türü renkten bağımsız metin etiketi ve işareti taşır", () => {
    assert.deepEqual(Object.values(diffKindLabels).map((l) => l.label), ["Eklendi", "Kaldırıldı", "Değişti"]);
    assert.ok(Object.values(diffKindLabels).every((l) => l.mark.length > 0));
  });
});

describe("gerekçede ara: tarih aralığı kontrolü", () => {
  const base = { reasonContains: "spam", from: "2026-10-01", to: "2026-10-31" };
  test("boşsa kontrol yok; 31 gün (bitiş dahil) geçerli", () => {
    assert.equal(reasonSearchProblem({ reasonContains: "  ", from: "", to: "" }), null);
    assert.equal(reasonSearchProblem(base), null);
  });
  test("tarih eksik, ters aralık, 31 günden uzun, 3 karakterden kısa → uyarı", () => {
    assert.match(reasonSearchProblem({ ...base, from: "" })!, /başlangıç ve bitiş/);
    assert.match(reasonSearchProblem({ ...base, to: "" })!, /başlangıç ve bitiş/);
    assert.match(reasonSearchProblem({ ...base, from: "2026-10-05", to: "2026-10-01" })!, /önce olamaz/);
    assert.match(reasonSearchProblem({ ...base, to: "2026-11-01" })!, /en çok 31/);
    assert.match(reasonSearchProblem({ ...base, reasonContains: "ab" })!, /en az 3/);
  });
});

describe("zaman dilimi: gün sınırları ve gösterim", () => {
  test("gün başı seçilen dilimde; bitiş günü ertesi gün başıyla dahil", () => {
    assert.equal(dayStart("2026-10-24"), "2026-10-23T21:00:00.000Z", "varsayılan Europe/Istanbul");
    assert.equal(dayStart("2026-10-24", 1, "Europe/Istanbul"), "2026-10-24T21:00:00.000Z");
    assert.equal(dayStart("2026-10-24", 0, "UTC"), "2026-10-24T00:00:00.000Z");
    assert.equal(dayStart("2026-12-31", 1, "UTC"), "2027-01-01T00:00:00.000Z", "ay/yıl taşması");
  });
  test("ofset elle yazılmaz: İstanbul'un eski yaz saati (+02 / +03) doğru", () => {
    assert.equal(dayStart("2015-01-15", 0, "Europe/Istanbul"), "2015-01-14T22:00:00.000Z");
    assert.equal(dayStart("2015-07-01", 0, "Europe/Istanbul"), "2015-06-30T21:00:00.000Z");
  });
  test("saatler seçilen dilimde ve dilim kısaltmasıyla", () => {
    assert.match(formatAuditTime("2026-10-24T12:00:00.000Z"), /15:00 TR$/);
    assert.match(formatAuditTime("2026-10-24T12:00:00.000Z", "UTC"), /12:00 UTC$/);
  });
  test("gerekçe aralığı kontrolü dilimle aynı sınırları kullanır", () => {
    assert.equal(reasonSearchProblem({ reasonContains: "spam", from: "2026-10-01", to: "2026-10-31", timeZone: "UTC" }), null);
  });
});

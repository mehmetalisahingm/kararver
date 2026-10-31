// #2 / #54 release durum raporu: saf hesaplamalar ve Markdown çıktısı (ağ gerekmez).
import assert from "node:assert/strict";
import test from "node:test";
import { checklistProgress, ciSummary, days, nextStep, parseLegalGates, renderReport, reviewState } from "./release-status.mjs";

test("kabul maddesi ilerlemesi: [x]/[X] tamam, [ ] açık; madde dışı köşeli parantez sayılmaz", () => {
  const body = "## Kabul\n- [x] bir\n- [X] iki\n  - [ ] üç (alt madde)\n* [ ] dört\nmetin [x] madde değil\n";
  assert.deepEqual(checklistProgress(body), { done: 2, total: 4 });
  assert.deepEqual(checklistProgress(null), { done: 0, total: 0 });
});

test("CI özeti: ortam yoklayan işler (staging-monitor, security-staging) kodun CI'ını kırmızı göstermez", () => {
  const runs = [
    { name: "database", status: "completed", conclusion: "success" },
    { name: "check", status: "completed", conclusion: "failure" },
    { name: "check (staging)", status: "completed", conclusion: "failure" },
    { name: "read-only-staging", status: "completed", conclusion: "failure" },
  ];
  assert.equal(ciSummary(runs), "passing");
  assert.equal(ciSummary([{ name: "check", status: "completed", conclusion: "failure" }]), "none");
});

test("rapor: production satırı onaylı sürümde durduğu için 'main'in gerisinde' uyarısı vermez", () => {
  const md = renderReport({
    generatedAt: new Date("2026-10-18T12:00:00.000Z"),
    repo: "o/r",
    main: { sha: "88ed769e405c1234", ci: "passing" },
    staging: { httpStatus: 200, status: "ok", sha: "88ed769e405c", onMain: true },
    production: { httpStatus: 200, status: "ok", sha: "28f23188ee2b", onMain: false },
    prs: [], gates: [], adminPackage: [], bugs: [], alarms: [{ number: 300 }],
  });
  assert.ok(md.includes("- **production:** production `28f23188ee2b` · /health 200 `ok`\n"));
  assert.ok(!md.includes("staging `88ed769e405c` · /health 200 `ok` · **main"), "staging main'deyse uyarı yok");
});

test("CI özeti: başarısız > sürüyor > geçiyor; atlanan geçer", () => {
  assert.equal(ciSummary([]), "none");
  assert.equal(ciSummary([{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "skipped" }]), "passing");
  assert.equal(ciSummary([{ status: "in_progress", conclusion: null }, { status: "completed", conclusion: "success" }]), "pending");
  assert.equal(ciSummary([{ status: "in_progress", conclusion: null }, { status: "completed", conclusion: "failure" }]), "failing");
});

test("review durumu: kişi başına son karar; değişiklik isteyen kazanır, yorum karar değildir", () => {
  assert.equal(reviewState([]), "review_required");
  assert.equal(reviewState([{ user: { login: "a" }, state: "COMMENTED" }]), "review_required");
  assert.equal(reviewState([{ user: { login: "a" }, state: "APPROVED" }]), "approved");
  assert.equal(reviewState([{ user: { login: "a" }, state: "APPROVED" }, { user: { login: "b" }, state: "CHANGES_REQUESTED" }]), "changes_requested");
  // Aynı kişi önce değişiklik isteyip sonra onaylarsa son karar geçerli.
  assert.equal(reviewState([{ user: { login: "b" }, state: "CHANGES_REQUESTED" }, { user: { login: "b" }, state: "APPROVED" }]), "approved");
});

test("sıradaki adım: CI kırmızı ve değişiklik istenmişse yazar; onaylıysa birleştiren", () => {
  assert.deepEqual(nextStep({ author: "mert", ci: "failing", review: "approved" }), { who: "mert", what: "CI düzeltmesi" });
  assert.deepEqual(nextStep({ author: "mert", ci: "passing", review: "changes_requested" }), { who: "mert", what: "review düzeltmesi" });
  assert.deepEqual(nextStep({ author: "faruk", ci: "passing", review: "approved" }), { who: "birleştiren", what: "birleştirme" });
  assert.deepEqual(nextStep({ author: "faruk", ci: "passing", review: "review_required" }), { who: "reviewer", what: "review" });
  assert.deepEqual(nextStep({ author: "x", draft: true, ci: "passing", review: "approved" }), { who: "x", what: "taslak" });
});

test("rapor: başlık, staging uyarısı, tablolar ve Markdown kaçışı; GO kararı iddiası yok", () => {
  const now = new Date("2026-10-18T12:00:00.000Z");
  assert.equal(days("2026-10-15T12:00:00.000Z", now), 3);
  const md = renderReport({
    generatedAt: now,
    repo: "o/r",
    main: { sha: "88ed769e405c1234", ci: "passing" },
    staging: { httpStatus: 200, status: "ok", sha: "28f23188ee2b", onMain: false },
    prs: [{ number: 263, title: "fix | health", author: "farukkemree", ci: "passing", review: "review_required", ageDays: 0 }],
    gates: [{ number: 51, title: "[KV-49] Production", assignees: ["farukkemree"], progress: { done: 2, total: 4 }, updatedDays: 1 }],
    adminPackage: [],
    bugs: [],
    alarms: [{ number: 256 }],
  });
  assert.match(md, /## Release durumu — 2026-10-18 12:00 UTC/);
  assert.match(md, /GO\/NO-GO kararı değildir/);
  assert.match(md, /staging `28f23188ee2b` · \/health 200 `ok` · \*\*main'in son yeşil commit'i değil\*\*/);
  assert.match(md, /Açık izleme alarmı:\*\* #256/);
  assert.ok(!md.includes("**production:**"), "production adresi yokken satır yok");
  assert.match(md, /\| #51 \[KV-49\] Production \| farukkemree \| 2\/4 \| 1 gün önce \|/);
  assert.match(md, /\| #263 fix \\\| health \| farukkemree \| ✅ \| review bekliyor \| 0 gün \| reviewer: review \|/);
});

// #284 / #292: hukuki kapılar KV-51 §3.1 tablosundan okunur; liste kodda ikinci kez tutulmaz.
const LEGAL_TABLE = [
  "### 3.1 Hukuki uyum programı kapıları (#284, 30 Ekim 2026)",
  "",
  "| ID | Kapı | Kayıt | Sahip | Başlangıç |",
  "| --- | --- | --- | --- | --- |",
  "| L01 | Veri sorumlusu, hukuki metinler | #285 | Mehmet | NOT RUN |",
  "| L06 | İçerik/telif şikâyeti ([karar listesi](LEGAL_290_TAKEDOWN_APPEALS_DECISIONS.md)) | #290 | Mert | BLOCKED: karar bekliyor (#285) |",
  "| L09 | Spam puanı karar 13 | #183 | Mert | PASS (hukuk onayı 2026-11-01) |",
  "| L10 | Kayıtsız satır |",
  "",
].join("\n");

test("hukuki kapılar: tablo satırları, kayıt issue'su ve durum; PASS dışı her kapı açık", () => {
  const gates = parseLegalGates(LEGAL_TABLE);
  assert.deepEqual(gates.map((g) => [g.id, g.issue, g.owner, g.open]), [
    ["L01", 285, "Mehmet", true],
    ["L06", 290, "Mert", true],
    ["L09", 183, "Mert", false],
  ], "eksik sütunlu satır atlanır");
  assert.equal(gates[1].gate, "İçerik/telif şikâyeti", "belge bağlantısı kapı adından çıkar");
  assert.equal(gates[1].status, "BLOCKED: karar bekliyor (#285)");
  assert.deepEqual(parseLegalGates("# başka belge\n| ID | x |"), []);
  assert.deepEqual(parseLegalGates(null), []);
});

test("rapor: açık hukuki kapı varken 'hazır değil'; tablo okunamazsa da 'hazır değil'", () => {
  const base = {
    generatedAt: new Date("2026-10-31T12:00:00.000Z"),
    repo: "o/r",
    main: { sha: "9f300cfd541e1234", ci: "passing" },
    staging: { httpStatus: 200, status: "ok", sha: "9f300cfd541e", onMain: true },
    prs: [], gates: [], adminPackage: [], bugs: [], alarms: [],
  };
  const gates = parseLegalGates(LEGAL_TABLE).map((g) => ({ ...g, issueState: "açık", progress: { done: 0, total: 3 } }));
  const md = renderReport({ ...base, legalGates: gates });
  assert.match(md, /### Hukuki kapılar \(#284\): \*\*2\/3 açık → hazır değil\*\*/);
  assert.match(md, /\| L06 İçerik\/telif şikâyeti \| #290 \| Mert \| BLOCKED: karar bekliyor \(#285\) \| açık · 0\/3 \|/);
  assert.match(renderReport({ ...base, legalGates: [] }), /§3\.1 tablosu bulunamadı: hukuki kapılar okunamadı, rapor \*\*hazır değil\*\* sayılır/);
  assert.ok(!renderReport(base).includes("Hukuki kapılar"), "eski çağrılar (legalGates yok) bozulmaz");
});

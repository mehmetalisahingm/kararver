import type { LegalBundle } from "../../src/features/legal/model";

// Synthetic test-only text, never imported by application code or published.ts.
export function legalFixture(): LegalBundle {
  return {
    status: "approved", operatorName: "Sentetik test işletmecisi", contactEmail: "legal@example.test",
    documents: (["privacy", "terms", "cookies", "contact"] as const).map((kind, index) => ({
      kind, slug: ["gizlilik", "kullanim", "cerezler", "iletisim"][index], currentVersion: "2.0",
      revisions: ["2.0", "1.0"].map(version => ({
        version, title: ["Gizlilik bilgisi", "Kullanım koşulları", "Çerez bilgisi", "Başvuru ve iletişim"][index],
        publishedOn: version === "2.0" ? "2026-10-30" : "2026-09-01",
        approvedOn: "2026-08-31", approvalReference: "SYNTHETIC-TEST-NOT-LEGAL-APPROVAL",
        sections: [{ heading: "Test kapsamı", paragraphs: ["Bu yalnızca sentetik arayüz testidir; hukuki metin değildir.", "Uzunbirkelimeiletaşmakontrolü123456789012345678901234567890"] }],
      })),
    })),
  };
}

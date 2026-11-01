import { test } from "node:test";
import assert from "node:assert/strict";
import { activateLegalBundle, legalLinks, legalRevision } from "../src/features/legal/model.ts";
import { legalFixture } from "./fixtures/legal.ts";

const now = new Date("2026-11-01T12:00:00Z");
test("no approved package means no public claims or registration links", () => {
  assert.equal(activateLegalBundle(null, now), null);
  assert.deepEqual(legalLinks(null), []);
  assert.equal(legalRevision(null, "gizlilik"), null);
});
test("approved current and historical versions resolve exactly; unknown versions do not fall back", () => {
  const bundle = activateLegalBundle(legalFixture(), now)!;
  assert.equal(legalLinks(bundle).length, 4);
  assert.equal(legalRevision(bundle, "gizlilik")!.revision.version, "2.0");
  assert.equal(legalRevision(bundle, "gizlilik", "1.0")!.current, false);
  assert.equal(legalRevision(bundle, "gizlilik", "missing"), null);
  assert.equal(legalRevision(bundle, "../gizlilik"), null);
});
test("approval can keep privacy notice and policy in separate documents", () => {
  const bundle = legalFixture();
  bundle.documents = [...bundle.documents, { ...bundle.documents[0], slug: "aydinlatma" }];
  assert.equal(legalLinks(activateLegalBundle(bundle, now)).length, 5);
  assert.ok(legalRevision(bundle, "aydinlatma"));
});
for (const [name, change] of [
  ["operator missing", (bundle: ReturnType<typeof legalFixture>) => { bundle.operatorName = " "; }],
  ["contact header injection", (bundle: ReturnType<typeof legalFixture>) => { bundle.contactEmail = "legal@example.test\r\nBcc:other@example.test"; }],
  ["contact URI query", (bundle: ReturnType<typeof legalFixture>) => { bundle.contactEmail = "legal@example.test?subject=other"; }],
  ["required document missing", (bundle: ReturnType<typeof legalFixture>) => { bundle.documents = bundle.documents.slice(1); }],
  ["required category missing", (bundle: ReturnType<typeof legalFixture>) => { bundle.documents = [bundle.documents[0], bundle.documents[0], ...bundle.documents.slice(2)]; }],
  ["duplicate slug", (bundle: ReturnType<typeof legalFixture>) => { bundle.documents = bundle.documents.map(document => ({ ...document, slug: "same" })); }],
  ["draft package", (bundle: ReturnType<typeof legalFixture>) => { (bundle as {status: string}).status = "draft"; }],
  ["missing active revision", (bundle: ReturnType<typeof legalFixture>) => { bundle.documents = bundle.documents.map(document => ({ ...document, currentVersion: "9.0" })); }],
  ["approval absent", (bundle: ReturnType<typeof legalFixture>) => { bundle.documents = bundle.documents.map(document => ({ ...document, revisions: document.revisions.map(revision => ({ ...revision, approvalReference: "" })) })); }],
  ["future publication", (bundle: ReturnType<typeof legalFixture>) => { bundle.documents = bundle.documents.map(document => ({ ...document, revisions: document.revisions.map(revision => ({ ...revision, publishedOn: "2027-01-01" })) })); }],
  ["invalid date", (bundle: ReturnType<typeof legalFixture>) => { bundle.documents = bundle.documents.map(document => ({ ...document, revisions: document.revisions.map(revision => ({ ...revision, publishedOn: "2026-02-30" })) })); }],
  ["unsafe version", (bundle: ReturnType<typeof legalFixture>) => { bundle.documents = bundle.documents.map(document => ({ ...document, revisions: document.revisions.map(revision => ({ ...revision, version: "../1" })) })); }],
  ["duplicate revision", (bundle: ReturnType<typeof legalFixture>) => { bundle.documents = bundle.documents.map(document => ({ ...document, revisions: [...document.revisions, document.revisions[0]] })); }],
  ["empty document body", (bundle: ReturnType<typeof legalFixture>) => { bundle.documents = bundle.documents.map(document => ({ ...document, revisions: document.revisions.map(revision => ({ ...revision, sections: [] })) })); }],
  ["future approval", (bundle: ReturnType<typeof legalFixture>) => { bundle.documents = bundle.documents.map(document => ({ ...document, revisions: document.revisions.map(revision => ({ ...revision, approvedOn: "2027-01-01" })) })); }],
] as const) test(`activation refuses ${name}`, () => {
  const bundle = legalFixture(); change(bundle);
  assert.throws(() => activateLegalBundle(bundle, now), /yayımlanamaz/);
});

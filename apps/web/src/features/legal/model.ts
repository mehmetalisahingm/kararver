export type LegalKind = "privacy" | "terms" | "cookies" | "contact";
export type LegalRevision = {
  version: string;
  title: string;
  publishedOn: string;
  approvedOn: string;
  approvalReference: string;
  sections: readonly { heading: string; paragraphs: readonly string[] }[];
};
export type LegalDocument = { kind: LegalKind; slug: string; currentVersion: string; revisions: readonly LegalRevision[] };
export type LegalBundle = {
  status: "approved";
  operatorName: string;
  contactEmail: string;
  documents: readonly LegalDocument[];
};
export type LegalLink = { kind: LegalKind; label: string; href: string; version: string };

const kinds: LegalKind[] = ["privacy", "terms", "cookies", "contact"];
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const versionPattern = /^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/;
const text = (value: string) => typeof value === "string" && value.trim().length > 0;
function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Trusted, reviewed source configuration only; this is not legal approval or a consent API. */
export function activateLegalBundle(bundle: LegalBundle | null, now = new Date()): LegalBundle | null {
  if (bundle === null) return null;
  const invalid = () => { throw new Error("Yasal metin paketi eksik veya geçersiz; yayımlanamaz."); };
  const today = now.toISOString().slice(0, 10);
  if (bundle.status !== "approved" || !text(bundle.operatorName) ||
      !/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(bundle.contactEmail) ||
      bundle.documents.length < kinds.length) invalid();
  const slugs = new Set<string>();
  if (kinds.some(kind => !bundle.documents.some(document => document.kind === kind))) invalid();
  // A category may contain separate notices/policies; approval decides that split.
  for (const document of bundle.documents) {
    if (!slugPattern.test(document.slug) || slugs.has(document.slug)) invalid();
    slugs.add(document.slug);
    const versions = new Set<string>();
    for (const revision of document.revisions) {
      if (!versionPattern.test(revision.version) || versions.has(revision.version) ||
          !text(revision.title) || !date(revision.publishedOn) || !date(revision.approvedOn) ||
          revision.publishedOn > today || revision.approvedOn > today ||
          !text(revision.approvalReference) || revision.sections.length === 0 ||
          revision.sections.some(section => !text(section.heading) || section.paragraphs.length === 0 || section.paragraphs.some(paragraph => !text(paragraph)))) invalid();
      versions.add(revision.version);
    }
    if (!versions.has(document.currentVersion)) invalid();
  }
  return bundle;
}

export function legalLinks(bundle: LegalBundle | null): LegalLink[] {
  return bundle?.documents.map(document => ({
    kind: document.kind,
    label: document.revisions.find(revision => revision.version === document.currentVersion)!.title,
    href: `/yasal/${document.slug}`,
    version: document.currentVersion,
  })) ?? [];
}

export function legalRevision(bundle: LegalBundle | null, slug: string, version?: string) {
  const document = bundle?.documents.find(document => document.slug === slug);
  if (!document) return null;
  const revision = document.revisions.find(revision => revision.version === (version ?? document.currentVersion));
  return revision ? { document, revision, current: revision.version === document.currentVersion } : null;
}

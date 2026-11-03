import { notFound } from "next/navigation";
import { legalRevision } from "../../../../features/legal/model";
import { publishedLegalBundle } from "../../../../features/legal/published";
import { LegalDocumentView } from "../../../../features/legal/views";
import { legalMetadata } from "../../../../features/legal/metadata";

export const dynamicParams = false;
export function generateStaticParams() {
  return publishedLegalBundle()?.documents.flatMap(document => document.revisions.map(revision => ({ slug: document.slug, version: revision.version }))) ?? [];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; version: string }> }) {
  const { slug, version } = await params;
  return legalMetadata(slug, version);
}

export default async function Page({ params }: { params: Promise<{ slug: string; version: string }> }) {
  const { slug, version } = await params;
  const bundle = publishedLegalBundle();
  const resolved = legalRevision(bundle, slug, version);
  if (!bundle || !resolved) notFound();
  return <LegalDocumentView bundle={bundle} resolved={resolved} />;
}

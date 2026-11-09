import { notFound } from "next/navigation";
import { legalRevision } from "../../../features/legal/model";
import { publishedLegalBundle } from "../../../features/legal/published";
import { LegalDocumentView } from "../../../features/legal/views";
import { legalMetadata } from "../../../features/legal/metadata";

export const dynamicParams = false;
export function generateStaticParams() {
  return publishedLegalBundle()?.documents.map(document => ({ slug: document.slug })) ?? [];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return legalMetadata((await params).slug);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = publishedLegalBundle();
  const resolved = legalRevision(bundle, slug);
  if (!bundle || !resolved) notFound();
  return <LegalDocumentView bundle={bundle} resolved={resolved} />;
}

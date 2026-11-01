import { notFound } from "next/navigation";
import { publishedLegalBundle } from "../../features/legal/published";
import { LegalIndex } from "../../features/legal/views";

export const metadata = { title: "Yasal bilgiler · Kararver" };

export default function Page() {
  const bundle = publishedLegalBundle();
  if (!bundle) notFound();
  return <LegalIndex bundle={bundle} />;
}

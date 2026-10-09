import type { Metadata } from "next";
import { PollDetail } from "../../../features/polls/screens";
import { ShareActions } from "../../../features/polls/share-actions";
import { loadPublicPoll, webBaseUrl } from "../../../lib/server-public-polls";

function descriptionOf(value: string | null): string {
  const text = (value ?? "Kararver topluluğunda bu karar hakkında fikirleri keşfet.").replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const poll = await loadPublicPoll(id);
  if (!poll) {
    return {
      title: "İçerik bulunamadı · Kararver",
      robots: { index: false, follow: false },
    };
  }

  const base = webBaseUrl();
  const canonical = new URL(poll.canonicalPath, base).toString();
  const title = `${poll.title} · Kararver`;
  const description = descriptionOf(poll.description);
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      url: canonical,
      siteName: "Kararver",
      locale: "tr_TR",
      title,
      description,
      ...(poll.media[0] ? { images: [{ url: poll.media[0].url, alt: poll.title }] } : {}),
    },
    robots: { index: true, follow: true },
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PollDetail id={id} />
      <ShareActions routeId={id} />
    </>
  );
}

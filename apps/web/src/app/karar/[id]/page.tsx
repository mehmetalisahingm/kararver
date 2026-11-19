import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PollDetail } from "../../../features/polls/screens";
import { ShareActions } from "../../../features/polls/share-actions";
import { loadPublicPoll, webBaseUrl } from "../../../lib/server-public-polls";
import { mapPoll } from "../../../lib/poll-mapper";
import { pollShareMetadata, publicRobots } from "../../../lib/seo";

function descriptionOf(value: string | null): string {
  const text = (value ?? "Kararver topluluğunda bu karar hakkında fikirleri keşfet.").replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

// Staging uses the real API too. Only local/demo should fall back to the
// client when a public poll is missing or the upstream service is unavailable.
function requirePublicApi() {
  return process.env.APP_ENV === "production" || process.env.APP_ENV === "staging";
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const poll = await loadPublicPoll(id, { strict: requirePublicApi() });
  // HTML-limited crawlers wait for metadata before headers are sent. Resolve
  // removal here too, before the page's streaming boundary can commit a 200.
  if (!poll && requirePublicApi()) notFound();
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
    ...pollShareMetadata({ title, description, canonical, imageUrl: poll.media[0]?.url }),
    robots: publicRobots(),
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The real poll body is part of the initial HTML, not a JS-only loading
  // spinner. Public results stay subject to the API's visibility projection.
  // Preview/demo stays client-driven and remains noindex by policy.
  const poll = await loadPublicPoll(id, { strict: requirePublicApi() });
  if (!poll && requirePublicApi()) notFound();
  return (
    <>
      <PollDetail id={id} initialPoll={poll ? mapPoll(poll) : undefined} />
      {(poll || !requirePublicApi()) && <ShareActions routeId={id} />}
    </>
  );
}

// Shared pure public-poll view projection for server-side first paint and the API client.
// This module has no session or browser dependencies. Server-side calls receive
// only the public endpoint projection (no user-specific vote/bookmark fields).
import { PollCard, PollDetail } from "@kararver/contracts";
import { safeReturnTo } from "./model.ts";
import type { Poll } from "./model.ts";

export function mapPoll(wire: ReturnType<typeof PollCard.parse> | ReturnType<typeof PollDetail.parse>): Poll {
  const detail = "options" in wire ? wire : null;
  return {
    id: wire.id, canonicalPath: detail ? safeReturnTo(detail.canonicalPath) : `/karar/${wire.id}`,
    title: wire.title, description: detail?.description ?? wire.excerpt ?? "",
    kind: wire.kind === "POLL" ? "poll" : "discussion", author: wire.author.displayName,
    category: wire.category.name, status: wire.status === "LOCKED" ? "LOCKED" : wire.closed ? "CLOSED" : "ACTIVE",
    createdAt: wire.createdAt,
    closesAt: wire.closesAt ?? "", options: detail?.options ?? [],
    visibility: detail?.resultsVisibility === "ALWAYS" ? "always" : "after_vote",
    results: wire.results ?? { visible: false }, ownVote: wire.viewer?.vote ?? null,
    voteBlockedReason: wire.viewer?.voteBlockedReason ?? null,
    commentCount: wire.commentCount,
    gallery: (detail?.media ?? (wire.coverImage ? [wire.coverImage] : [])).map(m => ({id:m.id,status:"ready",src:m.url,alt:wire.title})),
    details: [
      ...(detail?.extraInfo ? [{label:"Ek bilgi",value:detail.extraInfo}] : []),
      ...(detail?.addenda ?? []).map((item, index) => ({
        label: `Ek açıklama ${index + 1} · ${new Date(item.createdAt).toLocaleString("tr-TR", {timeZone:"Europe/Istanbul"})}`,
        value: item.body,
      })),
    ],
    price: detail?.price ? {...detail.price,note:""} : undefined,
    canVote: wire.viewer?.canVote, commentsEnabled: detail?.allowComments ?? false, comments: [],
  };
}

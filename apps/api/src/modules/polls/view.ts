// PollRecord → sözleşmedeki PollDetail (contracts/domains/polls.ts). Cevap alan alan kurulur;
// DB nesnesi yayılmaz. Sonuç görünürlüğü ve oy durumu contracts yardımcılarından gelir, böylece
// kural tek yerde kalır (API_CONTRACTS.md §4.4).
import { pollResults, resultsVisibleTo, voteAvailability } from "@kararver/contracts";
import type { SessionUser } from "../auth/session.ts";
import type { PollRecord, PollSettings } from "./store.ts";

const EXCERPT_LENGTH = 160;

/** Herkese gösterilebilen durumlar. Diğerleri (HIDDEN, UNDER_REVIEW, REMOVED) 404 olur. */
export function isPubliclyVisible(poll: { status: string }): poll is { status: "ACTIVE" | "LOCKED" } {
  return poll.status === "ACTIVE" || poll.status === "LOCKED";
}

export function isClosed(poll: { closesAt: Date; closedAt: Date | null }, now: Date): boolean {
  return poll.closedAt !== null || poll.closesAt <= now;
}

function excerpt(description: string | null): string | null {
  if (!description) return null;
  const flat = description.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_LENGTH ? flat : `${flat.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`;
}

export function toPollDetail(poll: PollRecord, viewer: SessionUser | null, now: Date, settings: PollSettings, mediaBase: string) {
  if (!isPubliclyVisible(poll)) throw new Error(`toPollDetail: görünmeyen durum ${poll.status}`);
  const closed = isClosed(poll, now);
  const isAuthor = viewer?.id === poll.author.id;
  const vote = poll.viewerVote;
  const hasValidVote = vote !== null && !vote.invalidated;

  const visible = resultsVisibleTo({
    resultsVisibility: poll.resultsVisibility,
    closed,
    viewerHasValidVote: hasValidVote,
    viewerIsAuthor: isAuthor,
  });
  // Toplam seçenek sayaçlarının toplamıdır; ikisi aynı transaction'da güncellenir (DATA_MODEL §5.3).
  const total = poll.options.reduce((sum, o) => sum + o.voteCount, 0);
  const results = pollResults({ visible, total, options: poll.options.map((o) => ({ id: o.id, votes: o.voteCount })) });

  const media = poll.media.map((m) => ({ id: m.id, url: `${mediaBase}/${m.publicKey}`, width: m.width, height: m.height }));

  const viewerState = viewer
    ? {
        vote: vote?.optionId ?? null,
        voteInvalidated: vote?.invalidated ?? false,
        // Tepki (#66), kaydetme ve takip (Mehmet, KV-22/KV-23) tabloları gelene kadar sabit.
        reaction: null,
        bookmarked: false,
        following: false,
        isAuthor,
        ...voteAvailability({
          kind: "POLL",
          viewerIsAuthor: isAuthor,
          closed,
          contentStatus: poll.status,
          // BANNED/SUSPENDED oturumu router'da reddedilir; RESTRICTED ayrıntısı yaptırımlarla gelir (KV-33).
          accountRestricted: false,
          emailVerified: viewer.emailVerified,
          voteInvalidated: vote?.invalidated ?? false,
          hasVote: vote !== null,
          voteChangeAllowed: settings.voteChangeAllowed,
        }),
      }
    : null;

  return {
    id: poll.id,
    publicId: poll.publicId,
    slug: poll.slug,
    // Tartışma gönderisi (DISCUSSION) #66 ile gelir; o zamana kadar her gönderi ankettir.
    kind: "POLL" as const,
    title: poll.title,
    excerpt: excerpt(poll.description),
    author: {
      id: poll.author.id,
      username: poll.author.username,
      displayName: poll.author.displayName,
      avatarUrl: poll.author.avatarPublicKey ? `${mediaBase}/${poll.author.avatarPublicKey}` : null,
    },
    category: poll.category,
    community: poll.community,
    coverImage: media[0] ?? null,
    status: poll.status,
    createdAt: poll.createdAt.toISOString(),
    closesAt: poll.closesAt.toISOString(),
    closed,
    commentCount: poll.commentCount,
    reactions: { likes: 0, dislikes: 0, viewer: null },
    results,
    viewer: viewerState,
    description: poll.description,
    extraInfo: poll.extraInfo,
    price: poll.priceAmount !== null ? { amount: poll.priceAmount, currency: "TRY" as const } : null,
    tags: poll.tags,
    media,
    options: poll.options.map((o) => ({ id: o.id, label: o.label, position: o.position })),
    resultsVisibility: poll.resultsVisibility,
    allowComments: poll.allowComments,
    contentLocked: poll.firstValidVoteAt !== null,
    opensAt: poll.opensAt.toISOString(),
    closedAt: poll.closedAt?.toISOString() ?? null,
    addenda: poll.addenda.map((a) => ({ id: a.id, body: a.body, createdAt: a.createdAt.toISOString() })),
    canonicalPath: `/karar/${poll.slug}-${poll.publicId}`,
  };
}

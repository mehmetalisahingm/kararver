// Oy modülünün veri erişim arayüzü — KV-11 (#13). Üretim uygulaması: prisma-store.ts.
// Oy, oy geçmişi (vote_events) ve sayaçlar tek transaction'da yazılır (DATA_MODEL §5).

export type CastVoteInput = {
  pollId: string;
  userId: string;
  optionId: string;
  /** Kapanış kontrolü uygulamanın saatine göre yapılır (anket detayıyla aynı). */
  now: Date;
  voteChangeAllowed: boolean;
};

export type VoteState = { optionId: string; changeCount: number; updatedAt: Date };

/** Oydan sonraki anket durumu; cevaptaki sonuç projeksiyonu bundan kurulur. */
export type PollTally = {
  resultsVisibility: "ALWAYS" | "AFTER_VOTE";
  closed: boolean;
  options: { id: string; voteCount: number }[];
};

export type CastVoteRejection =
  | "NOT_FOUND"
  | "SELF_VOTE_FORBIDDEN"
  | "POLL_CLOSED"
  | "CONTENT_LOCKED"
  | "OPTION_NOT_IN_POLL"
  | "VOTE_INVALIDATED"
  | "VOTE_CHANGE_DISABLED";

export type CastVoteResult =
  /** cast: ilk oy (201). unchanged: aynı seçeneğe tekrar (200, yeni olay yok). changed: seçenek değişti (200). */
  | { kind: "cast" | "unchanged" | "changed"; vote: VoteState; tally: PollTally }
  | { kind: "rejected"; reason: CastVoteRejection };

export interface VoteStore {
  castVote(input: CastVoteInput): Promise<CastVoteResult>;
}

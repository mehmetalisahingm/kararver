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
  | "NOT_A_POLL"
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

/** KV-43 hedef: tek tek oylar veya hesapların oyları (pollId verilirse sadece o ankette). */
export type InvalidationTarget = { type: "VOTES"; voteIds: string[] } | { type: "ACCOUNTS"; userIds: string[]; pollId?: string };

export type VoteCorrectionInput = { reason: string; actorId: string; now: Date };

/** changed: durumu değişen; unchanged: zaten istenen durumda (tekrar istek); notFound: bulunamayan oy kimlikleri. */
export type VoteCorrection = { changed: number; unchanged: number; notFound: string[]; affectedPollIds: string[] };

export interface VoteStore {
  castVote(input: CastVoteInput): Promise<CastVoteResult>;
  /**
   * Oyları geçersiz sayar (DATA_MODEL §5.4): invalidated_at + gerekçe, vote_events INVALIDATE (aktörlü), seçenek ve
   * anket sayaçları −1, anketin snapshot'ları yeniden üretilmek üzere işaretlenir. Tek transaction; etkilenen anket
   * satırları id sırasıyla kilitlenir. Sadece geçerli oylar işlenir: tekrar istek çift düşüm yapmaz.
   */
  invalidateVotes(target: InvalidationTarget, input: VoteCorrectionInput): Promise<VoteCorrection>;
  /** Geçersiz sayılmış oyları geri alır: RESTORE olayı, sayaçlar +1, anket kilidi (first_valid_vote_at) gerekirse dolar. */
  restoreVotes(voteIds: string[], input: VoteCorrectionInput): Promise<VoteCorrection>;
}

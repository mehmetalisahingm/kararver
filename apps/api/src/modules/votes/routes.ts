// Oy endpoint'i — KV-11 (#13). Sözleşme: packages/contracts/src/domains/polls.ts → votes.put
// Domain olayları (vote.submitted / vote.changed) outbox ile gelir (KV-04 #6, KV-21 #23); snapshot ve
// trendlerin kaynağı olan oy geçmişi (vote_events) şimdiden aynı transaction'da yazılıyor.
import { pollResults, resultsVisibleTo } from "@kararver/contracts";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { PollSettings } from "../polls/store.ts";
import type { CastVoteRejection, VoteStore } from "./store.ts";

export type VoteDeps = {
  store: VoteStore;
  now: () => Date;
  /** Sistem ayarları (KV-40, #42): polls.voteChangeAllowed. */
  settings: () => Promise<PollSettings>;
};

const rejections: Record<CastVoteRejection, () => ApiError> = {
  NOT_FOUND: () => new ApiError("NOT_FOUND", "İçerik bulunamadı."),
  SELF_VOTE_FORBIDDEN: () => new ApiError("SELF_VOTE_FORBIDDEN", "Kendi anketinize oy veremezsiniz."),
  POLL_CLOSED: () => new ApiError("POLL_CLOSED", "Anket kapandı."),
  CONTENT_LOCKED: () => new ApiError("CONTENT_LOCKED", "Bu gönderi moderasyon nedeniyle kilitli."),
  OPTION_NOT_IN_POLL: () => new ApiError("VALIDATION_ERROR", "Geçersiz seçenek.", [{ field: "optionId", code: "not_in_poll" }]),
  VOTE_INVALIDATED: () => new ApiError("VOTE_INVALIDATED", "Bu anketteki oyunuz geçersiz sayıldı."),
  VOTE_CHANGE_DISABLED: () => new ApiError("VOTE_CHANGE_DISABLED", "Oy değiştirme kapalı."),
};

export function registerVoteRoutes(route: Route, deps: VoteDeps): void {
  route("votes.put", async ({ params, body, viewer }) => {
    const settings = await deps.settings();
    const result = await deps.store.castVote({
      pollId: params.id,
      userId: viewer!.id,
      optionId: body.optionId,
      now: deps.now(),
      voteChangeAllowed: settings.voteChangeAllowed,
    });
    if (result.kind === "rejected") throw rejections[result.reason]();

    const { tally, vote } = result;
    // Oy veren izleyicinin geçerli oyu var: AFTER_VOTE sonucu artık görünür (API_CONTRACTS §4.4).
    const visible = resultsVisibleTo({ resultsVisibility: tally.resultsVisibility, closed: tally.closed, viewerHasValidVote: true });
    const total = tally.options.reduce((sum, o) => sum + o.voteCount, 0);
    return {
      status: result.kind === "cast" ? 201 : 200,
      body: {
        data: {
          vote: { optionId: vote.optionId, changeCount: vote.changeCount, updatedAt: vote.updatedAt.toISOString() },
          results: pollResults({ visible, total, options: tally.options.map((o) => ({ id: o.id, votes: o.voteCount })) }),
        },
      },
    };
  });
}

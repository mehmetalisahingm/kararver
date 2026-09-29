// VoteStore'un PostgreSQL/Prisma uygulaması. Tablolar: polls, poll_options, votes, vote_events.
import type { PrismaClient } from "@kararver/db";
import type { CastVoteResult, PollTally, VoteStore } from "./store.ts";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

type LockedPoll = {
  author_id: string;
  status: string;
  results_visibility: "ALWAYS" | "AFTER_VOTE";
  closes_at: Date;
  closed_at: Date | null;
};

type ExistingVote = { id: string; option_id: string; change_count: number; invalidated_at: Date | null; updated_at: Date };

async function tally(tx: Tx, pollId: string, poll: LockedPoll, now: Date): Promise<PollTally> {
  const options = await tx.pollOption.findMany({ where: { pollId }, select: { id: true, voteCount: true }, orderBy: { position: "asc" } });
  return {
    resultsVisibility: poll.results_visibility,
    closed: poll.closed_at !== null || poll.closes_at <= now,
    options,
  };
}

export function createPrismaVoteStore(prisma: PrismaClient): VoteStore {
  return {
    castVote: ({ pollId, userId, optionId, now, voteChangeAllowed }) =>
      prisma.$transaction(async (tx): Promise<CastVoteResult> => {
        // Anket satırı kilitlenir: aynı anketteki oylar ve kapatma sıraya girer. Böylece
        // (1) aynı hesaptan eşzamanlı istekler tek oy üretir, (2) kapanıştan sonra commit edilen oy
        // olmaz, (3) sayaç güncellemeleri kilit yükseltmesiyle deadlock'a girmez.
        const [poll] = await tx.$queryRaw<LockedPoll[]>`
          SELECT author_id::text, status::text, results_visibility::text AS results_visibility, closes_at, closed_at
          FROM polls WHERE id = ${pollId}::uuid FOR UPDATE`;
        const reject = (reason: Extract<CastVoteResult, { kind: "rejected" }>["reason"]): CastVoteResult => ({ kind: "rejected", reason });

        // Sıra, viewer.voteBlockedReason ile aynıdır (contracts → voteAvailability).
        if (!poll || (poll.status !== "ACTIVE" && poll.status !== "LOCKED")) return reject("NOT_FOUND");
        if (poll.author_id === userId) return reject("SELF_VOTE_FORBIDDEN");
        if (poll.closed_at !== null || poll.closes_at <= now) return reject("POLL_CLOSED");
        if (poll.status === "LOCKED") return reject("CONTENT_LOCKED");
        if ((await tx.pollOption.count({ where: { id: optionId, pollId } })) === 0) return reject("OPTION_NOT_IN_POLL");

        const [existing] = await tx.$queryRaw<ExistingVote[]>`
          SELECT id::text, option_id::text, change_count, invalidated_at, updated_at
          FROM votes WHERE poll_id = ${pollId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;

        if (!existing) {
          const vote = await tx.vote.create({
            data: { pollId, userId, optionId },
            select: { id: true, optionId: true, changeCount: true, updatedAt: true },
          });
          await tx.voteEvent.create({ data: { voteId: vote.id, pollId, userId, type: "CAST", toOptionId: optionId } });
          await tx.pollOption.update({ where: { id: optionId }, data: { voteCount: { increment: 1 } } });
          await tx.poll.update({ where: { id: pollId }, data: { voteCount: { increment: 1 } } });
          return { kind: "cast", vote, tally: await tally(tx, pollId, poll, now) };
        }

        if (existing.invalidated_at !== null) return reject("VOTE_INVALIDATED");
        const current = { optionId: existing.option_id, changeCount: existing.change_count, updatedAt: existing.updated_at };
        if (existing.option_id === optionId) return { kind: "unchanged", vote: current, tally: await tally(tx, pollId, poll, now) };
        if (!voteChangeAllowed) return reject("VOTE_CHANGE_DISABLED");

        const vote = await tx.vote.update({
          where: { id: existing.id },
          data: { optionId, changeCount: { increment: 1 } },
          select: { optionId: true, changeCount: true, updatedAt: true },
        });
        await tx.voteEvent.create({
          data: { voteId: existing.id, pollId, userId, type: "CHANGE", fromOptionId: existing.option_id, toOptionId: optionId },
        });
        // Toplam değişmez; sadece iki seçeneğin sayacı yer değiştirir.
        await tx.pollOption.update({ where: { id: existing.option_id }, data: { voteCount: { decrement: 1 } } });
        await tx.pollOption.update({ where: { id: optionId }, data: { voteCount: { increment: 1 } } });
        return { kind: "changed", vote, tally: await tally(tx, pollId, poll, now) };
      }),
  };
}

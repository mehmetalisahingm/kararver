// VoteStore'un PostgreSQL/Prisma uygulaması. Tablolar: polls, poll_options, votes, vote_events.
import type { PrismaClient } from "@kararver/db";
import type { CastVoteResult, PollTally, VoteCorrection, VoteStore } from "./store.ts";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

type LockedPoll = {
  kind: "POLL" | "DISCUSSION";
  author_id: string;
  status: string;
  /** Sadece POLL'da dolu; tartışma castVote'ta NOT_A_POLL ile erken reddedilir. */
  results_visibility: "ALWAYS" | "AFTER_VOTE";
  closes_at: Date | null;
  closed_at: Date | null;
};

type ExistingVote = { id: string; option_id: string; change_count: number; invalidated_at: Date | null; updated_at: Date };

async function tally(tx: Tx, pollId: string, poll: LockedPoll, now: Date): Promise<PollTally> {
  const options = await tx.pollOption.findMany({ where: { pollId }, select: { id: true, voteCount: true }, orderBy: { position: "asc" } });
  return {
    resultsVisibility: poll.results_visibility,
    closed: poll.closed_at !== null || poll.closes_at! <= now,
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
          SELECT kind::text AS kind, author_id::text, status::text, results_visibility::text AS results_visibility, closes_at, closed_at
          FROM polls WHERE id = ${pollId}::uuid FOR UPDATE`;
        const reject = (reason: Extract<CastVoteResult, { kind: "rejected" }>["reason"]): CastVoteResult => ({ kind: "rejected", reason });

        // Sıra, viewer.voteBlockedReason ile aynıdır (contracts → voteAvailability).
        if (!poll || (poll.status !== "ACTIVE" && poll.status !== "LOCKED")) return reject("NOT_FOUND");
        if (poll.kind !== "POLL") return reject("NOT_A_POLL");
        if (poll.author_id === userId) return reject("SELF_VOTE_FORBIDDEN");
        if (poll.closed_at !== null || poll.closes_at! <= now) return reject("POLL_CLOSED");
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

    invalidateVotes: (target, { reason, actorId, now }) =>
      prisma.$transaction(async (tx) => {
        const candidates =
          target.type === "VOTES"
            ? await tx.vote.findMany({ where: { id: { in: target.voteIds } }, select: { id: true, pollId: true } })
            : await tx.vote.findMany({
                where: { userId: { in: target.userIds }, ...(target.pollId ? { pollId: target.pollId } : {}) },
                select: { id: true, pollId: true },
              });
        const notFound = target.type === "VOTES" ? missing(target.voteIds, candidates) : [];
        if (candidates.length === 0) return { changed: 0, unchanged: 0, notFound, affectedPollIds: [] };
        await lockPolls(tx, candidates.map((c) => c.pollId));

        // Kilitten sonra: sadece hâlâ geçerli olanlar. Tekrar istek ve eşzamanlı ikinci yönetici 0 satır alır.
        const changed = await tx.$queryRaw<Changed[]>`
          UPDATE votes SET invalidated_at = ${now.toISOString()}::timestamptz, invalidation_reason = ${reason},
            updated_at = ${now.toISOString()}::timestamptz
          WHERE id = ANY(${candidates.map((c) => c.id)}::uuid[]) AND invalidated_at IS NULL
          RETURNING id::text, poll_id::text, user_id::text, option_id::text, created_at`;
        await applyCorrection(tx, changed, -1, { type: "INVALIDATE", reason, actorId, now });
        return summary(changed, candidates.length, notFound);
      }),

    restoreVotes: (voteIds, { reason, actorId, now }) =>
      prisma.$transaction(async (tx) => {
        const candidates = await tx.vote.findMany({ where: { id: { in: voteIds } }, select: { id: true, pollId: true } });
        const notFound = missing(voteIds, candidates);
        if (candidates.length === 0) return { changed: 0, unchanged: 0, notFound, affectedPollIds: [] };
        await lockPolls(tx, candidates.map((c) => c.pollId));

        const changed = await tx.$queryRaw<Changed[]>`
          UPDATE votes SET invalidated_at = NULL, invalidation_reason = NULL, updated_at = ${now.toISOString()}::timestamptz
          WHERE id = ANY(${candidates.map((c) => c.id)}::uuid[]) AND invalidated_at IS NOT NULL
          RETURNING id::text, poll_id::text, user_id::text, option_id::text, created_at`;
        await applyCorrection(tx, changed, +1, { type: "RESTORE", reason, actorId, now });
        // Geri gelen geçerli oy anketi kilitler (geçersiz oy kilitlemez; kilit kalıcıdır, DATA_MODEL §6).
        const polls = [...new Set(changed.map((c) => c.poll_id))];
        if (polls.length > 0) {
          await tx.$executeRaw`
            UPDATE polls SET first_valid_vote_at = ${now.toISOString()}::timestamptz
            WHERE id = ANY(${polls}::uuid[]) AND first_valid_vote_at IS NULL`;
        }
        return summary(changed, candidates.length, notFound);
      }),
  };
}

type Changed = { id: string; poll_id: string; user_id: string; option_id: string; created_at: Date };

const missing = (ids: string[], found: { id: string }[]) => {
  const have = new Set(found.map((f) => f.id));
  return [...new Set(ids)].filter((id) => !have.has(id));
};

const summary = (changed: Changed[], candidates: number, notFound: string[]): VoteCorrection => ({
  changed: changed.length,
  unchanged: candidates - changed.length,
  notFound,
  affectedPollIds: [...new Set(changed.map((c) => c.poll_id))].sort(),
});

/** Etkilenen anketleri id sırasıyla kilitler: oy verme (tek anket kilidi) ve diğer düzeltmelerle deadlock olmaz. */
async function lockPolls(tx: Tx, pollIds: string[]): Promise<void> {
  const ids = [...new Set(pollIds)].sort();
  await tx.$queryRaw`SELECT id FROM polls WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
}

/**
 * Olay, sayaçlar ve snapshot işareti. delta −1 (geçersiz sayma) veya +1 (geri alma). Snapshot'lar, oyun ilk verildiği
 * andan itibaren etkilenir: anketin snapshots_stale_since değeri en erken etkilenen oy zamanına çekilir.
 */
async function applyCorrection(
  tx: Tx,
  changed: Changed[],
  delta: 1 | -1,
  event: { type: "INVALIDATE" | "RESTORE"; reason: string; actorId: string; now: Date },
): Promise<void> {
  if (changed.length === 0) return;
  await tx.voteEvent.createMany({
    data: changed.map((c) => ({
      voteId: c.id,
      pollId: c.poll_id,
      userId: c.user_id,
      type: event.type,
      fromOptionId: event.type === "INVALIDATE" ? c.option_id : null,
      toOptionId: event.type === "RESTORE" ? c.option_id : null,
      reason: event.reason,
      actorId: event.actorId,
      // occurred_at DB varsayılanı (now()): CAST/CHANGE ile aynı saat kaynağı, olay sırası tek kaynaktan.
    })),
  });
  const byOption = new Map<string, number>();
  const byPoll = new Map<string, { n: number; since: Date }>();
  for (const c of changed) {
    byOption.set(c.option_id, (byOption.get(c.option_id) ?? 0) + 1);
    const p = byPoll.get(c.poll_id);
    byPoll.set(c.poll_id, { n: (p?.n ?? 0) + 1, since: p && p.since < c.created_at ? p.since : c.created_at });
  }
  for (const [id, n] of byOption) await tx.pollOption.update({ where: { id }, data: { voteCount: { increment: delta * n } } });
  for (const [id, { n, since }] of byPoll) {
    await tx.$executeRaw`
      UPDATE polls SET vote_count = vote_count + ${delta * n},
        snapshots_stale_since = LEAST(coalesce(snapshots_stale_since, ${since.toISOString()}::timestamptz), ${since.toISOString()}::timestamptz)
      WHERE id = ${id}::uuid`;
  }
}

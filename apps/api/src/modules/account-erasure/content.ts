import type { Prisma } from "@kararver/db";

/** Caller has locked subject, communities and all affected polls; erasure record and tombstone exist in this transaction. */
export async function eraseAuthoredContent(tx: Prisma.TransactionClient, userId: string, now: Date): Promise<void> {
  await tx.$queryRaw`SELECT set_config('kararver.erasure_user', ${userId}, true)`;
  const expected = await tx.vote.count({ where: { userId } });
  const moved = await tx.$executeRaw`
    WITH source AS (
      SELECT v.poll_id, v.option_id, v.created_at, v.invalidated_at,
        coalesce((SELECT jsonb_agg(jsonb_build_object('type',e.type,'from',e.from_option_id,'to',e.to_option_id,'at',e.occurred_at)
          ORDER BY e.occurred_at,e.id) FROM vote_events e WHERE e.vote_id=v.id), '[]'::jsonb) AS history
      FROM votes v WHERE v.user_id=${userId}::uuid
    ), grouped AS (
      SELECT poll_id,option_id,created_at,invalidated_at,history,count(*)::int AS n,
        md5(jsonb_build_array(option_id,created_at,invalidated_at,history)::text) AS fingerprint
      FROM source GROUP BY poll_id,option_id,created_at,invalidated_at,history
    )
    INSERT INTO anonymous_vote_groups(poll_id,option_id,created_at,invalidated_at,history,fingerprint,multiplicity)
      SELECT poll_id,option_id,created_at,invalidated_at,history,fingerprint,n FROM grouped
    ON CONFLICT(poll_id,fingerprint) DO UPDATE SET multiplicity=anonymous_vote_groups.multiplicity+EXCLUDED.multiplicity
      WHERE anonymous_vote_groups.history=EXCLUDED.history AND anonymous_vote_groups.option_id=EXCLUDED.option_id
        AND anonymous_vote_groups.created_at=EXCLUDED.created_at
        AND anonymous_vote_groups.invalidated_at IS NOT DISTINCT FROM EXCLUDED.invalidated_at`;
  if (moved !== expected) throw new Error("anonymous_aggregate_conflict");
  await tx.voteEvent.deleteMany({ where: { userId } });
  await tx.vote.deleteMany({ where: { userId } });

  // Counter deltas use only currently visible comments, matching the normal moderation path.
  await tx.$executeRaw`
    WITH removed AS (SELECT poll_id,parent_id FROM comments WHERE author_id=${userId}::uuid AND status='ACTIVE' AND deleted_at IS NULL),
    counts AS (SELECT poll_id,count(*)::int AS n FROM removed GROUP BY poll_id)
    UPDATE polls p SET comment_count=GREATEST(p.comment_count-counts.n,0) FROM counts WHERE p.id=counts.poll_id`;
  await tx.$executeRaw`
    WITH counts AS (SELECT parent_id,count(*)::int AS n FROM comments WHERE author_id=${userId}::uuid
      AND status='ACTIVE' AND deleted_at IS NULL AND parent_id IS NOT NULL GROUP BY parent_id)
    UPDATE comments c SET reply_count=GREATEST(c.reply_count-counts.n,0) FROM counts WHERE c.id=counts.parent_id`;
  await tx.pollRevision.deleteMany({ where: { poll: { authorId: userId } } });
  await tx.commentRevision.deleteMany({ where: { comment: { authorId: userId } } });
  await tx.pollAddendum.deleteMany({ where: { poll: { authorId: userId } } });
  await tx.pollDecision.deleteMany({ where: { poll: { authorId: userId } } });
  await tx.pollTag.deleteMany({ where: { poll: { authorId: userId } } });
  await tx.pollMedia.deleteMany({ where: { poll: { authorId: userId } } });
  await tx.poll.updateMany({ where: { authorId: userId }, data: {
    title: "Silinmiş içerik", slug: "silinmis", description: null, extraInfo: null, priceAmount: null, priceCurrency: null,
    status: "REMOVED", deletedAt: now, commentsClosedAt: now,
  } });
  await tx.pollOption.updateMany({ where: { poll: { authorId: userId } }, data: { label: "Silinmiş seçenek" } });
  await tx.comment.updateMany({ where: { authorId: userId }, data: { body: "[Silinmiş yorum]", status: "REMOVED", deletedAt: now } });
  // These are preference links; remove them with their cached counters.
  await tx.$executeRaw`
    WITH removed AS (DELETE FROM poll_reactions WHERE user_id=${userId}::uuid RETURNING poll_id,value),
    counts AS (SELECT poll_id,count(*) FILTER(WHERE value='LIKE')::int AS likes,count(*) FILTER(WHERE value='DISLIKE')::int AS dislikes FROM removed GROUP BY poll_id)
    UPDATE polls p SET like_count=GREATEST(p.like_count-counts.likes,0),dislike_count=GREATEST(p.dislike_count-counts.dislikes,0) FROM counts WHERE p.id=counts.poll_id`;
  await tx.$executeRaw`
    WITH removed AS (DELETE FROM comment_reactions WHERE user_id=${userId}::uuid RETURNING comment_id,value),
    counts AS (SELECT comment_id,count(*) FILTER(WHERE value='LIKE')::int AS likes,count(*) FILTER(WHERE value='DISLIKE')::int AS dislikes FROM removed GROUP BY comment_id)
    UPDATE comments c SET like_count=GREATEST(c.like_count-counts.likes,0),dislike_count=GREATEST(c.dislike_count-counts.dislikes,0) FROM counts WHERE c.id=counts.comment_id`;
}

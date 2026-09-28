// PollStore'un PostgreSQL/Prisma uygulaması. Tablolar: polls, poll_options, tags, poll_tags,
// poll_media, poll_addenda, votes, idempotency_keys (DATA_MODEL.md, API_CONTRACTS.md §6).
import type { PrismaClient } from "@kararver/db";
import { assertNoCommittedKey, findIdempotentResult, runIdempotent } from "../../http/idempotency.ts";
import {
  PollLimitError,
  PollReferenceError,
  type IdempotencyScope,
  type IdempotentResult,
  type NewPoll,
  type PollRecord,
  type PollSettings,
  type PollStore,
} from "./store.ts";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const pollInclude = (viewerId: string | null) =>
  ({
    author: {
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarMedia: { select: { status: true, publicObjectKey: true } },
      },
    },
    category: { select: { id: true, slug: true, name: true } },
    community: { select: { id: true, slug: true, name: true } },
    options: { select: { id: true, label: true, position: true, voteCount: true }, orderBy: { position: "asc" } },
    tags: { select: { tag: { select: { slug: true } } }, orderBy: { createdAt: "asc" } },
    media: {
      where: { media: { status: "APPROVED" } },
      select: { media: { select: { id: true, publicObjectKey: true, width: true, height: true } } },
      orderBy: { position: "asc" },
    },
    addenda: { select: { id: true, body: true, createdAt: true }, orderBy: { createdAt: "asc" } },
    // İzleyicinin kendi oyu; misafirde hiçbir oy okunmaz.
    votes: { where: { userId: viewerId ?? undefined }, select: { optionId: true, invalidatedAt: true }, take: viewerId ? 1 : 0 },
  }) as const;

/**
 * Anketin başvurduğu satırları FOR SHARE ile kilitleyip yeniden kontrol eder. Kilit commit'e kadar
 * sürer: arada kategori pasife alınamaz, üyelik silinemez, görsel REJECTED yapılamaz; bu işlemler
 * anket yazılana kadar bekler. Kontrol ile yazma arasında değişiklik kalmaz.
 */
async function lockReferences(tx: Tx, poll: NewPoll): Promise<void> {
  const category = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT is_active AS ok FROM categories WHERE id = ${poll.categoryId}::uuid FOR SHARE`;
  if (!category[0]?.ok) throw new PollReferenceError("categoryId", "not_found");

  if (poll.communityId) {
    const community = await tx.$queryRaw<{ active: boolean }[]>`
      SELECT status = 'ACTIVE' AS active FROM communities WHERE id = ${poll.communityId}::uuid FOR SHARE`;
    if (!community[0]?.active) throw new PollReferenceError("communityId", "not_found");
    const membership = await tx.$queryRaw<{ one: number }[]>`
      SELECT 1 AS one FROM community_memberships
      WHERE community_id = ${poll.communityId}::uuid AND user_id = ${poll.authorId}::uuid FOR SHARE`;
    if (membership.length === 0) throw new PollReferenceError("communityId", "not_member");
  }

  const mediaIds = [...new Set(poll.mediaIds)];
  if (mediaIds.length > 0) {
    const usable = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM media_assets
      WHERE id = ANY(${mediaIds}::uuid[]) AND uploader_id = ${poll.authorId}::uuid
        AND purpose = 'POLL' AND status <> 'REJECTED'
      FOR SHARE`;
    if (usable.length !== mediaIds.length) throw new PollReferenceError("mediaIds", "not_usable");
  }
}

type PollRow = NonNullable<Awaited<ReturnType<PrismaClient["poll"]["findUnique"]>>> & {
  author: { id: string; username: string; displayName: string; avatarMedia: { status: string; publicObjectKey: string | null } | null };
  category: { id: string; slug: string; name: string };
  community: { id: string; slug: string; name: string } | null;
  options: { id: string; label: string; position: number; voteCount: number }[];
  tags: { tag: { slug: string } }[];
  media: { media: { id: string; publicObjectKey: string | null; width: number | null; height: number | null } }[];
  addenda: { id: string; body: string; createdAt: Date }[];
  votes: { optionId: string; invalidatedAt: Date | null }[];
};

function toRecord(poll: PollRow): PollRecord {
  const vote = poll.votes[0];
  const avatar = poll.author.avatarMedia;
  const record: PollRecord = {
    id: poll.id,
    publicId: poll.publicId,
    slug: poll.slug,
    title: poll.title,
    description: poll.description,
    extraInfo: poll.extraInfo,
    priceAmount: poll.priceAmount === null ? null : poll.priceAmount.toFixed(2),
    priceCurrency: poll.priceCurrency,
    status: poll.status,
    resultsVisibility: poll.resultsVisibility,
    allowComments: poll.allowComments,
    opensAt: poll.opensAt,
    closesAt: poll.closesAt,
    closedAt: poll.closedAt,
    firstValidVoteAt: poll.firstValidVoteAt,
    commentCount: poll.commentCount,
    createdAt: poll.createdAt,
    author: {
      id: poll.author.id,
      username: poll.author.username,
      displayName: poll.author.displayName,
      avatarPublicKey: avatar?.status === "APPROVED" ? avatar.publicObjectKey : null,
    },
    category: poll.category,
    community: poll.community,
    options: poll.options,
    tags: poll.tags.map((t) => t.tag.slug),
    media: poll.media
      .filter((m) => m.media.publicObjectKey !== null)
      .map((m) => ({ id: m.media.id, publicKey: m.media.publicObjectKey!, width: m.media.width, height: m.media.height })),
    addenda: poll.addenda,
    viewerVote: vote ? { optionId: vote.optionId, invalidated: vote.invalidatedAt !== null } : null,
  };
  return record;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * Yayın limitleri (KV-20). Yazarın satırı kilitli olduğu için aynı yazarın eşzamanlı istekleri sıraya
 * girer ve sayım güvenilirdir. Kaldırılmış anketler de sayılır: sil-yeniden-aç limiti aşamaz.
 */
async function enforcePublishLimits(tx: Tx, poll: NewPoll, userCreatedAt: Date, limits: PollSettings): Promise<void> {
  const now = poll.opensAt;
  const isNewAccount = now.getTime() - userCreatedAt.getTime() < limits.newAccountPeriodDays * DAY_MS;
  const dailyLimit = isNewAccount ? limits.newAccountDailyLimit : limits.dailyLimit;
  const cooldownMs = (isNewAccount ? limits.newAccountCooldownMinutes : limits.cooldownMinutes) * MINUTE_MS;
  const windowStart = new Date(now.getTime() - DAY_MS);

  const recent = await tx.poll.findMany({
    where: { authorId: poll.authorId, opensAt: { gt: windowStart } },
    select: { opensAt: true },
    orderBy: { opensAt: "asc" },
  });
  const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));
  if (recent.length >= dailyLimit) {
    // Pencerede limit - 1 anket kalınca yeni yayın açılır: en eski (count - limit + 1). anket düşmeli.
    const expiring = recent[recent.length - dailyLimit]!.opensAt;
    throw new PollLimitError("DAILY_PUBLISH_LIMIT", seconds(expiring.getTime() + DAY_MS - now.getTime()));
  }
  const last = recent[recent.length - 1]?.opensAt;
  if (last && now.getTime() - last.getTime() < cooldownMs) {
    throw new PollLimitError("PUBLISH_COOLDOWN", seconds(last.getTime() + cooldownMs - now.getTime()));
  }

  // Aynı başlık: yazarın hâlâ açık (kapanmamış, kaldırılmamış) bir anketiyle aynı başlık, Türkçe
  // karakter ve büyük/küçük harf farkı gözetmeden (kv_normalize).
  const duplicate = await tx.$queryRaw<{ one: number }[]>`
    SELECT 1 AS one FROM polls
    WHERE author_id = ${poll.authorId}::uuid AND status <> 'REMOVED'
      AND closed_at IS NULL AND closes_at > ${now.toISOString()}::timestamptz
      AND kv_normalize(title) = kv_normalize(${poll.title})
    LIMIT 1`;
  if (duplicate.length > 0) throw new PollLimitError("DUPLICATE_TITLE", null);
}

export function createPrismaPollStore(prisma: PrismaClient): PollStore {
  async function replaceTags(tx: Tx, pollId: string, slugs: string[]): Promise<void> {
    await tx.pollTag.deleteMany({ where: { pollId } });
    for (const slug of [...new Set(slugs)]) {
      const tag = await tx.tag.upsert({ where: { slug }, create: { slug, name: slug }, update: {}, select: { id: true } });
      await tx.pollTag.create({ data: { pollId, tagId: tag.id } });
    }
  }

  /** runIdempotent'in "rejected" sonucu anket işlerinde oluşmaz: ret istisna olarak fırlatılır. */
  async function idempotent(scope: IdempotencyScope | null, work: (tx: Tx) => Promise<string>): Promise<IdempotentResult> {
    const result = await runIdempotent(prisma, scope, 201, async (tx) => ({ ok: true as const, value: await work(tx) }));
    if (result.kind === "rejected") throw new Error("beklenmeyen rejected sonucu");
    return result;
  }

  return {
    findIdempotentResult: (scope) => findIdempotentResult(prisma, scope),

    async findPoll(by, viewerId) {
      const poll = await prisma.poll.findUnique({ where: by, include: pollInclude(viewerId) });
      return poll ? toRecord(poll as PollRow) : null;
    },

    async listByIds(ids, viewerId) {
      if (ids.length === 0) return [];
      const rows = await prisma.poll.findMany({
        where: { id: { in: ids }, status: { in: ["ACTIVE", "LOCKED"] } },
        include: pollInclude(viewerId),
      });
      const byId = new Map(rows.map((row) => [row.id, toRecord(row as PollRow)]));
      return ids.flatMap((id) => byId.get(id) ?? []);
    },

    async listFeed({ tab, categoryId, communityId, after, limit, viewerId }) {
      // Sıralama: new → opensAt ↓, id ↓ · top → voteCount ↓, opensAt ↓, id ↓ (deterministik).
      const fields = tab === "top" ? (["voteCount", "opensAt"] as const) : (["opensAt"] as const);
      const value = (name: string, k: string | number) => (name === "opensAt" ? new Date(k as string) : Number(k));
      const keyset = after
        ? {
            OR: [...fields, "id" as const].map((_, i) => {
              const clause: Record<string, unknown> = {};
              for (let j = 0; j < i; j++) clause[fields[j]!] = value(fields[j]!, after.keys[j]!);
              if (i < fields.length) clause[fields[i]!] = { lt: value(fields[i]!, after.keys[i]!) };
              else clause.id = { lt: after.id };
              return clause;
            }),
          }
        : {};
      const rows = await prisma.poll.findMany({
        where: {
          // Gizli, incelemede ve kaldırılmış içerik feed'e girmez.
          status: { in: ["ACTIVE", "LOCKED"] },
          ...(categoryId ? { categoryId } : {}),
          ...(communityId ? { communityId } : {}),
          ...keyset,
        },
        include: pollInclude(viewerId),
        orderBy: [...fields.map((f) => ({ [f]: "desc" as const })), { id: "desc" as const }],
        take: limit,
      });
      return rows.map((row) => ({ ...toRecord(row as PollRow), voteCount: row.voteCount }));
    },

    findPollMeta: (id) =>
      prisma.poll.findUnique({
        where: { id },
        select: { authorId: true, status: true, firstValidVoteAt: true, closedAt: true, closesAt: true },
      }),

    async isActiveCategory(categoryId) {
      return (await prisma.category.count({ where: { id: categoryId, isActive: true } })) > 0;
    },

    async communityAccess(communityId, userId) {
      const community = await prisma.community.findUnique({
        where: { id: communityId },
        select: { status: true, memberships: { where: { userId }, select: { role: true }, take: 1 } },
      });
      if (!community || community.status !== "ACTIVE") return "not_found";
      return community.memberships.length > 0 ? "ok" : "not_member";
    },

    async areUsablePollMedia(userId, mediaIds) {
      if (mediaIds.length === 0) return true;
      const unique = [...new Set(mediaIds)];
      const count = await prisma.mediaAsset.count({
        where: { id: { in: unique }, uploaderId: userId, purpose: "POLL", status: { not: "REJECTED" } },
      });
      return count === unique.length;
    },

    async publicIdExists(publicId) {
      return (await prisma.poll.count({ where: { publicId } })) > 0;
    },

    createPoll: (poll, scope, limits) =>
      idempotent(scope, async (tx) => {
        const [author] = await tx.$queryRaw<{ created_at: Date }[]>`
          SELECT created_at FROM users WHERE id = ${poll.authorId}::uuid FOR UPDATE`;
        // Kilidi beklerken aynı anahtarlı istek tamamlandıysa limit değil kayıtlı sonuç döner.
        await assertNoCommittedKey(tx, scope);
        await enforcePublishLimits(tx, poll, author!.created_at, limits);
        await lockReferences(tx, poll);
        const created = await tx.poll.create({
          data: {
            publicId: poll.publicId,
            slug: poll.slug,
            authorId: poll.authorId,
            categoryId: poll.categoryId,
            communityId: poll.communityId,
            title: poll.title,
            description: poll.description,
            priceAmount: poll.priceAmount,
            priceCurrency: poll.priceCurrency,
            extraInfo: poll.extraInfo,
            allowComments: poll.allowComments,
            resultsVisibility: poll.resultsVisibility,
            opensAt: poll.opensAt,
            closesAt: poll.closesAt,
            options: { create: poll.options.map((label, position) => ({ label, position })) },
            media: { create: [...new Set(poll.mediaIds)].map((mediaId, position) => ({ mediaId, position })) },
          },
          select: { id: true },
        });
        await replaceTags(tx, created.id, poll.tagSlugs);
        return created.id;
      }),

    async updatePoll(id, patch) {
      const { tagSlugs, options, ...fields } = patch;
      await prisma.$transaction(async (tx) => {
        if (Object.keys(fields).length > 0) await tx.poll.update({ where: { id }, data: fields });
        if (tagSlugs) await replaceTags(tx, id, tagSlugs);
        if (options) {
          // Kilitsiz ankette hiç oy yoktur (ilk geçerli oy anketi kalıcı kilitler; DATA_MODEL §6),
          // bu yüzden seçenekler silinip aynı id'lerle yeniden yazılabilir. Bu, (poll_id, position)
          // unique kısıtına takılmadan yeniden sıralamayı mümkün kılar. Kilitliyse trigger reddeder.
          await tx.pollOption.deleteMany({ where: { pollId: id } });
          await tx.pollOption.createMany({
            data: options.map((o, position) => ({ ...(o.id ? { id: o.id } : {}), pollId: id, label: o.label, position })),
          });
        }
      });
    },

    async closePoll(id, now) {
      await prisma.poll.updateMany({ where: { id, closedAt: null, closesAt: { gt: now } }, data: { closedAt: now } });
    },

    async removePoll(id, now) {
      await prisma.poll.updateMany({ where: { id, status: { not: "REMOVED" } }, data: { status: "REMOVED", deletedAt: now } });
    },

    createAddendum: (pollId, body, scope) =>
      idempotent(scope, async (tx) => {
        const addendum = await tx.pollAddendum.create({ data: { pollId, body }, select: { id: true } });
        return addendum.id;
      }),

    findAddendum: (id) => prisma.pollAddendum.findUnique({ where: { id }, select: { id: true, body: true, createdAt: true } }),
  };
}

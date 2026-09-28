// PollStore'un PostgreSQL/Prisma uygulaması. Tablolar: polls, poll_options, tags, poll_tags,
// poll_media, poll_addenda, votes, idempotency_keys (DATA_MODEL.md, API_CONTRACTS.md §6).
import type { PrismaClient } from "@kararver/db";
import type { IdempotencyScope, IdempotentResult, PollRecord, PollStore } from "./store.ts";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

function isUniqueViolation(err: unknown, field?: string): boolean {
  if (typeof err !== "object" || err === null || (err as { code?: unknown }).code !== "P2002") return false;
  if (!field) return true;
  return JSON.stringify((err as { meta?: unknown }).meta ?? {}).includes(field);
}

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

export function createPrismaPollStore(prisma: PrismaClient): PollStore {
  /**
   * İşlem ve idempotency kaydı aynı transaction'dadır; kayıt en sonda eklenir. Aynı anahtarla gelen
   * eşzamanlı istek unique index'te bekler, ilki commit edince çakışma alır ve bütün işi geri alınır;
   * sonra kaydedilen sonuç okunur. Böylece aynı anahtar en fazla bir kaynak üretir.
   */
  async function idempotent(scope: IdempotencyScope | null, status: number, work: (tx: Tx) => Promise<string>): Promise<IdempotentResult> {
    if (!scope) return { kind: "created", resourceId: await prisma.$transaction((tx) => work(tx)) };
    const where = { userId: scope.userId, route: scope.route, key: scope.key };

    const replay = async (): Promise<IdempotentResult | null> => {
      const row = await prisma.idempotencyKey.findUnique({ where: { userId_route_key: where } });
      if (!row || row.expiresAt <= scope.now) return null;
      if (row.requestHash !== scope.requestHash) return { kind: "key_reused" };
      return { kind: "replayed", resourceId: row.resourceId, status: row.responseStatus };
    };

    const earlier = await replay();
    if (earlier) return earlier;
    await prisma.idempotencyKey.deleteMany({ where: { ...where, expiresAt: { lte: scope.now } } });

    try {
      const resourceId = await prisma.$transaction(async (tx) => {
        const id = await work(tx);
        await tx.idempotencyKey.create({
          data: {
            ...where,
            requestHash: scope.requestHash,
            responseStatus: status,
            resourceId: id,
            createdAt: scope.now,
            expiresAt: new Date(scope.now.getTime() + scope.ttlMs),
          },
        });
        return id;
      });
      return { kind: "created", resourceId };
    } catch (err) {
      if (!isUniqueViolation(err, "key")) throw err;
      const later = await replay();
      if (!later) throw err;
      return later;
    }
  }

  async function replaceTags(tx: Tx, pollId: string, slugs: string[]): Promise<void> {
    await tx.pollTag.deleteMany({ where: { pollId } });
    for (const slug of [...new Set(slugs)]) {
      const tag = await tx.tag.upsert({ where: { slug }, create: { slug, name: slug }, update: {}, select: { id: true } });
      await tx.pollTag.create({ data: { pollId, tagId: tag.id } });
    }
  }

  return {
    async findPoll(by, viewerId) {
      const poll = await prisma.poll.findUnique({ where: by, include: pollInclude(viewerId) });
      if (!poll) return null;
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

    createPoll: (poll, scope) =>
      idempotent(scope, 201, async (tx) => {
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
      idempotent(scope, 201, async (tx) => {
        const addendum = await tx.pollAddendum.create({ data: { pollId, body }, select: { id: true } });
        return addendum.id;
      }),

    findAddendum: (id) => prisma.pollAddendum.findUnique({ where: { id }, select: { id: true, body: true, createdAt: true } }),
  };
}

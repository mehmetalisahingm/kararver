// KVKK veri paketi içeriği — #181. Kapsam, dışarıda bırakılanlar ve nedenleri: docs/KV-33_ADMIN_USERS.md §8.
//
// İlke: paket kullanıcının KENDİ verisini içerir. Başkasının kimliği (raporlayan, yaptırımı uygulayan yönetici, bildirimi
// tetikleyen kullanıcı), kimlik sırları (parola özeti, oturum/token özetleri) ve kötüye kullanım tespitinin iç sinyalleri
// (görsel risk skorları, raporlayan kimliği) pakete girmez. Her koleksiyon açık `select` ile okunur: şemaya sonradan eklenen
// bir sütun, burada bilinçli eklenmedikçe pakete SIZMAZ.
import type { PrismaClient } from "@kararver/db";

export const PACKAGE_SCHEMA_VERSION = 1;
/** Bir koleksiyondan okunan en çok satır; aşılırsa paket kırpılmaz, iş too_large ile başarısız olur. */
export const MAX_ROWS_PER_COLLECTION = 50_000;

export class PackageTooLargeError extends Error {}

export type DataPackage = {
  schemaVersion: typeof PACKAGE_SCHEMA_VERSION;
  generatedAt: string;
  profile: Record<string, unknown>;
  collections: Record<string, Record<string, unknown>[]>;
};

export async function collectPackage(prisma: PrismaClient, userId: string, now: Date): Promise<DataPackage> {
  const where = { userId };
  const take = MAX_ROWS_PER_COLLECTION + 1;
  const asc = { createdAt: "asc" } as const;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      bio: true,
      status: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
      avatarMediaId: true,
      role: { select: { role: true } },
      pointAccount: { select: { balance: true } },
    },
  });
  const { role, pointAccount, ...account } = user;

  const collections: Record<string, Record<string, unknown>[]> = {
    polls: await prisma.poll.findMany({
      where: { authorId: userId },
      orderBy: asc,
      take,
      select: {
        id: true,
        publicId: true,
        kind: true,
        title: true,
        description: true,
        priceAmount: true,
        priceCurrency: true,
        extraInfo: true,
        status: true,
        resultsVisibility: true,
        allowComments: true,
        categoryId: true,
        communityId: true,
        opensAt: true,
        closesAt: true,
        closedAt: true,
        voteCount: true,
        commentCount: true,
        createdAt: true,
        deletedAt: true,
        options: { orderBy: { position: "asc" }, select: { position: true, label: true, voteCount: true } },
        addenda: { orderBy: asc, select: { id: true, body: true, createdAt: true } },
      },
    }),
    comments: await prisma.comment.findMany({
      where: { authorId: userId },
      orderBy: asc,
      take,
      select: { id: true, pollId: true, parentId: true, kind: true, body: true, status: true, editedAt: true, createdAt: true, deletedAt: true },
    }),
    // Kullanıcının kendi oyu kendisine gösterilir (oy başkasına gösterilmez, bu paket yalnız sahibine gider).
    votes: await prisma.vote.findMany({
      where,
      orderBy: asc,
      take,
      select: {
        id: true,
        pollId: true,
        optionId: true,
        changeCount: true,
        invalidatedAt: true,
        invalidationReason: true,
        createdAt: true,
        updatedAt: true,
        poll: { select: { title: true } },
        option: { select: { label: true } },
      },
    }),
    voteEvents: await prisma.voteEvent.findMany({
      where,
      orderBy: { occurredAt: "asc" },
      take,
      select: { id: true, voteId: true, pollId: true, type: true, fromOptionId: true, toOptionId: true, reason: true, occurredAt: true },
    }),
    pollReactions: await prisma.pollReaction.findMany({ where, orderBy: asc, take, select: { pollId: true, value: true, createdAt: true } }),
    commentReactions: await prisma.commentReaction.findMany({ where, orderBy: asc, take, select: { commentId: true, value: true, createdAt: true } }),
    bookmarks: await prisma.bookmark.findMany({ where, orderBy: asc, take, select: { pollId: true, createdAt: true } }),
    pollFollows: await prisma.pollFollow.findMany({ where, orderBy: asc, take, select: { pollId: true, createdAt: true } }),
    interests: await prisma.userInterest.findMany({ where, orderBy: asc, take, select: { categoryId: true, createdAt: true, category: { select: { name: true } } } }),
    pointLedger: await prisma.pointLedgerEntry.findMany({
      where,
      orderBy: asc,
      take,
      select: { id: true, delta: true, balanceAfter: true, reason: true, referenceId: true, createdAt: true },
    }),
    // actorId (bildirimi tetikleyen başka kullanıcı) bilerek yok.
    notifications: await prisma.notification.findMany({
      where: { recipientId: userId },
      orderBy: asc,
      take,
      select: { id: true, type: true, subjectType: true, subjectId: true, pollId: true, data: true, readAt: true, createdAt: true },
    }),
    notificationOptOuts: await prisma.notificationTypeOptOut.findMany({ where, take, select: { type: true, createdAt: true } }),
    notificationPollMutes: await prisma.notificationPollMute.findMany({ where, take, select: { pollId: true, createdAt: true } }),
    // Kullanıcının yaptığı raporlar. Hakkındaki raporlar, raporlayanın güvenliği için pakette yoktur.
    reportsFiled: await prisma.report.findMany({
      where: { reporterId: userId },
      orderBy: asc,
      take,
      select: { id: true, pollId: true, commentId: true, mediaId: true, reportedUserId: true, reason: true, details: true, status: true, resolvedAt: true, createdAt: true },
    }),
    // Uygulayan/kaldıran yönetici kimliği yok.
    sanctions: await prisma.sanction.findMany({
      where,
      orderBy: asc,
      take,
      select: { id: true, type: true, reason: true, startsAt: true, endsAt: true, liftedAt: true, liftReason: true, createdAt: true },
    }),
    moderationActions: await prisma.moderationAction.findMany({
      where: {
        OR: [{ targetUserId: userId }, { poll: { authorId: userId } }, { comment: { authorId: userId } }, { media: { uploaderId: userId } }],
      },
      orderBy: asc,
      take,
      select: { id: true, action: true, pollId: true, commentId: true, mediaId: true, fromStatus: true, toStatus: true, reason: true, createdAt: true },
    }),
    communityMemberships: await prisma.communityMembership.findMany({
      where,
      orderBy: asc,
      take,
      select: { communityId: true, role: true, createdAt: true, community: { select: { name: true, slug: true } } },
    }),
    communityRequests: await prisma.communityRequest.findMany({
      where: { requesterId: userId },
      orderBy: asc,
      take,
      select: { id: true, name: true, slug: true, description: true, status: true, rejectionReason: true, approvedAt: true, closedAt: true, createdAt: true },
    }),
    // Yalnız yükleme kaydı; dosyanın kendisi ve risk skorları/etiketleri (kötüye kullanım sinyali) pakette yok.
    media: await prisma.mediaAsset.findMany({
      where: { uploaderId: userId },
      orderBy: asc,
      take,
      select: { id: true, purpose: true, status: true, originalMimeType: true, originalSizeBytes: true, width: true, height: true, createdAt: true },
    }),
    // Oturum belirteci özeti yok; IP ve cihaz bilgisi kullanıcının kendi kişisel verisidir.
    sessions: await prisma.session.findMany({
      where,
      orderBy: asc,
      take,
      select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true, ipAddress: true, userAgent: true },
    }),
  };

  for (const [name, rows] of Object.entries(collections)) {
    if (rows.length > MAX_ROWS_PER_COLLECTION) throw new PackageTooLargeError(`${name}: > ${MAX_ROWS_PER_COLLECTION} satır`);
  }

  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    profile: { ...account, role: role?.role ?? "USER", pointBalance: pointAccount?.balance ?? 0 },
    collections,
  };
}

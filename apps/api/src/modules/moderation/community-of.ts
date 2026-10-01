// Moderasyon yetkisi topluluğa bağlıdır (KV-04 media.review / report.resolve: communityId zorunlu).
// Topluluk kaynağın kendisinden DB'de okunur, istekten alınmaz. Topluluğu olmayan hedef null döner ve
// yalnız ADMIN+ tarafından işlenebilir.
import type { Prisma, PrismaClient } from "@kararver/db";

export type TargetRef = { type: "POLL" | "COMMENT" | "MEDIA" | "USER"; id: string };
type Db = PrismaClient | Prisma.TransactionClient;

/** Görsel, topluluk anketinin galerisindeyse o topluluğa; topluluk görseliyse o topluluğa bağlıdır. */
export async function communityOfMedia(db: Db, mediaId: string): Promise<string | null> {
  const viaPoll = await db.pollMedia.findFirst({
    where: { mediaId, poll: { communityId: { not: null } } },
    select: { poll: { select: { communityId: true } } },
  });
  if (viaPoll?.poll.communityId) return viaPoll.poll.communityId;
  const asImage = await db.community.findFirst({ where: { imageMediaId: mediaId }, select: { id: true } });
  return asImage?.id ?? null;
}

export async function communityOfTarget(db: Db, target: TargetRef): Promise<string | null> {
  switch (target.type) {
    case "POLL":
      return (await db.poll.findUnique({ where: { id: target.id }, select: { communityId: true } }))?.communityId ?? null;
    case "COMMENT":
      return (await db.comment.findUnique({ where: { id: target.id }, select: { poll: { select: { communityId: true } } } }))?.poll.communityId ?? null;
    case "MEDIA":
      return communityOfMedia(db, target.id);
    case "USER":
      return null;
  }
}

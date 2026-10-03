// KV-21 (#23) bildirim store'u (PostgreSQL). Her sorgunun ilk koşulu recipient_id'dir; index'ler buna göre:
// liste (recipient_id, created_at ↓, id ↓), okunmamış sayısı ve "hepsi" partial index notifications_unread_idx.
import type { Prisma, PrismaClient } from "@kararver/db";
import type { NotificationRecord, NotificationStore } from "./store.ts";

const select = {
  id: true,
  type: true,
  subjectType: true,
  subjectId: true,
  data: true,
  readAt: true,
  createdAt: true,
  actor: {
    select: {
      id: true,
      username: true,
      displayName: true,
      deletedAt: true,
      avatarMedia: { select: { status: true, publicObjectKey: true } },
    },
  },
} satisfies Prisma.NotificationSelect;

type Row = Prisma.NotificationGetPayload<{ select: typeof select }>;

function toRecord({ actor, subjectType, subjectId, data, ...n }: Row): NotificationRecord {
  return {
    ...n,
    subject: { type: subjectType as NotificationRecord["subject"]["type"], id: subjectId },
    // Silinmiş hesabın adı bildirimde de gösterilmez.
    actor:
      actor && !actor.deletedAt
        ? {
            id: actor.id,
            username: actor.username,
            displayName: actor.displayName,
            avatarPublicKey: actor.avatarMedia?.status === "APPROVED" ? actor.avatarMedia.publicObjectKey : null,
          }
        : null,
    // DB CHECK nesne olmasını zorlar; içeriği teslim job'u contracts şemasıyla yazar.
    data: data as NotificationRecord["data"],
  };
}

export function createPrismaNotificationStore(prisma: PrismaClient): NotificationStore {
  return {
    async list(recipientId, { unreadOnly, after, limit }) {
      const rows = await prisma.notification.findMany({
        where: {
          recipientId,
          ...(unreadOnly ? { readAt: null } : {}),
          ...(after
            ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        select,
      });
      return rows.map(toRecord);
    },

    unreadCount: (recipientId) => prisma.notification.count({ where: { recipientId, readAt: null } }),

    async markRead(recipientId, target, now) {
      const { count } = await prisma.notification.updateMany({
        where: { recipientId, readAt: null, ...("ids" in target ? { id: { in: target.ids } } : {}) },
        data: { readAt: now },
      });
      return count;
    },
  };
}

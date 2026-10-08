// KV-21 (#23) bildirim store'u (PostgreSQL). Her sorgunun ilk koşulu recipient_id'dir; index'ler buna göre:
// liste (recipient_id, created_at ↓, id ↓), okunmamış sayısı ve "hepsi" partial index notifications_unread_idx.
import type { Prisma, PrismaClient } from "@kararver/db";
import type { NotificationRecord, NotificationStore } from "./store.ts";

const select = {
  id: true,
  type: true,
  subjectType: true,
  subjectId: true,
  pollId: true,
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
      // read_at ≥ created_at (CHECK notifications_read_after_created_check). created_at olayın anıdır (başka süreç/saat);
      // API saati birkaç ms geride kalırsa satır yazılamıyor ve istek 500 oluyordu. Okunma anı en az oluşturma anıdır.
      const ids = "ids" in target ? target.ids : null;
      return prisma.$executeRaw`
        UPDATE notifications SET read_at = GREATEST(${now}::timestamptz, created_at)
        WHERE recipient_id = ${recipientId}::uuid AND read_at IS NULL
          AND (${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[]))`;
    },

    async optedOut(userId) {
      const rows = await prisma.notificationTypeOptOut.findMany({ where: { userId }, select: { type: true }, orderBy: { type: "asc" } });
      return rows.map((r) => r.type);
    },

    async setPreferences(userId, types) {
      const off = Object.entries(types).filter(([, on]) => on === false).map(([t]) => t as NotificationRecord["type"]);
      const on = Object.entries(types).filter(([, on]) => on === true).map(([t]) => t as NotificationRecord["type"]);
      await prisma.$transaction([
        prisma.notificationTypeOptOut.deleteMany({ where: { userId, type: { in: on } } }),
        prisma.notificationTypeOptOut.createMany({ data: off.map((type) => ({ userId, type })), skipDuplicates: true }),
      ]);
    },

    async mutePoll(userId, pollId) {
      // Anket yoksa FK hatası yerine 0 satır: INSERT … SELECT yalnız var olan ankete yazar; tekrar ON CONFLICT ile atlanır.
      const written = await prisma.$executeRaw`
        INSERT INTO notification_poll_mutes (user_id, poll_id)
        SELECT ${userId}::uuid, p.id FROM polls p WHERE p.id = ${pollId}::uuid
        ON CONFLICT (user_id, poll_id) DO NOTHING`;
      if (written > 0) return true;
      return (await prisma.poll.count({ where: { id: pollId } })) > 0;
    },

    async unmutePoll(userId, pollId) {
      await prisma.notificationPollMute.deleteMany({ where: { userId, pollId } });
    },
  };
}

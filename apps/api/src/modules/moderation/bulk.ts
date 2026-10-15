// Toplu moderasyon veri erişimi — #183 (KV-37 §bulk). Kurallar: docs/KV-37_BULK_MODERATION.md.
//
// Bu dosya yalnız (1) seçilen kayıtların durumunu okur (önizleme/özet), (2) parti kaydını tutar. Kararın kendisi her kayıt için
// mevcut `ModerationStore.apply` yoludur (satır kilidi, geçiş tablosu, sayaçlar, moderation_actions, audit, olay outbox'ı):
// toplu işlem yeni bir yazma yolu AÇMAZ, yetki ve geçiş kuralları tekil moderasyonla aynıdır.
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@kararver/db";
import { communityOfTarget } from "./community-of.ts";
import type { ContentKind, ContentStatus, ListAfter } from "./store.ts";

export type BulkAction = "HIDE" | "REMOVE" | "RESTORE";

/** Önizleme/özet için okunan durum. `label` yalnız yetkili kayıtta kullanılır (içerik sızmaz). */
export type BulkItemState = { id: string; label: string; status: ContentStatus; communityId: string | null };

export type BatchRow = {
  id: string;
  kind: ContentKind;
  action: BulkAction;
  reason: string;
  actor: { id: string; username: string; displayName: string; avatarPublicKey: string | null };
  total: number;
  applied: number;
  unchanged: number;
  failed: number;
  createdAt: Date;
  finishedAt: Date | null;
};

export type BatchItemRecord = {
  targetId: string;
  communityId: string | null;
  result: "APPLIED" | "UNCHANGED" | "FAILED";
  detail: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  moderationActionId: string | null;
};

export interface BulkModerationStore {
  /** Bulunan kayıtların durumu; olmayan kimlik haritada yoktur. */
  inspect(kind: ContentKind, ids: string[]): Promise<Map<string, BulkItemState>>;
  /** Parti kaydını açar (sayılar 0); öğeler işlendikçe yazılır, sonunda `finishBatch`. */
  startBatch(input: { actorId: string; kind: ContentKind; action: BulkAction; reason: string; digest: string; requestId: string | null; total: number; now: Date }): Promise<string>;
  recordItem(batchId: string, item: BatchItemRecord, now: Date): Promise<void>;
  finishBatch(batchId: string, counts: { applied: number; unchanged: number; failed: number }, now: Date): Promise<void>;
  /** Aktörün `since` sonrası açtığı parti sayısı (saatlik sınır). */
  recentBatchCount(actorId: string, since: Date): Promise<number>;
  listBatches(filter: { actorId?: string; after: ListAfter }, limit: number): Promise<BatchRow[]>;
}

/**
 * Önizleme özeti: işlem türü, işlem ve seçilen HER kimliğin (id, durum, topluluk) sıralı listesi. Onayda aynı hesap yeniden
 * yapılır; fark varsa (durum/topluluk değişti, kayıt silindi/eklendi) parti açılmaz. Kimlik sırası özeti etkilemez.
 */
export function batchDigest(kind: ContentKind, action: BulkAction, ids: string[], states: Map<string, BulkItemState>): string {
  const lines = [...ids].sort().map((id) => {
    const s = states.get(id);
    return `${id}|${s ? s.status : "-"}|${s ? (s.communityId ?? "-") : "-"}`;
  });
  return createHash("sha256").update(`${kind}\n${action}\n${lines.join("\n")}`).digest("hex");
}

type Db = Prisma.TransactionClient | PrismaClient;

export function createPrismaBulkModerationStore(prisma: PrismaClient): BulkModerationStore {
  const ref = (u: { id: string; username: string; displayName: string; avatarMedia: { status: string; publicObjectKey: string | null } | null }) => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarPublicKey: u.avatarMedia?.status === "APPROVED" ? u.avatarMedia.publicObjectKey : null,
  });

  async function inspect(db: Db, kind: ContentKind, ids: string[]): Promise<Map<string, BulkItemState>> {
    const out = new Map<string, BulkItemState>();
    if (kind === "polls") {
      const rows = await db.poll.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, status: true } });
      for (const r of rows) out.set(r.id, { id: r.id, label: r.title.slice(0, 80), status: r.status, communityId: await communityOfTarget(db, { type: "POLL", id: r.id }) });
    } else {
      const rows = await db.comment.findMany({ where: { id: { in: ids } }, select: { id: true, body: true, status: true } });
      for (const r of rows) out.set(r.id, { id: r.id, label: r.body.slice(0, 80), status: r.status, communityId: await communityOfTarget(db, { type: "COMMENT", id: r.id }) });
    }
    return out;
  }

  return {
    inspect: (kind, ids) => inspect(prisma, kind, ids),

    async startBatch(input) {
      const row = await prisma.moderationBatch.create({
        data: {
          actorId: input.actorId,
          kind: input.kind === "polls" ? "POLLS" : "COMMENTS",
          action: input.action,
          reason: input.reason,
          digest: input.digest,
          requestId: input.requestId,
          total: input.total,
          createdAt: input.now,
        },
        select: { id: true },
      });
      return row.id;
    },

    async recordItem(batchId, item, now) {
      await prisma.moderationBatchItem.create({
        data: {
          batchId,
          targetId: item.targetId,
          communityId: item.communityId,
          result: item.result,
          detail: item.detail,
          fromStatus: item.fromStatus,
          toStatus: item.toStatus,
          moderationActionId: item.moderationActionId,
          createdAt: now,
        },
      });
    },

    async finishBatch(batchId, counts, now) {
      await prisma.moderationBatch.update({ where: { id: batchId }, data: { ...counts, finishedAt: now } });
    },

    recentBatchCount: (actorId, since) => prisma.moderationBatch.count({ where: { actorId, createdAt: { gt: since } } }),

    async listBatches(filter, limit) {
      const after = filter.after;
      const rows = await prisma.moderationBatch.findMany({
        where: {
          ...(filter.actorId ? { actorId: filter.actorId } : {}),
          ...(after ? { OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }] } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: {
          id: true,
          kind: true,
          action: true,
          reason: true,
          total: true,
          applied: true,
          unchanged: true,
          failed: true,
          createdAt: true,
          finishedAt: true,
          actor: { select: { id: true, username: true, displayName: true, avatarMedia: { select: { status: true, publicObjectKey: true } } } },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind === "POLLS" ? ("polls" as const) : ("comments" as const),
        action: r.action as BulkAction,
        reason: r.reason,
        actor: ref(r.actor),
        total: r.total,
        applied: r.applied,
        unchanged: r.unchanged,
        failed: r.failed,
        createdAt: r.createdAt,
        finishedAt: r.finishedAt,
      }));
    },
  };
}

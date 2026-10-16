// Toplu moderasyon veri erişimi — #183 (KV-37 §bulk). Kurallar: docs/KV-37_BULK_MODERATION.md.
//
// Bu dosya yalnız (1) seçilen kayıtların durumunu okur (önizleme/özet), (2) parti kaydını tutar. Kararın kendisi her kayıt için
// mevcut `ModerationStore.apply` yoludur (satır kilidi, geçiş tablosu, sayaçlar, moderation_actions, audit, olay outbox'ı):
// toplu işlem yeni bir yazma yolu AÇMAZ, yetki ve geçiş kuralları tekil moderasyonla aynıdır.
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@kararver/db";
import { communityOfTarget } from "./community-of.ts";
import type { ContentKind, ContentStatus, ListAfter } from "./store.ts";

/** Aktör başına saatlik parti sınırı (toplu işlem ve geri alma partileri birlikte sayılır). */
export const BATCH_HOURLY_LIMIT = 20;

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
  undoOfId: string | null;
  /** Bu partinin kararlarından geri alınmış olanların sayısı. */
  undone: number;
  /** Bitmiş, geri alma olmayan ve geri alınmamış uygulanmış kararı kalan parti. */
  undoable: boolean;
};

/** Geri alma için okunan parti: yalnız UYGULANMIŞ kararlar (APPLIED) ve onları geri alan partinin kimliği. */
export type UndoBatch = {
  id: string;
  actorId: string;
  kind: ContentKind;
  action: BulkAction;
  undoOfId: string | null;
  finishedAt: Date | null;
  items: Array<{ targetId: string; communityId: string | null; fromStatus: string | null; toStatus: string | null; moderationActionId: string; undoneByBatchId: string | null }>;
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
  startBatch(input: { actorId: string; kind: ContentKind; action: BulkAction; reason: string; digest: string; requestId: string | null; total: number; now: Date; undoOfId?: string | null }): Promise<string>;
  /** Geri alma önizlemesi/uygulaması için parti ve uygulanmış öğeleri; yoksa null. */
  loadBatch(id: string): Promise<UndoBatch | null>;
  /** Hedef başına SON moderasyon kararının kimliği (sürüm koşulu önizlemesi; kesin karar apply içinde kilit altındadır). */
  latestActions(kind: ContentKind, ids: string[]): Promise<Map<string, string>>;
  /** İçerik sahibi silinmiş/anonimleştirilmiş hedefler: bunların içeriği asla geri getirilmez. */
  erasedAuthors(kind: ContentKind, ids: string[]): Promise<Set<string>>;
  /** Öğeyi geri alındı olarak işaretler; zaten işaretliyse false (öğe başına en çok bir geri alma). */
  markUndone(batchId: string, targetId: string, undoBatchId: string): Promise<boolean>;
  recordItem(batchId: string, item: BatchItemRecord, now: Date): Promise<void>;
  finishBatch(batchId: string, counts: { applied: number; unchanged: number; failed: number }, now: Date): Promise<void>;
  /** Aktörün `since` sonrası açtığı parti sayısı (saatlik sınır). */
  recentBatchCount(actorId: string, since: Date): Promise<number>;
  /**
   * Aktörün `since` sonrası ONAYSIZ uygulanan kayıt sayısı (geri alma partileri ve ikinci onaydan geçen partiler hariç):
   * ikinci onay eşiğinin pencere toplamı. Bitmemiş partinin sayısı bitişte yazıldığından eşzamanlı istekler birbirini görmez;
   * saatlik parti sınırı bu boşluğu sınırlar (KV-37 §8).
   */
  unapprovedAppliedSince(actorId: string, since: Date): Promise<number>;
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

/**
 * Önceden tanımlı telafi çiftleri (yalnız bunlar geri alınır): kararın ÖNCEKİ durumuna tam dönüş sağlayanlar.
 * HIDE/REMOVE (önceki ACTIVE) → RESTORE; RESTORE (önceki HIDDEN) → HIDE; RESTORE (önceki REMOVED) → REMOVE.
 * Diğerleri (ör. REMOVE öncesi HIDDEN, RESTORE öncesi LOCKED) tek kararla aynı duruma döndürülemez: geri alınamaz.
 */
export function inverseOf(action: BulkAction, from: string | null): BulkAction | null {
  if ((action === "HIDE" || action === "REMOVE") && from === "ACTIVE") return "RESTORE";
  if (action === "RESTORE" && from === "HIDDEN") return "HIDE";
  if (action === "RESTORE" && from === "REMOVED") return "REMOVE";
  return null;
}

/** Geri alma özeti: parti ve her öğenin (hedef, şimdiki durum, topluluk, son karar, geri alındı mı) sıralı listesi. */
export function undoDigest(batchId: string, rows: Array<{ id: string; status: string | null; communityId: string | null; latestActionId: string | null; undone: boolean }>): string {
  const lines = [...rows].sort((a, b) => a.id.localeCompare(b.id)).map((r) => `${r.id}|${r.status ?? "-"}|${r.communityId ?? "-"}|${r.latestActionId ?? "-"}|${r.undone ? 1 : 0}`);
  return createHash("sha256").update(`undo\n${batchId}\n${lines.join("\n")}`).digest("hex");
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
          undoOfId: input.undoOfId ?? null,
        },
        select: { id: true },
      });
      return row.id;
    },

    async loadBatch(id) {
      const b = await prisma.moderationBatch.findUnique({
        where: { id },
        select: {
          id: true,
          actorId: true,
          kind: true,
          action: true,
          undoOfId: true,
          finishedAt: true,
          items: {
            where: { result: "APPLIED" },
            orderBy: { targetId: "asc" },
            select: { targetId: true, communityId: true, fromStatus: true, toStatus: true, moderationActionId: true, undoneByBatchId: true },
          },
        },
      });
      if (!b) return null;
      return {
        id: b.id,
        actorId: b.actorId,
        kind: b.kind === "POLLS" ? "polls" : "comments",
        action: b.action as BulkAction,
        undoOfId: b.undoOfId,
        finishedAt: b.finishedAt,
        items: b.items.map((i) => ({ ...i, moderationActionId: i.moderationActionId! })),
      };
    },

    async latestActions(kind, ids) {
      const out = new Map<string, string>();
      const rows = await prisma.moderationAction.findMany({
        where: kind === "polls" ? { pollId: { in: ids } } : { commentId: { in: ids } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, pollId: true, commentId: true },
      });
      for (const r of rows) {
        const target = (kind === "polls" ? r.pollId : r.commentId) as string;
        if (!out.has(target)) out.set(target, r.id);
      }
      return out;
    },

    async erasedAuthors(kind, ids) {
      const rows =
        kind === "polls"
          ? await prisma.poll.findMany({ where: { id: { in: ids }, author: { deletedAt: { not: null } } }, select: { id: true } })
          : await prisma.comment.findMany({ where: { id: { in: ids }, author: { deletedAt: { not: null } } }, select: { id: true } });
      return new Set(rows.map((r) => r.id));
    },

    async markUndone(batchId, targetId, undoBatchId) {
      const done = await prisma.moderationBatchItem.updateMany({ where: { batchId, targetId, undoneByBatchId: null, result: "APPLIED" }, data: { undoneByBatchId: undoBatchId } });
      return done.count === 1;
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

    async unapprovedAppliedSince(actorId, since) {
      const sum = await prisma.moderationBatch.aggregate({ _sum: { applied: true }, where: { actorId, undoOfId: null, approval: null, createdAt: { gt: since } } });
      return sum._sum.applied ?? 0;
    },

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
          undoOfId: true,
          _count: { select: { items: { where: { undoneByBatchId: { not: null } } } } },
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
        undoOfId: r.undoOfId,
        undone: r._count.items,
        undoable: r.undoOfId === null && r.finishedAt !== null && r.applied > r._count.items,
      }));
    },
  };
}

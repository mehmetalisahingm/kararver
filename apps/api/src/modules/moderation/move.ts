// Anketi başka kategoriye veya topluluğa taşıma (KV-37, #39): admin.moderation.polls.move.
// Soru metni ve seçenekler değişmediği için ilk geçerli oydan sonra da serbesttir (karar: #39). Oylar, yorumlar ve
// sonuçlar anketle birlikte kalır. Feed, arama, trend ve topluluk akışı anketi canlı okuduğundan ek yeniden hesaplama
// gerekmez. İz: moderation_actions (MOVE) + içerik sürümü (kim taşıdı) + audit; hepsi aynı transaction'da.
import type { PrismaClient } from "@kararver/db";
import { writeAudit } from "../audit/write.ts";
import { writeRevision } from "../revisions/write.ts";
import { loadPollRows } from "./content-list.ts";
import type { ContentStatus, MoveInput, MoveResult } from "./store.ts";

export function movePoll(prisma: PrismaClient, input: MoveInput): Promise<MoveResult> {
  return prisma.$transaction(async (tx): Promise<MoveResult> => {
    // Kilit: yetkilendirme sonrası eşzamanlı bir taşıma/işlem aynı satırı değiştiremez.
    const [row] = await tx.$queryRaw<{ status: ContentStatus; category_id: string; community_id: string | null }[]>`
      SELECT status::text AS status, category_id::text AS category_id, community_id::text AS community_id
        FROM polls WHERE id = ${input.id}::uuid FOR UPDATE`;
    if (!row) return { kind: "not_found" };
    if (row.community_id !== input.communityId) return { kind: "conflict", reason: "community_changed" };
    if (row.status === "REMOVED") return { kind: "conflict", reason: "removed" };

    const categoryId = input.categoryId ?? row.category_id;
    const communityId = input.toCommunityId === undefined ? row.community_id : input.toCommunityId;
    const categoryChanged = categoryId !== row.category_id;
    const communityChanged = communityId !== row.community_id;
    const current = async () => (await loadPollRows(tx, [input.id]))[0]!;
    if (!categoryChanged && !communityChanged) return { kind: "unchanged", item: await current() };

    if (categoryChanged && !(await tx.category.findFirst({ where: { id: categoryId, isActive: true }, select: { id: true } }))) {
      return { kind: "invalid", field: "categoryId", code: "unknown_category" };
    }
    if (communityChanged && communityId !== null && !(await tx.community.findFirst({ where: { id: communityId, status: "ACTIVE" }, select: { id: true } }))) {
      return { kind: "invalid", field: "communityId", code: "unknown_community" };
    }

    await tx.poll.update({ where: { id: input.id }, data: { categoryId, communityId } });
    await tx.moderationAction.create({
      data: { actorId: input.actorId, action: "MOVE", pollId: input.id, fromStatus: row.status, toStatus: row.status, reason: input.reason },
    });
    // İçerik sürümü: snapshot kategori ve topluluğu taşır; geçmişte kimin taşıdığı görünür (admin.revisions.polls).
    await writeRevision(tx, "poll", input.id, input.actorId, input.now);
    await writeAudit(tx, {
      source: "API",
      actorId: input.actorId,
      action: "moderation.poll.move",
      operation: "move",
      target: { type: "POLL", id: input.id },
      reason: input.reason,
      before: { categoryId: row.category_id, communityId: row.community_id },
      after: { categoryId, communityId },
      requestId: input.requestId,
      at: input.now,
    });
    return { kind: "moved", item: await current() };
  });
}

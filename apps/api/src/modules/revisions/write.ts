// İçerik sürüm geçmişi yazımı (#66). Anket ve yorum store'ları içeriği oluşturdukları/düzenledikleri transaction'da
// bunu çağırır: içeriğin o anki hali (DB fonksiyonu kv_poll_snapshot / kv_comment_snapshot) yeni sürüm olur.
// Sürüm numarası, çağıranın içerik satırını kilitlemiş olmasına dayanır (aynı içeriğe eşzamanlı iki yazma sıraya girer).
import type { Prisma } from "@kararver/db";

type Tx = Prisma.TransactionClient;

export type RevisionTarget = "poll" | "comment";

export async function writeRevision(tx: Tx, target: RevisionTarget, id: string, editorId: string, at: Date): Promise<void> {
  const [row] =
    target === "poll"
      ? await tx.$queryRaw<{ snapshot: Prisma.JsonValue; next: number }[]>`
          SELECT kv_poll_snapshot(${id}::uuid) AS snapshot,
            (coalesce((SELECT max(version) FROM poll_revisions WHERE poll_id = ${id}::uuid), 0) + 1)::int AS next`
      : await tx.$queryRaw<{ snapshot: Prisma.JsonValue; next: number }[]>`
          SELECT kv_comment_snapshot(${id}::uuid) AS snapshot,
            (coalesce((SELECT max(version) FROM comment_revisions WHERE comment_id = ${id}::uuid), 0) + 1)::int AS next`;
  if (!row || row.snapshot === null) throw new Error(`writeRevision: ${target} ${id} bulunamadı`);
  const snapshot = row.snapshot as Prisma.InputJsonValue;
  if (target === "poll") {
    await tx.pollRevision.create({ data: { pollId: id, version: row.next, editorId, editedAt: at, snapshot } });
  } else {
    await tx.commentRevision.create({ data: { commentId: id, version: row.next, editorId, editedAt: at, snapshot } });
  }
}

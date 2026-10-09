// İçeriğin rapor + moderasyon geçmişi (KV-37, #39): admin.moderation.history.polls / .comments.
// İki kaynak (reports, moderation_actions) tek zaman çizgisinde birleşir; keyset (at, id) azalan. Raporlayan kimliği
// seçilmez: moderatör sonuçlandıranı ve işlemi yapanı görür, şikayet edeni görmez.
import { Prisma, type PrismaClient } from "@kararver/db";
import { publicUserRef, userSelect } from "./content-list.ts";
import type { ContentKind, HistoryRow, ListAfter } from "./store.ts";

type Raw = {
  kind: "REPORT" | "ACTION";
  id: string;
  at: Date;
  reason: string;
  note: string | null;
  status: string | null;
  resolved_at: Date | null;
  resolved_by_id: string | null;
  actor_id: string | null;
  action: string | null;
  from_status: string | null;
  to_status: string | null;
  report_id: string | null;
  resolution_note: string | null;
};

export async function history(prisma: PrismaClient, kind: ContentKind, id: string, after: ListAfter, limit: number): Promise<HistoryRow[]> {
  const reportColumn = kind === "polls" ? Prisma.sql`r.poll_id` : Prisma.sql`r.comment_id`;
  const reportColumn2 = kind === "polls" ? Prisma.sql`r2.poll_id` : Prisma.sql`r2.comment_id`;
  const actionColumn = kind === "polls" ? Prisma.sql`m.poll_id` : Prisma.sql`m.comment_id`;
  const cursor = after ? Prisma.sql`WHERE (t.at, t.id) < (${after.at}::timestamptz, ${after.id}::text)` : Prisma.empty;

  const rows = await prisma.$queryRaw<Raw[]>(Prisma.sql`
    SELECT * FROM (
      SELECT 'REPORT' AS kind, r.id::text AS id, r.created_at AS at, r.reason::text AS reason, r.details AS note,
             r.status::text AS status, r.resolved_at, r.resolved_by_id::text AS resolved_by_id, NULL::text AS actor_id,
             NULL::text AS action, NULL::text AS from_status, NULL::text AS to_status, NULL::text AS report_id,
             r.resolution_note AS resolution_note
        FROM reports r WHERE ${reportColumn} = ${id}::uuid
      UNION ALL
      SELECT 'ACTION', m.id::text, m.created_at, m.reason, NULL, NULL, NULL, NULL, m.actor_id::text,
             m.action::text, m.from_status, m.to_status, m.report_id::text, NULL
        FROM moderation_actions m
       WHERE ${actionColumn} = ${id}::uuid
          -- Kullanıcıya yazılan uyarı/yaptırım (WARN_USER, SANCTION_USER) içeriğe değil kullanıcıya bağlıdır; rapor üzerinden içeriğe ulaşır.
          OR m.report_id IN (SELECT r2.id FROM reports r2 WHERE ${reportColumn2} = ${id}::uuid)
    ) t ${cursor}
    ORDER BY t.at DESC, t.id DESC LIMIT ${limit}`);

  const userIds = [...new Set(rows.flatMap((r) => [r.resolved_by_id, r.actor_id]).filter((x): x is string => x !== null))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: userSelect }) : [];
  const byId = new Map(users.map((u) => [u.id, publicUserRef(u)]));
  const person = (uid: string | null) => (uid ? (byId.get(uid) ?? null) : null);

  return rows.map((r): HistoryRow => {
    if (r.kind === "REPORT") {
      return {
        kind: "REPORT",
        id: r.id,
        at: r.at,
        reason: r.reason,
        note: r.note,
        status: r.status as "OPEN" | "ACTIONED" | "DISMISSED",
        resolvedAt: r.resolved_at,
        resolvedBy: person(r.resolved_by_id),
        resolutionNote: r.resolution_note,
      };
    }
    return {
      kind: "ACTION",
      id: r.id,
      at: r.at,
      action: r.action!,
      // actor_id NOT NULL FK: bulunamazsa veri bütünlüğü bozuktur.
      actor: person(r.actor_id)!,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      reason: r.reason,
      reportId: r.report_id,
    };
  });
}

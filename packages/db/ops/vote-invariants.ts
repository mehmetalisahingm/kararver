// KV-44 (#46) — anket bazlı oy tutarlılık kontrolü. Yalnız okur; tek SQL ifadesi = tek snapshot.
//
// Aynı fonksiyon iki yerde kullanılır:
// - apps/api/test/votes.test.ts: gerçek PostgreSQL'de eşzamanlı oy/değişim senaryosundan sonra.
// - staging R3: pnpm --filter @kararver/db db:verify-votes --poll <uuid> (ops/verify-votes.ts, READ ONLY transaction).
//   psql ile çalıştırmak için SQL'in kendisi: db:verify-votes --print-sql ($1 = uuid[]).
//
// ops/state.ts'teki global sayaç kontrolünden farkı: oy satırları, CAST/CHANGE/INVALIDATE/RESTORE olayları ve sayaçlar
// verilen anketler için birbiriyle eşlenir. Hesap silme (SA-181) sonrası anonim gruplar da sayılsın diye oy ve olay
// kaynakları statistical_votes / statistical_vote_events view'larıdır; change_count, tekil oy ve olay kimliği yalnız
// gerçek votes/vote_events satırlarında anlamlıdır.
//
// Olay sırası kullanılmaz: occurred_at transaction başlangıç saatidir (now()), anket kilidini bekleyen eski bir transaction
// sonradan commit edebilir. Bunun yerine sıradan bağımsız akış eşitliği kontrol edilir: her oy için
// (CAST.to + CHANGE.to) − CHANGE.from − mevcut seçenek = 0, seçenek başına.
import type { PrismaClient } from "../src/index.ts";
import type { Invariant } from "./state.ts";

type Sql = Pick<PrismaClient, "$queryRawUnsafe">;

/** Kolon adı → okunur kontrol adı. Sıra çıktı sırasıdır. */
export const VOTE_INVARIANT_NAMES = {
  missing_poll: "verilen anket id'si polls'ta var",
  poll_total: "polls.vote_count = anketin geçerli oy sayısı",
  option_counts: "poll_options.vote_count = seçeneğin geçerli oy sayısı",
  total_vs_options: "polls.vote_count = seçenek sayaçlarının toplamı",
  foreign_option: "oy, anketin kendi seçeneğinde",
  duplicate_vote: "hesap başına anket başına en fazla bir oy satırı",
  cast_per_vote: "her oyun tam bir CAST olayı var",
  orphan_event: "her olayın oyu var",
  change_count: "votes.change_count = CHANGE olayı sayısı",
  event_flow: "CAST/CHANGE akışı oyun mevcut seçeneğinde biter",
  event_shape: "CAST/CHANGE olaylarının from/to alanları geçerli",
  event_identity: "olayın anketi ve hesabı oyunkiyle aynı",
  validity_events: "INVALIDATE − RESTORE = oy geçersiz mi (1/0)",
} as const;

export type VoteSummary = { polls: number; votes: number; validVotes: number; castEvents: number; changeEvents: number };
export type VoteInvariantReport = { invariants: Invariant[]; summary: VoteSummary };

/** $1 = uuid[] (anket id'leri). Tek satır döner: her kontrol için ihlal sayısı + özet sayımlar. */
export const VOTE_INVARIANTS_SQL = `
WITH target AS (SELECT DISTINCT unnest($1::uuid[]) AS poll_id),
sv AS (
  SELECT v.id, v.poll_id, v.option_id, v.invalidated_at
    FROM statistical_votes v JOIN target t ON t.poll_id = v.poll_id
),
se AS (
  SELECT e.vote_id, e.poll_id, e.type, e.from_option_id, e.to_option_id
    FROM statistical_vote_events e JOIN target t ON t.poll_id = e.poll_id
),
ev AS (
  SELECT vote_id,
         count(*) FILTER (WHERE type = 'CAST') AS casts,
         count(*) FILTER (WHERE type = 'CHANGE') AS changes,
         count(*) FILTER (WHERE type = 'INVALIDATE') AS invalidates,
         count(*) FILTER (WHERE type = 'RESTORE') AS restores
    FROM se GROUP BY vote_id
),
opts AS (SELECT o.id, o.poll_id, o.vote_count FROM poll_options o JOIN target t ON t.poll_id = o.poll_id),
valid AS (SELECT option_id, count(*) AS n FROM sv WHERE invalidated_at IS NULL GROUP BY option_id),
flow AS (
  SELECT vote_id, to_option_id AS option_id, 1 AS d FROM se WHERE type IN ('CAST', 'CHANGE')
  UNION ALL SELECT vote_id, from_option_id, -1 FROM se WHERE type = 'CHANGE'
  UNION ALL SELECT id, option_id, -1 FROM sv
)
SELECT
  (SELECT count(*)::int FROM target t WHERE NOT EXISTS (SELECT 1 FROM polls p WHERE p.id = t.poll_id)) AS missing_poll,
  (SELECT count(*)::int FROM polls p JOIN target t ON t.poll_id = p.id
    WHERE p.vote_count <> (SELECT count(*) FROM sv WHERE sv.poll_id = p.id AND sv.invalidated_at IS NULL)) AS poll_total,
  (SELECT count(*)::int FROM opts o LEFT JOIN valid v ON v.option_id = o.id WHERE o.vote_count <> coalesce(v.n, 0)) AS option_counts,
  (SELECT count(*)::int FROM polls p JOIN target t ON t.poll_id = p.id
    WHERE p.vote_count <> (SELECT coalesce(sum(o.vote_count), 0) FROM opts o WHERE o.poll_id = p.id)) AS total_vs_options,
  (SELECT count(*)::int FROM sv LEFT JOIN opts o ON o.id = sv.option_id WHERE o.id IS NULL OR o.poll_id <> sv.poll_id) AS foreign_option,
  (SELECT count(*)::int FROM (SELECT 1 FROM votes v JOIN target t ON t.poll_id = v.poll_id
    GROUP BY v.poll_id, v.user_id HAVING count(*) > 1) d) AS duplicate_vote,
  (SELECT count(*)::int FROM sv LEFT JOIN ev ON ev.vote_id = sv.id WHERE coalesce(ev.casts, 0) <> 1) AS cast_per_vote,
  (SELECT count(*)::int FROM se WHERE NOT EXISTS (SELECT 1 FROM sv WHERE sv.id = se.vote_id)) AS orphan_event,
  (SELECT count(*)::int FROM votes v JOIN target t ON t.poll_id = v.poll_id LEFT JOIN ev ON ev.vote_id = v.id
    WHERE v.change_count <> coalesce(ev.changes, 0)) AS change_count,
  (SELECT count(*)::int FROM (SELECT 1 FROM flow GROUP BY vote_id, option_id HAVING sum(d) <> 0) f) AS event_flow,
  (SELECT count(*)::int FROM se
    WHERE (type = 'CAST' AND (from_option_id IS NOT NULL OR to_option_id IS NULL))
       OR (type = 'CHANGE' AND (from_option_id IS NULL OR to_option_id IS NULL OR from_option_id = to_option_id))) AS event_shape,
  (SELECT count(*)::int FROM vote_events e JOIN votes v ON v.id = e.vote_id
    WHERE (e.poll_id IN (SELECT poll_id FROM target) OR v.poll_id IN (SELECT poll_id FROM target))
      AND (e.poll_id <> v.poll_id OR e.user_id <> v.user_id)) AS event_identity,
  (SELECT count(*)::int FROM sv LEFT JOIN ev ON ev.vote_id = sv.id
    WHERE coalesce(ev.invalidates, 0) - coalesce(ev.restores, 0) <> CASE WHEN sv.invalidated_at IS NULL THEN 0 ELSE 1 END) AS validity_events,
  (SELECT count(*)::int FROM target) AS s_polls,
  (SELECT count(*)::int FROM sv) AS s_votes,
  (SELECT count(*)::int FROM sv WHERE invalidated_at IS NULL) AS s_valid_votes,
  (SELECT coalesce(sum(casts), 0)::int FROM ev) AS s_cast_events,
  (SELECT coalesce(sum(changes), 0)::int FROM ev) AS s_change_events
`;

export async function checkVoteInvariants(db: Sql, pollIds: string[]): Promise<VoteInvariantReport> {
  if (pollIds.length === 0) throw new Error("checkVoteInvariants: en az bir anket id'si gerekli");
  const [row] = await db.$queryRawUnsafe<Record<string, number>[]>(VOTE_INVARIANTS_SQL, pollIds);
  const invariants = (Object.keys(VOTE_INVARIANT_NAMES) as (keyof typeof VOTE_INVARIANT_NAMES)[]).map((k) => ({
    name: VOTE_INVARIANT_NAMES[k],
    violations: row![k]!,
  }));
  return {
    invariants,
    summary: {
      polls: row!.s_polls!,
      votes: row!.s_votes!,
      validVotes: row!.s_valid_votes!,
      castEvents: row!.s_cast_events!,
      changeEvents: row!.s_change_events!,
    },
  };
}

/** İhlal eden kontrollerin adları; boş dizi = tutarlı. */
export const violated = (report: VoteInvariantReport): string[] =>
  report.invariants.filter((i) => i.violations !== 0).map((i) => `${i.name}: ${i.violations}`);

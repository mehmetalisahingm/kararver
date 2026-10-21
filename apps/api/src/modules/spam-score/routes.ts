// Spam uyarı puanı, gölge mod (#183 / KV-37 S1): admin.spamScores.list. Sözleşme: contracts/domains/moderation.ts.
// Salt okuma. Puanı worker yazar (apps/worker/src/jobs/spam-score); bu uç nokta yalnız ADMIN+ içindir ve puan hiçbir kullanıcıya
// etki etmez. Ayar spam.shadowScoring.enabled kapalıyken (varsayılan) liste boştur. Karar listesi: docs/KV-37_SPAM_SCORE_DECISIONS.md.
import { SPAM_SCORE_RETENTION_DAYS, SpamSignals } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { decodeCursor, encodeCursor } from "../../http/cursor.ts";
import type { Route } from "../../http/route.ts";

export type SpamScoreRow = { userId: string; username: string; score: number; signals: SpamSignals; computedAt: Date };
export type SpamScoreStore = {
  list(input: { minScore: number; fresherThan: Date; after: { score: number; userId: string } | null }, limit: number): Promise<SpamScoreRow[]>;
};

export function createPrismaSpamScoreStore(prisma: PrismaClient): SpamScoreStore {
  return {
    async list(input, limit) {
      const rows = await prisma.spamAccountScore.findMany({
        where: {
          score: { gte: input.minScore },
          computedAt: { gte: input.fresherThan },
          user: { deletedAt: null },
          ...(input.after
            ? { OR: [{ score: { lt: input.after.score } }, { score: input.after.score, userId: { gt: input.after.userId } }] }
            : {}),
        },
        orderBy: [{ score: "desc" }, { userId: "asc" }],
        take: limit + 1,
        include: { user: { select: { username: true } } },
      });
      // Bozuk/eski şekilli sinyal satırı listeyi düşürmesin: şemayı geçmeyen satır atlanır (puan hiçbir şeyi etkilemez).
      return rows.flatMap((r) => {
        const signals = SpamSignals.safeParse(r.signals);
        return signals.success ? [{ userId: r.userId, username: r.user.username, score: r.score, signals: signals.data, computedAt: r.computedAt }] : [];
      });
    },
  };
}

export type SpamScoreDeps = { store: SpamScoreStore; isEnabled: () => Promise<boolean>; now: () => Date };

export function registerSpamScoreRoutes(route: Route, deps: SpamScoreDeps): void {
  route("admin.spamScores.list", async ({ query }) => {
    const empty = { status: 200 as const, body: { data: [], page: { nextCursor: null, hasMore: false } } };
    if (!(await deps.isEnabled())) return empty;
    const minScore = query.minScore ?? 0;
    const key = `admin.spamScores.list:${minScore}`;
    const cursor = decodeCursor(query.cursor, key);
    const fresherThan = new Date(deps.now().getTime() - SPAM_SCORE_RETENTION_DAYS * 24 * 60 * 60_000);
    const rows = await deps.store.list(
      { minScore, fresherThan, after: cursor ? { score: Number(cursor.keys[0]), userId: cursor.id } : null },
      query.limit,
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor = rows.length > query.limit && last ? encodeCursor(key, [last.score], last.userId) : null;
    return {
      status: 200,
      body: {
        data: page.map((r) => ({ userId: r.userId, username: r.username, score: r.score, signals: r.signals, computedAt: r.computedAt.toISOString() })),
        page: { nextCursor, hasMore: nextCursor !== null },
      },
    };
  });
}

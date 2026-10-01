// Worker'ın PostgreSQL testleri için düzenek: TEST_DATABASE_URL varsa migration'ları uygular ve client döner.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { createPrismaClient, type PrismaClient } from "@kararver/db";

export function testDatabaseUrl(): string | null {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return null;
  const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!dbName.endsWith("_test")) throw new Error(`Güvenlik: test veritabanının adı "_test" ile bitmeli (şu an: "${dbName}")`);
  return url;
}

export function migratedClient(url: string): PrismaClient {
  const dbDir = path.resolve(import.meta.dirname, "../../../../packages/db");
  const prismaCli = createRequire(path.join(dbDir, "package.json")).resolve("prisma/build/index.js");
  const migrate = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: dbDir, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
  if (migrate.status !== 0) throw new Error(`prisma migrate deploy başarısız:\n${migrate.stdout}\n${migrate.stderr}`);
  return createPrismaClient(url);
}

/** Test verisi: doğrudan DB'ye (API'siz). Zamanlar açıkça verilir. */
export function fixtures(db: PrismaClient) {
  const short = () => randomUUID().replaceAll("-", "").slice(0, 12);

  async function users(n: number): Promise<string[]> {
    const ids = Array.from({ length: n }, () => randomUUID());
    await db.user.createMany({
      data: ids.map((id) => {
        const s = short();
        return { id, email: `w_${s}@example.test`, emailNormalized: `w_${s}@example.test`, username: `w_${s}`, usernameNormalized: `w_${s}`, displayName: "Worker", passwordHash: "x" };
      }),
    });
    return ids;
  }

  async function category(): Promise<string> {
    return (await db.category.create({ data: { slug: `w-${short()}`, name: "Worker testi" }, select: { id: true } })).id;
  }

  async function poll(opts: {
    opensAt: Date;
    categoryId: string;
    authorId?: string;
    resultsVisibility?: "ALWAYS" | "AFTER_VOTE";
  }): Promise<{ id: string; optionId: string; optionIds: [string, string]; authorId: string }> {
    const authorId = opts.authorId ?? (await users(1))[0]!;
    const id = randomUUID();
    await db.poll.create({
      data: {
        id,
        publicId: short(),
        slug: `trend-${short()}`,
        authorId,
        categoryId: opts.categoryId,
        title: `Trend ${short()}`,
        opensAt: opts.opensAt,
        ...(opts.resultsVisibility ? { resultsVisibility: opts.resultsVisibility } : {}),
        closesAt: new Date(opts.opensAt.getTime() + 60 * 24 * 60 * 60 * 1000),
      },
    });
    const optionId = randomUUID();
    const second = randomUUID();
    await db.pollOption.createMany({ data: [{ id: optionId, pollId: id, position: 0, label: "A" }, { id: second, pollId: id, position: 1, label: "B" }] });
    return { id, optionId, optionIds: [optionId, second], authorId };
  }

  /** n farklı hesaptan oy; i. oyun zamanı at(i). */
  async function votes(p: { id: string; optionId: string }, n: number, at: (i: number) => Date): Promise<string[]> {
    const voters = await users(n);
    await db.vote.createMany({ data: voters.map((userId, i) => ({ pollId: p.id, optionId: p.optionId, userId, createdAt: at(i) })) });
    return voters;
  }

  async function comments(pollId: string, authorId: string, n: number, at: (i: number) => Date): Promise<void> {
    await db.comment.createMany({ data: Array.from({ length: n }, (_, i) => ({ pollId, authorId, body: `yorum ${i}`, createdAt: at(i) })) });
  }

  type Step = [at: Date, type: "CAST" | "CHANGE" | "INVALIDATE" | "RESTORE", optionId: string | null];

  /**
   * Bir hesabın oy geçmişi: votes satırı son duruma göre, vote_events her adım için (şekil kurallarına uygun).
   * CAST/RESTORE/CHANGE için optionId hedef seçenek; INVALIDATE için null.
   */
  async function voter(pollId: string, steps: Step[]): Promise<string> {
    const [userId] = await users(1);
    let current: string | null = null;
    let valid = true;
    let invalidatedAt: Date | null = null;
    const events: { type: Step[1]; from: string | null; to: string | null; at: Date }[] = [];
    for (const [at, type, optionId] of steps) {
      if (type === "INVALIDATE") {
        events.push({ type, from: current, to: null, at });
        valid = false;
        invalidatedAt = at;
      } else if (type === "CHANGE") {
        events.push({ type, from: current, to: optionId, at });
        current = optionId;
      } else {
        events.push({ type, from: null, to: optionId, at });
        current = optionId;
        valid = true;
        invalidatedAt = null;
      }
    }
    const vote = await db.vote.create({
      data: {
        pollId,
        userId: userId!,
        optionId: current!,
        createdAt: steps[0]![0],
        invalidatedAt: valid ? null : invalidatedAt,
        invalidationReason: valid ? null : "test: geçersiz",
      },
      select: { id: true },
    });
    await db.voteEvent.createMany({
      data: events.map((e) => ({ voteId: vote.id, pollId, userId: userId!, type: e.type, fromOptionId: e.from, toOptionId: e.to, occurredAt: e.at, reason: e.type === "INVALIDATE" || e.type === "RESTORE" ? "test" : null, actorId: e.type === "INVALIDATE" || e.type === "RESTORE" ? userId! : null })),
    });
    return userId!;
  }

  return { users, category, poll, votes, comments, voter };
}

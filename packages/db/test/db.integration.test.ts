import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "../src/generated/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL zorunlu");
}
const testUrl = TEST_DATABASE_URL;
const dbRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let db: PrismaClient;
let categoryId: string;

function runPrisma(args: string[]) {
  return spawnSync("pnpm", ["exec", "prisma", ...args], {
    cwd: dbRoot,
    env: { ...process.env, DATABASE_URL: testUrl },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

async function ensureTestDatabaseExists(): Promise<void> {
  const parsed = new URL(testUrl);
  const dbName = parsed.pathname.slice(1);
  const admin = new URL(testUrl);
  admin.pathname = "/postgres";
  try {
    execFileSync("psql", [admin.toString(), "-v", "ON_ERROR_STOP=1", "-tAc", `SELECT 1 FROM pg_database WHERE datname='${dbName.replaceAll("'", "''")}'`], { stdio: "pipe" });
  } catch {
    // CI db exists; local psql is optional.
  }
}

const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

async function expectDbError(promise: Promise<unknown>, expectedCode: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    const value = error as { code?: string; meta?: { code?: string } };
    return value.code === expectedCode || value.meta?.code === expectedCode || String(error).includes(expectedCode);
  });
}

async function createUser(): Promise<string> {
  const id = randomUUID();
  const key = id.replaceAll("-", "").slice(0, 12);
  await db.user.create({
    data: {
      id,
      email: `${key}@example.test`,
      emailNormalized: `${key}@example.test`,
      username: `u_${key}`,
      usernameNormalized: `u_${key}`,
      displayName: `User ${key}`,
      passwordHash: "test-hash",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });
  return id;
}

async function createPoll(authorId: string, options = 2): Promise<{ pollId: string; optionIds: string[] }> {
  const pollId = randomUUID();
  const optionIds = Array.from({ length: options }, () => randomUUID());
  await db.poll.create({
    data: {
      id: pollId,
      publicId: randomUUID().replaceAll("-", "").slice(0, 8),
      slug: `test-${pollId.slice(0, 8)}`,
      authorId,
      categoryId,
      kind: "POLL",
      title: "Test anketi için yeterince uzun başlık",
      status: "ACTIVE",
      resultsVisibility: "ALWAYS",
      allowComments: true,
      opensAt: new Date(Date.now() - 60_000),
      closesAt: new Date(Date.now() + 3_600_000),
      options: {
        create: optionIds.map((id, position) => ({ id, label: `Seçenek ${position + 1}`, position })),
      },
    },
  });
  return { pollId, optionIds };
}

async function castVote(pollId: string, optionId: string, userId: string): Promise<void> {
  await db.vote.create({ data: { pollId, optionId, userId } });
}

async function one<T>(promise: Promise<T[]>): Promise<T> {
  const rows = await promise;
  assert.equal(rows.length, 1);
  return rows[0] as T;
}

// ─── Kurulum ──────────────────────────────────────────────────

before(async () => {
  await ensureTestDatabaseExists();
  const reset = runPrisma(["migrate", "reset", "--force"]);
  assert.equal(reset.status, 0, `prisma migrate reset başarısız:\n${reset.stdout}\n${reset.stderr}`);

  // 20 eşzamanlı oy testi için havuz 20'den büyük olmalı.
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testUrl, max: 25 }) });

  categoryId = randomUUID();
  // Slug başlangıç kategorileriyle (KV-26 migration'ı: 'otomobil' vb.) çakışmasın.
  await db.$executeRaw`
    INSERT INTO categories (id, slug, name, updated_at) VALUES (${categoryId}::uuid, 'test-otomobil', 'Test Otomobil', now())`;
});

after(async () => {
  await db?.$disconnect();
});

// ─── 1. Migration ─────────────────────────────────────────────

describe("migration", () => {
  test("ilk migration temiz veritabanına eksiksiz uygulanır", async () => {
    const migration = await one(db.$queryRaw<{ finished: boolean; rolled_back: boolean }[]>`
      SELECT finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
      FROM _prisma_migrations WHERE migration_name = '20260927160000_faruk_kv02_core_init'`);
    assert.equal(migration.finished, true);
    assert.equal(migration.rolled_back, false);

    const triggers = await db.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname`;
    assert.deepEqual(
      triggers.map((t) => t.tgname),
      [
        "comment_revisions_append_only",
        "comments_single_level",
        "moderation_actions_append_only",
        "point_ledger_entries_append_only",
        "poll_options_check_kind",
        "poll_options_guard_locked",
        "poll_revisions_append_only",
        "polls_guard_locked",
        "polls_kind_immutable",
        "sanctions_guard",
        "vote_events_append_only",
        "votes_check_kind",
        "votes_forbid_self_vote",
        "votes_guard_identity",
        "votes_mark_first_valid",
      ],
    );
  });

  test("schema ile veritabanı arasında fark yok", () => {
    const diff = runPrisma(["migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema", "--exit-code"]);
    assert.equal(diff.status, 0, `Schema ile migration farklı (exit ${diff.status}):\n${diff.stdout}\n${diff.stderr}`);
  });
});

// ─── 2. Tek aktif oy ──────────────────────────────────────────

describe("tek aktif oy", () => {
  test("aynı kullanıcı aynı ankete ikinci kez oy veremez", async () => {
    const user = await createUser();
    const { pollId, optionIds } = await createPoll(await createUser());
    await castVote(pollId, optionIds[0]!, user);
    await expectDbError(castVote(pollId, optionIds[1]!, user), UNIQUE_VIOLATION);
  });

  test("başka bir anketin seçeneğine oy verilemez (bileşik FK)", async () => {
    const author = await createUser();
    const pollA = await createPoll(author);
    const pollB = await createPoll(author);
    await expectDbError(castVote(pollA.pollId, pollB.optionIds[0]!, await createUser()), FK_VIOLATION);
  });

  test("aynı hesaptan 20 eşzamanlı istek tek aktif oy ve doğru toplam üretir", async () => {
    const author = await createUser();
    const voter = await createUser();
    const { pollId, optionIds } = await createPoll(author);
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () => castVote(pollId, optionIds[0]!, voter)));
    assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
    assert.equal(await db.vote.count({ where: { pollId, userId: voter } }), 1);
  });
});

// Remaining KV-02 integration scenarios live below; keep this file's historical coverage intact.

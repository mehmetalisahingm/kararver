/**
 * KV-02 veritabanı testleri — gerçek PostgreSQL gerektirir.
 *
 * Çalıştırma (repo kökünden):  pnpm db:test
 * Bağlantı: TEST_DATABASE_URL, yoksa DATABASE_URL'deki sunucuda "<db>_test" veritabanı.
 * Test veritabanı her çalıştırmada `prisma migrate reset --force` ile SIFIRLANIR;
 * güvenlik için adı "_test" ile bitmeyen bir veritabanında çalışmayı reddeder.
 * Ayrıntı: docs/DATA_MODEL.md §11
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

const packageDir = path.resolve(import.meta.dirname, "..");
const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");

// ─── Test veritabanı seçimi ───────────────────────────────────

function resolveTestDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(path.resolve(packageDir, "../../.env"));
    } catch {
      // .env yok
    }
  }
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error("TEST_DATABASE_URL veya DATABASE_URL tanımlı olmalı (bkz. .env.example)");
  }
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/^\//, "")}_test`;
  return url.toString();
}

const testUrl = resolveTestDatabaseUrl();
const testDbName = decodeURIComponent(new URL(testUrl).pathname.replace(/^\//, ""));
if (!testDbName.endsWith("_test")) {
  throw new Error(`Güvenlik: test veritabanının adı "_test" ile bitmeli (şu an: "${testDbName}")`);
}

async function ensureTestDatabaseExists(): Promise<void> {
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl.toString() }) });
  try {
    const rows = await admin
      .$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_database WHERE datname = ${testDbName}`
      .catch((err: unknown) => {
        const e = err as { message?: string; code?: string; meta?: unknown; cause?: unknown };
        const safeUrl = new URL(adminUrl);
        safeUrl.password = "***";
        throw new Error(
          `PostgreSQL'e bağlanılamadı (${safeUrl}). Sunucu çalışıyor mu? (docker compose up -d)\n` +
            `Ayrıntı: ${e.code ?? ""} ${e.message?.trim() ?? ""} ${JSON.stringify(e.meta ?? {})} ${String(e.cause ?? "")}`,
        );
      });
    if (rows[0]?.n === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${testDbName.replaceAll('"', '""')}"`);
    }
  } finally {
    await admin.$disconnect();
  }
}

function runPrisma(args: string[]) {
  return spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: packageDir,
    env: { ...process.env, DATABASE_URL: testUrl },
    encoding: "utf8",
  });
}

// ─── Yardımcılar ──────────────────────────────────────────────

let db: PrismaClient;

/** Hata metninde (mesaj + meta) beklenen kalıp geçmeli. */
async function expectDbError(action: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(action, (err: unknown) => {
    const e = err as { message?: string; meta?: unknown; cause?: unknown };
    const text = `${e?.message ?? ""} ${JSON.stringify(e?.meta ?? {})} ${String(e?.cause ?? "")}`;
    assert.match(text, pattern);
    return true;
  });
}

const UNIQUE_VIOLATION = /23505|unique/i;
const FK_VIOLATION = /23503|foreign key/i;
const CHECK_VIOLATION = /23514|check constraint/i;
const LOCKED = /KV_POLL_CONTENT_LOCKED/;

function shortId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 8);
}

async function createUser(): Promise<string> {
  const id = randomUUID();
  const handle = `u_${shortId()}`;
  await db.$executeRaw`
    INSERT INTO users (id, email, email_normalized, username, username_normalized, display_name, password_hash, updated_at)
    VALUES (${id}::uuid, ${handle + "@test.local"}, ${handle + "@test.local"}, ${handle}, ${handle}, ${handle}, 'x', now())`;
  return id;
}

let categoryId: string;

async function createPoll(authorId: string, optionCount = 3): Promise<{ pollId: string; optionIds: string[] }> {
  const pollId = randomUUID();
  await db.$executeRaw`
    INSERT INTO polls (id, public_id, slug, author_id, category_id, title, description, opens_at, closes_at, updated_at)
    VALUES (${pollId}::uuid, ${shortId()}, 'test-anket', ${authorId}::uuid, ${categoryId}::uuid,
            'Bu araba bu fiyata alınır mı?', 'İlk açıklama', now() - interval '1 hour', now() + interval '1 day', now())`;
  const optionIds: string[] = [];
  for (let position = 0; position < optionCount; position++) {
    const optionId = randomUUID();
    await db.$executeRaw`
      INSERT INTO poll_options (id, poll_id, position, label)
      VALUES (${optionId}::uuid, ${pollId}::uuid, ${position}, ${"Seçenek " + (position + 1)})`;
    optionIds.push(optionId);
  }
  return { pollId, optionIds };
}

/** KV-11'in uygulayacağı akışın DB tarafı: oy + geçmiş + sayaçlar tek transaction'da. */
async function castVote(pollId: string, optionId: string, userId: string): Promise<string> {
  const voteId = randomUUID();
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        INSERT INTO votes (id, poll_id, option_id, user_id, updated_at)
        VALUES (${voteId}::uuid, ${pollId}::uuid, ${optionId}::uuid, ${userId}::uuid, now())`;
      await tx.$executeRaw`
        INSERT INTO vote_events (id, vote_id, poll_id, user_id, type, to_option_id)
        VALUES (${randomUUID()}::uuid, ${voteId}::uuid, ${pollId}::uuid, ${userId}::uuid, 'CAST', ${optionId}::uuid)`;
      await tx.$executeRaw`UPDATE poll_options SET vote_count = vote_count + 1 WHERE id = ${optionId}::uuid`;
      await tx.$executeRaw`UPDATE polls SET vote_count = vote_count + 1 WHERE id = ${pollId}::uuid`;
    },
    { maxWait: 15_000, timeout: 15_000 },
  );
  return voteId;
}

async function one<T>(query: Promise<T[]>): Promise<T> {
  const rows = await query;
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
  await db.$executeRaw`
    INSERT INTO categories (id, slug, name, updated_at) VALUES (${categoryId}::uuid, 'otomobil', 'Otomobil', now())`;
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
        "comments_single_level",
        "poll_options_guard_locked",
        "polls_guard_locked",
        "vote_events_append_only",
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
    const user = await createUser();
    const { pollId, optionIds } = await createPoll(await createUser());

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => castVote(pollId, optionIds[i % optionIds.length]!, user)),
    );
    const succeeded = results.filter((r) => r.status === "fulfilled");
    assert.equal(succeeded.length, 1, "tam olarak bir istek başarılı olmalı");
    for (const r of results) {
      if (r.status === "rejected") {
        const e = r.reason as { message?: string; meta?: unknown };
        assert.match(`${e?.message} ${JSON.stringify(e?.meta ?? {})}`, UNIQUE_VIOLATION);
      }
    }

    const counts = await one(db.$queryRaw<{ votes: number; events: number; poll_total: number; option_total: number }[]>`
      SELECT (SELECT count(*)::int FROM votes WHERE poll_id = ${pollId}::uuid) AS votes,
             (SELECT count(*)::int FROM vote_events WHERE poll_id = ${pollId}::uuid) AS events,
             (SELECT vote_count FROM polls WHERE id = ${pollId}::uuid) AS poll_total,
             (SELECT sum(vote_count)::int FROM poll_options WHERE poll_id = ${pollId}::uuid) AS option_total`);
    assert.deepEqual(counts, { votes: 1, events: 1, poll_total: 1, option_total: 1 });
  });

  test("oy geçersiz sayılınca gerekçe zorunlu ve ikinci kez düşüm yapılmaz", async () => {
    const user = await createUser();
    const { pollId, optionIds } = await createPoll(await createUser());
    const voteId = await castVote(pollId, optionIds[0]!, user);

    await expectDbError(
      db.$executeRaw`UPDATE votes SET invalidated_at = now() WHERE id = ${voteId}::uuid`,
      CHECK_VIOLATION,
    );

    const invalidate = () =>
      db.$transaction(async (tx) => {
        const changed = await tx.$executeRaw`
          UPDATE votes SET invalidated_at = now(), invalidation_reason = 'test: manipülasyon', updated_at = now()
          WHERE id = ${voteId}::uuid AND invalidated_at IS NULL`;
        if (changed === 1) {
          await tx.$executeRaw`UPDATE poll_options SET vote_count = vote_count - 1 WHERE id = ${optionIds[0]!}::uuid`;
          await tx.$executeRaw`UPDATE polls SET vote_count = vote_count - 1 WHERE id = ${pollId}::uuid`;
        }
        return changed;
      });
    assert.equal(await invalidate(), 1);
    assert.equal(await invalidate(), 0, "ikinci geçersiz sayma hiçbir satırı değiştirmemeli");

    const poll = await one(db.$queryRaw<{ vote_count: number }[]>`SELECT vote_count FROM polls WHERE id = ${pollId}::uuid`);
    assert.equal(poll.vote_count, 0);

    // Unique kısıt geçersiz oyda da sürer: aynı kullanıcı yeniden oy veremez.
    await expectDbError(castVote(pollId, optionIds[1]!, user), UNIQUE_VIOLATION);
  });

  test("oyun anketi ve kullanıcısı sonradan değiştirilemez", async () => {
    const author = await createUser();
    const { pollId, optionIds } = await createPoll(author);
    const voteId = await castVote(pollId, optionIds[0]!, await createUser());
    await expectDbError(
      db.$executeRaw`UPDATE votes SET user_id = ${author}::uuid WHERE id = ${voteId}::uuid`,
      /KV_VOTE_IDENTITY_IMMUTABLE/,
    );
  });
});

// ─── 3. İlk geçerli oydan sonra kilit ─────────────────────────

describe("ilk geçerli oydan sonra anket kilidi", () => {
  test("oy yokken başlık, açıklama ve seçenekler düzenlenebilir", async () => {
    const { pollId, optionIds } = await createPoll(await createUser());
    await db.$executeRaw`UPDATE polls SET title = 'Yeni başlık', description = 'Yeni açıklama', results_visibility = 'AFTER_VOTE' WHERE id = ${pollId}::uuid`;
    await db.$executeRaw`UPDATE poll_options SET label = 'Yeni seçenek' WHERE id = ${optionIds[0]!}::uuid`;
    await db.$executeRaw`DELETE FROM poll_options WHERE id = ${optionIds[2]!}::uuid`;
  });

  test("ilk geçerli oydan sonra soru, açıklama, sonuç görünürlüğü ve seçenekler kilitlenir", async () => {
    const { pollId, optionIds } = await createPoll(await createUser());
    await castVote(pollId, optionIds[0]!, await createUser());

    const poll = await one(db.$queryRaw<{ locked: boolean }[]>`
      SELECT first_valid_vote_at IS NOT NULL AS locked FROM polls WHERE id = ${pollId}::uuid`);
    assert.equal(poll.locked, true);

    await expectDbError(db.$executeRaw`UPDATE polls SET title = 'Değişti' WHERE id = ${pollId}::uuid`, LOCKED);
    await expectDbError(db.$executeRaw`UPDATE polls SET description = 'Değişti' WHERE id = ${pollId}::uuid`, LOCKED);
    await expectDbError(db.$executeRaw`UPDATE polls SET description = NULL WHERE id = ${pollId}::uuid`, LOCKED);
    await expectDbError(db.$executeRaw`UPDATE polls SET results_visibility = 'AFTER_VOTE' WHERE id = ${pollId}::uuid`, LOCKED);
    await expectDbError(db.$executeRaw`UPDATE polls SET first_valid_vote_at = NULL WHERE id = ${pollId}::uuid`, LOCKED);
    await expectDbError(db.$executeRaw`UPDATE poll_options SET label = 'Değişti' WHERE id = ${optionIds[0]!}::uuid`, LOCKED);
    await expectDbError(db.$executeRaw`UPDATE poll_options SET position = 5 WHERE id = ${optionIds[2]!}::uuid`, LOCKED);
    await expectDbError(db.$executeRaw`DELETE FROM poll_options WHERE id = ${optionIds[2]!}::uuid`, LOCKED);
    await expectDbError(
      db.$executeRaw`INSERT INTO poll_options (id, poll_id, position, label) VALUES (${randomUUID()}::uuid, ${pollId}::uuid, 4, 'Ek seçenek')`,
      LOCKED,
    );
  });

  test("kilitli ankette sayaçlar, kapanış ve tarihli ek açıklama serbesttir", async () => {
    const { pollId, optionIds } = await createPoll(await createUser());
    await castVote(pollId, optionIds[0]!, await createUser());

    await db.$executeRaw`UPDATE poll_options SET vote_count = vote_count + 0 WHERE id = ${optionIds[0]!}::uuid`;
    await db.$executeRaw`UPDATE polls SET closed_at = now(), allow_comments = false WHERE id = ${pollId}::uuid`;
    await db.$executeRaw`
      INSERT INTO poll_addenda (id, poll_id, body) VALUES (${randomUUID()}::uuid, ${pollId}::uuid, 'Ek bilgi: araç 2019 model')`;
  });

  test("sadece geçersiz sayılmış bir oy anketi kilitlemez", async () => {
    const { pollId, optionIds } = await createPoll(await createUser());
    await db.$executeRaw`
      INSERT INTO votes (id, poll_id, option_id, user_id, invalidated_at, invalidation_reason, updated_at)
      VALUES (${randomUUID()}::uuid, ${pollId}::uuid, ${optionIds[0]!}::uuid, ${await createUser()}::uuid, now(), 'test', now())`;
    await db.$executeRaw`UPDATE polls SET title = 'Hâlâ düzenlenebilir' WHERE id = ${pollId}::uuid`;
  });
});

// ─── 4. Oy geçmişi append-only ────────────────────────────────

describe("vote_events append-only", () => {
  test("oy geçmişi güncellenemez ve silinemez", async () => {
    const { pollId, optionIds } = await createPoll(await createUser());
    await castVote(pollId, optionIds[0]!, await createUser());
    const event = await one(db.$queryRaw<{ id: string }[]>`SELECT id::text FROM vote_events WHERE poll_id = ${pollId}::uuid`);

    await expectDbError(
      db.$executeRaw`UPDATE vote_events SET reason = 'değişti' WHERE id = ${event.id}::uuid`,
      /KV_VOTE_EVENTS_APPEND_ONLY/,
    );
    await expectDbError(db.$executeRaw`DELETE FROM vote_events WHERE id = ${event.id}::uuid`, /KV_VOTE_EVENTS_APPEND_ONLY/);
  });

  test("olay biçimi türüne uymalı (CHANGE aynı seçeneğe olamaz)", async () => {
    const user = await createUser();
    const { pollId, optionIds } = await createPoll(await createUser());
    const voteId = await castVote(pollId, optionIds[0]!, user);
    await expectDbError(
      db.$executeRaw`
        INSERT INTO vote_events (id, vote_id, poll_id, user_id, type, from_option_id, to_option_id)
        VALUES (${randomUUID()}::uuid, ${voteId}::uuid, ${pollId}::uuid, ${user}::uuid, 'CHANGE', ${optionIds[0]!}::uuid, ${optionIds[0]!}::uuid)`,
      CHECK_VIOLATION,
    );
  });
});

// ─── 5. Yorum derinliği ───────────────────────────────────────

describe("yorumlar tek seviye", () => {
  async function addComment(pollId: string, authorId: string, parentId: string | null, kind = "COMMENT"): Promise<string> {
    const id = randomUUID();
    await db.$executeRaw`
      INSERT INTO comments (id, poll_id, author_id, parent_id, kind, body, updated_at)
      VALUES (${id}::uuid, ${pollId}::uuid, ${authorId}::uuid, ${parentId}::uuid, ${kind}::comment_kind, 'yorum', now())`;
    return id;
  }

  test("yoruma cevap verilir, cevaba cevap verilemez", async () => {
    const author = await createUser();
    const { pollId } = await createPoll(author);
    const top = await addComment(pollId, author, null);
    const reply = await addComment(pollId, author, top);
    await expectDbError(addComment(pollId, author, reply), /KV_COMMENT_DEPTH/);
  });

  test("cevabı olan yorum başka bir yorumun cevabına dönüştürülemez", async () => {
    const author = await createUser();
    const { pollId } = await createPoll(author);
    const first = await addComment(pollId, author, null);
    const second = await addComment(pollId, author, null);
    await addComment(pollId, author, second);
    await expectDbError(
      db.$executeRaw`UPDATE comments SET parent_id = ${first}::uuid WHERE id = ${second}::uuid`,
      /KV_COMMENT_DEPTH/,
    );
  });

  test("alternatif öneri sadece üst seviyede olabilir", async () => {
    const author = await createUser();
    const { pollId } = await createPoll(author);
    const top = await addComment(pollId, author, null, "ALTERNATIVE");
    await expectDbError(addComment(pollId, author, top, "ALTERNATIVE"), CHECK_VIOLATION);
  });

  test("cevap başka bir anketteki yoruma bağlanamaz (bileşik FK)", async () => {
    const author = await createUser();
    const pollA = await createPoll(author);
    const pollB = await createPoll(author);
    const top = await addComment(pollA.pollId, author, null);
    await expectDbError(addComment(pollB.pollId, author, top), FK_VIOLATION);
  });
});

// ─── 6. Medya (KV-16) ─────────────────────────────────────────

describe("media_assets (KV-16)", () => {
  async function createMedia(
    uploaderId: string,
    fields: { status?: string; processed?: boolean; public?: boolean } = {},
  ): Promise<string> {
    const id = randomUUID();
    const key = `test/${id}`;
    await db.$executeRaw`
      INSERT INTO media_assets (id, uploader_id, purpose, status, original_object_key, processed_object_key, public_object_key, updated_at)
      VALUES (${id}::uuid, ${uploaderId}::uuid, 'POLL_IMAGE', ${fields.status ?? "PENDING"}::media_status,
              ${key + "/original"}, ${fields.processed ? key + "/processed.webp" : null},
              ${fields.public ? key + ".webp" : null}, now())`;
    return id;
  }

  test("migration uygulanmış ve yeni görsel PENDING başlar", async () => {
    const migration = await one(db.$queryRaw<{ finished: boolean }[]>`
      SELECT finished_at IS NOT NULL AS finished
      FROM _prisma_migrations WHERE migration_name = '20260927201000_mert_kv16_media_assets'`);
    assert.equal(migration.finished, true);

    const id = await createMedia(await createUser());
    const row = await one(db.$queryRaw<{ status: string; processing_attempts: number }[]>`
      SELECT status::text, processing_attempts FROM media_assets WHERE id = ${id}::uuid`);
    assert.deepEqual(row, { status: "PENDING", processing_attempts: 0 });
  });

  test("onaylanmamış görsel public anahtar alamaz", async () => {
    const uploader = await createUser();
    for (const status of ["PENDING", "QUARANTINED", "REJECTED"]) {
      await expectDbError(createMedia(uploader, { status, processed: true, public: true }), CHECK_VIOLATION);
    }
  });

  test("onaylı görsel public ve işlenmiş kopya olmadan var olamaz", async () => {
    const uploader = await createUser();
    await expectDbError(createMedia(uploader, { status: "APPROVED", processed: true }), CHECK_VIOLATION);
    await expectDbError(createMedia(uploader, { status: "APPROVED", public: true }), CHECK_VIOLATION);
    await createMedia(uploader, { status: "APPROVED", processed: true, public: true });
  });

  test("onaydan sonra kaldırmada public anahtar aynı işlemde boşaltılmalı", async () => {
    const uploader = await createUser();
    const reviewer = await createUser();
    const id = await createMedia(uploader, { status: "APPROVED", processed: true, public: true });

    await expectDbError(
      db.$executeRaw`UPDATE media_assets SET status = 'REJECTED' WHERE id = ${id}::uuid`,
      CHECK_VIOLATION,
    );
    await db.$executeRaw`
      UPDATE media_assets
      SET status = 'REJECTED', public_object_key = NULL, reviewed_by_id = ${reviewer}::uuid, reviewed_at = now(),
          review_note = 'test: kaldırıldı', updated_at = now()
      WHERE id = ${id}::uuid`;
  });

  test("risk skoru 0-1 aralığında, inceleme alanları birlikte dolar", async () => {
    const uploader = await createUser();
    const id = await createMedia(uploader);
    await expectDbError(db.$executeRaw`UPDATE media_assets SET risk_score = 1.5 WHERE id = ${id}::uuid`, CHECK_VIOLATION);
    await expectDbError(db.$executeRaw`UPDATE media_assets SET reviewed_at = now() WHERE id = ${id}::uuid`, CHECK_VIOLATION);
    await expectDbError(
      db.$executeRaw`UPDATE media_assets SET content_sha256 = 'not-a-hash' WHERE id = ${id}::uuid`,
      CHECK_VIOLATION,
    );
    await db.$executeRaw`
      UPDATE media_assets SET status = 'QUARANTINED', risk_level = 'HIGH', risk_score = 0.91,
        moderation_labels = '[{"class":"FEMALE_BREAST_EXPOSED","score":0.91}]'::jsonb, moderated_at = now()
      WHERE id = ${id}::uuid`;
  });

  test("var olmayan kullanıcı adına görsel kaydedilemez ve galerideki görsel silinemez", async () => {
    await expectDbError(createMedia(randomUUID()), FK_VIOLATION);

    const author = await createUser();
    const { pollId } = await createPoll(author);
    const id = await createMedia(author, { status: "APPROVED", processed: true, public: true });
    await db.$executeRaw`INSERT INTO poll_media (poll_id, media_id, position) VALUES (${pollId}::uuid, ${id}::uuid, 0)`;
    await expectDbError(db.$executeRaw`DELETE FROM media_assets WHERE id = ${id}::uuid`, FK_VIOLATION);
  });
});

// ─── 7. Türkçe normalizasyon ──────────────────────────────────

describe("kv_normalize", () => {
  const cases: [string, string][] = [
    ["Şişe", "sise"],
    ["IŞIK", "isik"],
    ["ışık", "isik"],
    ["İstanbul", "istanbul"],
    ["ağaç", "agac"],
    ["Göz", "goz"],
    ["Üzüm", "uzum"],
    ["ÇİÇEK", "cicek"],
    ["Iğdır", "igdir"],
    ["TESLA Model 3 alınır mı?", "tesla model 3 alinir mi?"],
  ];

  for (const [input, expected] of cases) {
    test(`${input} → ${expected}`, async () => {
      const row = await one(db.$queryRaw<{ value: string }[]>`SELECT kv_normalize(${input}) AS value`);
      assert.equal(row.value, expected);
    });
  }
});

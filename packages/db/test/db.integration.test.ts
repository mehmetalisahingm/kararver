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
// Enum hizalaması sözleşmenin kendisiyle karşılaştırılır (workspace bağımlılığı eklemeden, kaynaktan).
import { AuditSource, SanctionType } from "../../contracts/src/domains/admin.ts";
import { roles } from "../../contracts/src/helpers.ts";

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
        "audit_logs_append_only",
        "audit_logs_no_truncate",
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
      VALUES (${id}::uuid, ${uploaderId}::uuid, 'POLL', ${fields.status ?? "PENDING"}::media_status,
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

// ─── 6b. Yasaklı görsel parmak izleri (KV-38) ─────────────────

describe("banned_media_hashes (KV-38)", () => {
  const sha = () => randomUUID().replaceAll("-", "").repeat(2);
  const dhash = () => randomUUID().replaceAll("-", "").slice(0, 16);

  async function rejectedMedia(uploaderId: string): Promise<string> {
    const id = randomUUID();
    await db.$executeRaw`
      INSERT INTO media_assets (id, uploader_id, purpose, status, original_object_key, updated_at)
      VALUES (${id}::uuid, ${uploaderId}::uuid, 'POLL', 'REJECTED', ${"test/" + id + "/original"}, now())`;
    return id;
  }

  const ban = (mediaId: string, adminId: string, fields: { sha?: string | null; phash?: string | null; reason?: string } = {}) =>
    db.$executeRaw`
      INSERT INTO banned_media_hashes (id, content_sha256, perceptual_hash, source_media_id, reason, created_by_id)
      VALUES (${randomUUID()}::uuid, ${fields.sha === undefined ? sha() : fields.sha}, ${fields.phash === undefined ? dhash() : fields.phash},
              ${mediaId}::uuid, ${fields.reason ?? "Kural ihlali"}, ${adminId}::uuid)`;

  test("yasak kaydı en az bir parmak izi, geçerli biçim ve gerekçe ister", async () => {
    const admin = await createUser();
    const media = await rejectedMedia(admin);
    await expectDbError(ban(media, admin, { sha: null, phash: null }), CHECK_VIOLATION);
    await expectDbError(ban(media, admin, { sha: "büyük-harf-ve-kısa" }), CHECK_VIOLATION);
    await expectDbError(ban(media, admin, { phash: "ZZZZZZZZZZZZZZZZ" }), CHECK_VIOLATION);
    await expectDbError(ban(media, admin, { phash: "abc" }), CHECK_VIOLATION);
    await expectDbError(ban(media, admin, { reason: "   " }), CHECK_VIOLATION);
    await ban(media, admin);
    await ban(await rejectedMedia(admin), admin, { sha: null });
  });

  test("aynı görsel ve aynı sha256 ikinci kez yasaklanamaz", async () => {
    const admin = await createUser();
    const media = await rejectedMedia(admin);
    const fingerprint = sha();
    await ban(media, admin, { sha: fingerprint });
    await expectDbError(ban(media, admin), UNIQUE_VIOLATION);
    await expectDbError(ban(await rejectedMedia(admin), admin, { sha: fingerprint }), UNIQUE_VIOLATION);
  });

  test("kanıt görseli ve yasağı koyan hesap silinemez; olmayan referans reddedilir", async () => {
    const admin = await createUser();
    const media = await rejectedMedia(admin);
    await ban(media, admin);
    await expectDbError(db.$executeRaw`DELETE FROM media_assets WHERE id = ${media}::uuid`, FK_VIOLATION);
    await expectDbError(db.$executeRaw`DELETE FROM users WHERE id = ${admin}::uuid`, FK_VIOLATION);
    await expectDbError(ban(randomUUID(), admin), FK_VIOLATION);
    await expectDbError(ban(await rejectedMedia(admin), randomUUID()), FK_VIOLATION);
  });

  test("media_assets.perceptual_hash 16 haneli küçük harf hex olmak zorunda", async () => {
    const user = await createUser();
    const media = await rejectedMedia(user);
    await db.$executeRaw`UPDATE media_assets SET perceptual_hash = ${dhash()} WHERE id = ${media}::uuid`;
    await expectDbError(db.$executeRaw`UPDATE media_assets SET perceptual_hash = 'XYZ' WHERE id = ${media}::uuid`, CHECK_VIOLATION);
    await expectDbError(db.$executeRaw`UPDATE media_assets SET perceptual_hash = 'ABCDEF0123456789' WHERE id = ${media}::uuid`, CHECK_VIOLATION);
  });
});

// ─── 7. Rapor ve moderasyon (KV-24) ───────────────────────────

describe("reports ve moderation_actions (KV-24)", () => {
  type Target = { pollId?: string; commentId?: string; mediaId?: string; userId?: string };

  async function report(reporterId: string, t: Target, reason = "SPAM"): Promise<string> {
    const id = randomUUID();
    await db.$executeRaw`
      INSERT INTO reports (id, reporter_id, poll_id, comment_id, media_id, reported_user_id, reason, updated_at)
      VALUES (${id}::uuid, ${reporterId}::uuid, ${t.pollId ?? null}::uuid, ${t.commentId ?? null}::uuid,
              ${t.mediaId ?? null}::uuid, ${t.userId ?? null}::uuid, ${reason}::report_reason, now())`;
    return id;
  }

  async function action(actorId: string, t: Target, reason: string, reportId: string | null = null): Promise<string> {
    const id = randomUUID();
    await db.$executeRaw`
      INSERT INTO moderation_actions (id, actor_id, action, poll_id, comment_id, media_id, target_user_id, report_id,
                                      from_status, to_status, reason)
      VALUES (${id}::uuid, ${actorId}::uuid, 'HIDE', ${t.pollId ?? null}::uuid, ${t.commentId ?? null}::uuid,
              ${t.mediaId ?? null}::uuid, ${t.userId ?? null}::uuid, ${reportId}::uuid, 'ACTIVE', 'HIDDEN', ${reason})`;
    return id;
  }

  test("rapor tam olarak bir hedefe bağlanır", async () => {
    const reporter = await createUser();
    const author = await createUser();
    const { pollId } = await createPoll(author);
    await expectDbError(report(reporter, {}), CHECK_VIOLATION);
    await expectDbError(report(reporter, { pollId, userId: author }), CHECK_VIOLATION);
    await report(reporter, { pollId });
  });

  test("aynı kullanıcı aynı hedefi ikinci kez raporlayamaz, başka kullanıcı raporlayabilir", async () => {
    const { pollId } = await createPoll(await createUser());
    const reporter = await createUser();
    await report(reporter, { pollId });
    await expectDbError(report(reporter, { pollId }, "HARASSMENT"), UNIQUE_VIOLATION);
    await report(await createUser(), { pollId });
  });

  test("kullanıcı kendini raporlayamaz", async () => {
    const user = await createUser();
    await expectDbError(report(user, { userId: user }), CHECK_VIOLATION);
  });

  test("sonuçlanan rapor sonuçlandıranı ve zamanı taşır; açık rapor taşımaz", async () => {
    const moderator = await createUser();
    const { pollId } = await createPoll(await createUser());
    const id = await report(await createUser(), { pollId });

    await expectDbError(db.$executeRaw`UPDATE reports SET status = 'ACTIONED' WHERE id = ${id}::uuid`, CHECK_VIOLATION);
    await expectDbError(
      db.$executeRaw`UPDATE reports SET resolved_by_id = ${moderator}::uuid, resolved_at = now() WHERE id = ${id}::uuid`,
      CHECK_VIOLATION,
    );
    await db.$executeRaw`
      UPDATE reports SET status = 'ACTIONED', resolved_by_id = ${moderator}::uuid, resolved_at = now(),
        resolution_note = 'test: gizlendi', updated_at = now()
      WHERE id = ${id}::uuid`;
  });

  test("raporlanan anket hard delete edilemez", async () => {
    const { pollId } = await createPoll(await createUser());
    await report(await createUser(), { pollId });
    await expectDbError(db.$executeRaw`DELETE FROM polls WHERE id = ${pollId}::uuid`, FK_VIOLATION);
  });

  test("moderasyon işlemi gerekçesiz ve hedefsiz yazılamaz", async () => {
    const moderator = await createUser();
    const { pollId } = await createPoll(await createUser());
    await expectDbError(action(moderator, { pollId }, "   "), CHECK_VIOLATION);
    await expectDbError(action(moderator, {}, "test: gerekçe"), CHECK_VIOLATION);
    const reportId = await report(await createUser(), { pollId });
    await action(moderator, { pollId }, "test: spam", reportId);
  });

  test("moderasyon geçmişi güncellenemez ve silinemez", async () => {
    const moderator = await createUser();
    const { pollId } = await createPoll(await createUser());
    const id = await action(moderator, { pollId }, "test: gizlendi");
    await expectDbError(
      db.$executeRaw`UPDATE moderation_actions SET reason = 'değişti' WHERE id = ${id}::uuid`,
      /KV_MODERATION_ACTIONS_APPEND_ONLY/,
    );
    await expectDbError(
      db.$executeRaw`DELETE FROM moderation_actions WHERE id = ${id}::uuid`,
      /KV_MODERATION_ACTIONS_APPEND_ONLY/,
    );
  });

  test("DB enum değerleri API sözleşmesindeki adlarla aynı (KV-03)", async () => {
    async function labels(type: string): Promise<string[]> {
      const rows = await db.$queryRaw<{ label: string }[]>`
        SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = ${type} ORDER BY e.enumsortorder`;
      return rows.map((r) => r.label);
    }
    // packages/contracts/src/domains/media.ts → MediaPurpose
    assert.deepEqual(await labels("media_purpose"), ["POLL", "AVATAR", "COMMUNITY"]);
    // packages/contracts/src/domains/moderation.ts → ReportReason (sıra farklı olabilir)
    assert.deepEqual(
      (await labels("report_reason")).sort(),
      ["COPYRIGHT", "HARASSMENT", "HATE", "INAPPROPRIATE", "MISLEADING", "OTHER", "PERSONAL_INFO", "SPAM"],
    );
    // ModerationAction'ın her değeri DB'de kaydedilebilmeli.
    const actions = await labels("moderation_action_type");
    for (const a of ["HIDE", "RESTORE", "LOCK", "UNLOCK", "REMOVE", "EXCLUDE_FROM_TRENDS", "INCLUDE_IN_TRENDS", "APPROVE", "REJECT"]) {
      assert.ok(actions.includes(a), a);
    }
  });
});

// ─── 8. Topluluk (KV-31) ──────────────────────────────────────

describe("communities ve community_memberships (KV-31)", () => {
  async function createCommunity(createdById: string, slug = `kampus-${shortId()}`): Promise<string> {
    const id = randomUUID();
    await db.$executeRaw`
      INSERT INTO communities (id, slug, name, created_by_id, updated_at)
      VALUES (${id}::uuid, ${slug}, 'Samsun Üniversitesi', ${createdById}::uuid, now())`;
    return id;
  }

  async function join(communityId: string, userId: string, role = "MEMBER"): Promise<void> {
    await db.$executeRaw`
      INSERT INTO community_memberships (community_id, user_id, role, updated_at)
      VALUES (${communityId}::uuid, ${userId}::uuid, ${role}::community_role, now())`;
  }

  test("aynı kullanıcı topluluğa ikinci kez katılamaz; ayrılıp yeniden katılabilir", async () => {
    const community = await createCommunity(await createUser());
    const user = await createUser();
    await join(community, user);
    await expectDbError(join(community, user), UNIQUE_VIOLATION);

    await db.$executeRaw`DELETE FROM community_memberships WHERE community_id = ${community}::uuid AND user_id = ${user}::uuid`;
    await join(community, user);
  });

  test("slug benzersiz ve sözleşmedeki biçimde, ad boş olamaz", async () => {
    const admin = await createUser();
    const slug = `topluluk-${shortId()}`;
    await createCommunity(admin, slug);
    await expectDbError(createCommunity(admin, slug), UNIQUE_VIOLATION);
    await expectDbError(createCommunity(admin, "Samsun Üni"), CHECK_VIOLATION);
    await expectDbError(createCommunity(admin, "a"), CHECK_VIOLATION);
    await expectDbError(createCommunity(admin, `A${shortId()}`), CHECK_VIOLATION);
    await expectDbError(
      db.$executeRaw`
        INSERT INTO communities (id, slug, name, created_by_id, updated_at)
        VALUES (${randomUUID()}::uuid, ${`bos-${shortId()}`}, '   ', ${admin}::uuid, now())`,
      CHECK_VIOLATION,
    );
  });

  test("üye sayısı negatif olamaz", async () => {
    const community = await createCommunity(await createUser());
    await expectDbError(
      db.$executeRaw`UPDATE communities SET member_count = member_count - 1 WHERE id = ${community}::uuid`,
      CHECK_VIOLATION,
    );
  });

  test("moderatör rolü üyelikte tutulur ve kaldırılabilir", async () => {
    const community = await createCommunity(await createUser());
    const moderator = await createUser();
    await join(community, moderator, "MODERATOR");
    await db.$executeRaw`
      UPDATE community_memberships SET role = 'MEMBER', updated_at = now()
      WHERE community_id = ${community}::uuid AND user_id = ${moderator}::uuid`;
    const row = await one(db.$queryRaw<{ role: string }[]>`
      SELECT role::text FROM community_memberships
      WHERE community_id = ${community}::uuid AND user_id = ${moderator}::uuid`);
    assert.equal(row.role, "MEMBER");
  });

  test("anketi olan topluluk silinemez; kapatmak anketleri etkilemez", async () => {
    const author = await createUser();
    const community = await createCommunity(author);
    const { pollId } = await createPoll(author);
    await db.$executeRaw`UPDATE polls SET community_id = ${community}::uuid WHERE id = ${pollId}::uuid`;

    await expectDbError(db.$executeRaw`DELETE FROM communities WHERE id = ${community}::uuid`, FK_VIOLATION);
    await db.$executeRaw`UPDATE communities SET status = 'HIDDEN', updated_at = now() WHERE id = ${community}::uuid`;
    const poll = await one(db.$queryRaw<{ status: string }[]>`SELECT status::text FROM polls WHERE id = ${pollId}::uuid`);
    assert.equal(poll.status, "ACTIVE");
  });
});

// ─── 9. Rol ve yaptırım (KV-12) ───────────────────────────────

describe("user_roles ve sanctions (KV-12)", () => {
  const IMMUTABLE = /KV_SANCTIONS_IMMUTABLE/;

  function grantRole(userId: string, role: string, grantedById: string | null) {
    return db.$executeRaw`
      INSERT INTO user_roles (user_id, role, granted_by_id, updated_at)
      VALUES (${userId}::uuid, ${role}::user_role, ${grantedById}::uuid, now())`;
  }

  type SanctionInput = { type?: string; reason?: string; startsIn?: string; endsIn?: string | null };

  /** Zamanlar now()'a göre interval olarak verilir; endsIn verilmezse kalıcı. */
  async function sanction(userId: string, createdById: string, s: SanctionInput = {}): Promise<string> {
    const id = randomUUID();
    await db.$executeRaw`
      INSERT INTO sanctions (id, user_id, type, reason, starts_at, ends_at, created_by_id)
      VALUES (${id}::uuid, ${userId}::uuid, ${s.type ?? "RESTRICT_COMMENTS"}::sanction_type, ${s.reason ?? "test: spam"},
              now() + ${s.startsIn ?? "0 seconds"}::interval, now() + ${s.endsIn ?? null}::interval, ${createdById}::uuid)`;
    return id;
  }

  function lift(id: string, liftedById: string, reason = "test: itiraz kabul") {
    return db.$executeRaw`
      UPDATE sanctions SET lifted_at = now(), lifted_by_id = ${liftedById}::uuid, lift_reason = ${reason}
      WHERE id = ${id}::uuid`;
  }

  test("rol: USER satırı, kendine rol ve verensiz rol yazılamaz; ilk SUPER_ADMIN verensiz yazılır", async () => {
    const superAdmin = await createUser();
    const user = await createUser();
    await expectDbError(grantRole(user, "USER", superAdmin), CHECK_VIOLATION);
    await expectDbError(grantRole(user, "ADMIN", user), CHECK_VIOLATION);
    await expectDbError(grantRole(user, "ADMIN", null), CHECK_VIOLATION);

    await grantRole(superAdmin, "SUPER_ADMIN", null);
    await grantRole(user, "MODERATOR", superAdmin);
    // Kullanıcı başına tek rol: atama satırı günceller, ikinci satır yazılamaz.
    await expectDbError(grantRole(user, "ADMIN", superAdmin), UNIQUE_VIOLATION);
    await db.$executeRaw`UPDATE user_roles SET role = 'ADMIN', updated_at = now() WHERE user_id = ${user}::uuid`;
    await expectDbError(
      db.$executeRaw`UPDATE user_roles SET granted_by_id = NULL WHERE user_id = ${user}::uuid`,
      CHECK_VIOLATION,
    );
  });

  test("var olmayan kullanıcıya rol ve yaptırım verilemez", async () => {
    const admin = await createUser();
    await expectDbError(grantRole(randomUUID(), "ADMIN", admin), FK_VIOLATION);
    await expectDbError(grantRole(await createUser(), "ADMIN", randomUUID()), FK_VIOLATION);
    await expectDbError(sanction(randomUUID(), admin), FK_VIOLATION);
    await expectDbError(sanction(await createUser(), randomUUID()), FK_VIOLATION);
  });

  test("users'a giden bütün FK'ler RESTRICT; rol veya yaptırım izi olan kullanıcı silinemez", async () => {
    const fks = await db.$queryRaw<{ name: string; onDelete: string }[]>`
      SELECT conname AS name, confdeltype::text AS "onDelete" FROM pg_constraint
      WHERE contype = 'f' AND confrelid = 'users'::regclass
        AND conrelid IN ('user_roles'::regclass, 'sanctions'::regclass)
      ORDER BY conname`;
    assert.deepEqual(fks, [
      { name: "sanctions_created_by_id_fkey", onDelete: "r" },
      { name: "sanctions_lifted_by_id_fkey", onDelete: "r" },
      { name: "sanctions_user_id_fkey", onDelete: "r" },
      { name: "user_roles_granted_by_id_fkey", onDelete: "r" },
      { name: "user_roles_user_id_fkey", onDelete: "r" },
    ]);

    const granter = await createUser();
    const holder = await createUser();
    await grantRole(holder, "MODERATOR", granter);
    const target = await createUser();
    const issuer = await createUser();
    const lifter = await createUser();
    await lift(await sanction(target, issuer), lifter);

    for (const id of [granter, holder, target, issuer, lifter]) {
      await expectDbError(db.$executeRaw`DELETE FROM users WHERE id = ${id}::uuid`, FK_VIOLATION);
    }
  });

  test("yaptırım süresi: ends_at starts_at'ten sonra, SUSPEND süreli, BAN kalıcı", async () => {
    const admin = await createUser();
    const user = await createUser();
    await expectDbError(sanction(user, admin, { endsIn: "0 seconds" }), CHECK_VIOLATION);
    await expectDbError(sanction(user, admin, { startsIn: "1 day", endsIn: "1 hour" }), CHECK_VIOLATION);
    await expectDbError(sanction(user, admin, { type: "SUSPEND" }), CHECK_VIOLATION);
    await expectDbError(sanction(user, admin, { type: "BAN", endsIn: "30 days" }), CHECK_VIOLATION);

    await sanction(user, admin, { type: "SUSPEND", endsIn: "7 days" });
    await sanction(user, admin, { type: "BAN" });
    await sanction(user, admin, { type: "RESTRICT_POSTING", endsIn: "1 day" });
  });

  test("kimse kendine yaptırım uygulayamaz ve kendi yaptırımını kaldıramaz", async () => {
    const admin = await createUser();
    const user = await createUser();
    await expectDbError(sanction(admin, admin), CHECK_VIOLATION);
    const id = await sanction(user, admin);
    await expectDbError(lift(id, user), CHECK_VIOLATION);
    await lift(id, admin);
  });

  test("gerekçe boş olamaz; kaldırma bilgisi üçü birlikte dolar", async () => {
    const admin = await createUser();
    const user = await createUser();
    await expectDbError(sanction(user, admin, { reason: "  a " }), CHECK_VIOLATION);
    const id = await sanction(user, admin);
    await expectDbError(db.$executeRaw`UPDATE sanctions SET lifted_at = now() WHERE id = ${id}::uuid`, CHECK_VIOLATION);
    await expectDbError(
      db.$executeRaw`UPDATE sanctions SET lifted_at = now(), lifted_by_id = ${admin}::uuid WHERE id = ${id}::uuid`,
      CHECK_VIOLATION,
    );
    await expectDbError(lift(id, admin, "   "), CHECK_VIOLATION);
  });

  test("yaptırım değişmez: sadece kaldırma alanları bir kez NULL'dan doluya geçer", async () => {
    const admin = await createUser();
    const otherAdmin = await createUser();
    const user = await createUser();
    const id = await sanction(user, admin, { type: "RESTRICT_POSTING", endsIn: "7 days" });

    // Kaldırılmamış satırda diğer alanlar değişmez, satır silinmez.
    for (const change of [
      () => db.$executeRaw`UPDATE sanctions SET type = 'BAN', ends_at = NULL WHERE id = ${id}::uuid`,
      () => db.$executeRaw`UPDATE sanctions SET ends_at = ends_at + interval '1 day' WHERE id = ${id}::uuid`,
      () => db.$executeRaw`UPDATE sanctions SET reason = 'test: değişti' WHERE id = ${id}::uuid`,
      () => db.$executeRaw`UPDATE sanctions SET user_id = ${otherAdmin}::uuid WHERE id = ${id}::uuid`,
      () => db.$executeRaw`UPDATE sanctions SET created_by_id = ${otherAdmin}::uuid WHERE id = ${id}::uuid`,
      // Kaldırma yapmayan (no-op) güncelleme de reddedilir.
      () => db.$executeRaw`UPDATE sanctions SET lifted_at = NULL WHERE id = ${id}::uuid`,
      // Kaldırmayla birlikte başka alan değiştirilemez.
      () => db.$executeRaw`
        UPDATE sanctions SET lifted_at = now(), lifted_by_id = ${otherAdmin}::uuid, lift_reason = 'test: kaldır',
          ends_at = NULL
        WHERE id = ${id}::uuid`,
      () => db.$executeRaw`DELETE FROM sanctions WHERE id = ${id}::uuid`,
    ]) {
      await expectDbError(change(), IMMUTABLE);
    }

    // Tek izinli geçiş: kaldırma bilgisi NULL → dolu.
    await lift(id, otherAdmin);
    const row = await one(db.$queryRaw<{ type: string; lifted: boolean; liftedBy: string; reason: string }[]>`
      SELECT type::text, lifted_at IS NOT NULL AS lifted, lifted_by_id::text AS "liftedBy", reason
      FROM sanctions WHERE id = ${id}::uuid`);
    assert.deepEqual(row, { type: "RESTRICT_POSTING", lifted: true, liftedBy: otherAdmin, reason: "test: spam" });

    // Kaldırılmış satır: ikinci kaldırma, kaldırmayı geri alma, düzenleme ve silme reddedilir.
    for (const change of [
      () => lift(id, admin, "test: ikinci kaldırma"),
      () => db.$executeRaw`UPDATE sanctions SET lifted_at = NULL, lifted_by_id = NULL, lift_reason = NULL WHERE id = ${id}::uuid`,
      () => db.$executeRaw`UPDATE sanctions SET lift_reason = 'test: değişti' WHERE id = ${id}::uuid`,
      () => db.$executeRaw`DELETE FROM sanctions WHERE id = ${id}::uuid`,
    ]) {
      await expectDbError(change(), IMMUTABLE);
    }
  });

  test("aktif yaptırım sorgusu kaldırılanı ve süresi dolanı döndürmez, index'i kullanır", async () => {
    const admin = await createUser();
    const user = await createUser();
    await sanction(user, admin, { type: "WARNING" });
    await sanction(user, admin, { type: "RESTRICT_COMMENTS" });
    await sanction(user, admin, { type: "SUSPEND", endsIn: "3 days" });
    await sanction(user, admin, { type: "RESTRICT_POSTING", startsIn: "-2 days", endsIn: "-1 day" });
    await lift(await sanction(user, admin, { type: "BAN" }), await createUser());

    const active = await db.$queryRaw<{ type: string }[]>`
      SELECT type::text FROM sanctions
      WHERE user_id = ${user}::uuid AND lifted_at IS NULL AND (ends_at IS NULL OR ends_at > now())`;
    assert.deepEqual(active.map((r) => r.type).sort(), ["RESTRICT_COMMENTS", "SUSPEND", "WARNING"]);

    const plan = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      return tx.$queryRaw<{ "QUERY PLAN": string }[]>`
        EXPLAIN SELECT * FROM sanctions
        WHERE user_id = ${user}::uuid AND lifted_at IS NULL AND (ends_at IS NULL OR ends_at > now())`;
    });
    assert.match(plan.map((r) => r["QUERY PLAN"]).join("\n"), /sanctions_user_id_lifted_at_ends_at_idx/);
  });

  // Sıra da doğrulanır: user_role'de tanım sırası hiyerarşidir (USER < … < SUPER_ADMIN); SQL'de
  // rol karşılaştırılırsa yanlış sıra sessiz yetki hatası olur. enum_range tanım sırasını verir.
  test("DB enum değerleri API sözleşmesindeki adlarla ve sırayla aynı (contracts Role, SanctionType)", async () => {
    const userRoles = await db.$queryRaw<{ label: string }[]>`
      SELECT v::text AS label FROM unnest(enum_range(NULL::user_role)) WITH ORDINALITY AS r(v, i) ORDER BY i`;
    const sanctionTypes = await db.$queryRaw<{ label: string }[]>`
      SELECT v::text AS label FROM unnest(enum_range(NULL::sanction_type)) WITH ORDINALITY AS r(v, i) ORDER BY i`;
    assert.deepEqual(userRoles.map((r) => r.label), [...roles]);
    assert.deepEqual(sanctionTypes.map((r) => r.label), [...SanctionType.options]);
  });
});

// ─── 9.2 Audit (KV-39) ────────────────────────────────────────

describe("audit_logs (KV-39)", () => {
  const APPEND_ONLY = /KV_AUDIT_LOGS_APPEND_ONLY/;

  type AuditInput = {
    source?: string;
    action?: string;
    operation?: string;
    targetType?: string;
    targetId?: string;
    reason?: string | null;
    /** JSON metni */
    before?: string | null;
    requestId?: string | null;
  };

  /** Varsayılan: geçerli bir API kaydı. */
  async function audit(actorId: string | null, a: AuditInput = {}): Promise<string> {
    const id = randomUUID();
    await db.$executeRaw`
      INSERT INTO audit_logs (id, actor_id, source, action, operation, target_type, target_id, reason, before, request_id)
      VALUES (${id}::uuid, ${actorId}::uuid, ${a.source ?? "API"}::audit_source, ${a.action ?? "user.sanction"},
              ${a.operation ?? "apply"}, ${a.targetType ?? "USER"}, ${a.targetId ?? randomUUID()},
              ${a.reason === undefined ? "test: spam" : a.reason}, ${a.before ?? null}::jsonb,
              ${a.requestId === undefined ? "req_test_0001" : a.requestId})`;
    return id;
  }

  test("aktör FK'si RESTRICT; audit izi olan kullanıcı silinemez, olmayan aktöre yazılamaz", async () => {
    const fk = await one(db.$queryRaw<{ onDelete: string }[]>`
      SELECT confdeltype::text AS "onDelete" FROM pg_constraint WHERE conname = 'audit_logs_actor_id_fkey'`);
    assert.equal(fk.onDelete, "r");
    const admin = await createUser();
    await audit(admin);
    await expectDbError(db.$executeRaw`DELETE FROM users WHERE id = ${admin}::uuid`, FK_VIOLATION);
    await expectDbError(audit(randomUUID()), FK_VIOLATION);
  });

  test("kaynak ve aktör tutarlı: API aktörlü ve request_id'li, CLI/WORKER aktörsüz", async () => {
    const admin = await createUser();
    await expectDbError(audit(null), CHECK_VIOLATION);
    await expectDbError(audit(admin, { source: "CLI", requestId: null }), CHECK_VIOLATION);
    await expectDbError(audit(admin, { requestId: null }), CHECK_VIOLATION);
    await expectDbError(audit(admin, { requestId: "" }), CHECK_VIOLATION);
    await audit(null, { source: "CLI", action: "user.role.assign", operation: "assign", requestId: null });
    await audit(null, { source: "WORKER", action: "user.status.sync", operation: "sync", reason: null, requestId: null });
  });

  test("biçim kısıtları: işlem, tür, hedef, gerekçe ve özet", async () => {
    const admin = await createUser();
    for (const bad of [
      { action: "UserSanction" },
      { action: "sanction" },
      { operation: "Apply" },
      { operation: "" },
      { targetType: "user" },
      { targetId: "" },
      { reason: "  a " },
      { before: "[1, 2]" },
      { before: "null" },
      { before: '"ACTIVE"' },
    ]) {
      await expectDbError(audit(admin, bad), CHECK_VIOLATION);
    }
    // Gerekçesiz kayıt DB'de geçerlidir; hangi işlemin gerekçe istediğini contracts zorlar.
    await audit(admin, { action: "revision.read", operation: "read", targetType: "POLL", reason: null });
    await audit(admin, { action: "account.verifyEmail", operation: "verify_email", before: '{"status": "ACTIVE"}' });
    await audit(admin, { action: "settings.update", operation: "update", targetType: "SETTING", targetId: "polls.maxOptions" });
  });

  test("append-only: UPDATE, DELETE ve TRUNCATE reddedilir", async () => {
    const admin = await createUser();
    const id = await audit(admin, { before: '{"status": "ACTIVE"}' });
    for (const change of [
      () => db.$executeRaw`UPDATE audit_logs SET reason = 'test: değişti' WHERE id = ${id}::uuid`,
      () => db.$executeRaw`UPDATE audit_logs SET before = NULL WHERE id = ${id}::uuid`,
      // Değer değiştirmeyen güncelleme de reddedilir.
      () => db.$executeRaw`UPDATE audit_logs SET created_at = created_at WHERE id = ${id}::uuid`,
      () => db.$executeRaw`DELETE FROM audit_logs WHERE id = ${id}::uuid`,
      () => db.$executeRaw`TRUNCATE audit_logs`,
    ]) {
      await expectDbError(change(), APPEND_ONLY);
    }
    const row = await one(db.$queryRaw<{ reason: string }[]>`SELECT reason FROM audit_logs WHERE id = ${id}::uuid`);
    assert.equal(row.reason, "test: spam");
  });

  test("hedef, aktör, işlem türü ve zaman sorguları index kullanır", async () => {
    const admin = await createUser();
    const target = randomUUID();
    await audit(admin, { targetId: target });
    const plans = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      const explain = async (q: Promise<{ "QUERY PLAN": string }[]>) => (await q).map((r) => r["QUERY PLAN"]).join("\n");
      return {
        target: await explain(tx.$queryRaw`
          EXPLAIN SELECT * FROM audit_logs WHERE target_type = 'USER' AND target_id = ${target} ORDER BY created_at DESC`),
        actor: await explain(tx.$queryRaw`
          EXPLAIN SELECT * FROM audit_logs WHERE actor_id = ${admin}::uuid ORDER BY created_at DESC`),
        operation: await explain(tx.$queryRaw`
          EXPLAIN SELECT * FROM audit_logs WHERE action = 'vote.invalidate' AND operation = 'restore' ORDER BY created_at DESC`),
        time: await explain(tx.$queryRaw`
          EXPLAIN SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20`),
      };
    });
    assert.match(plans.target, /audit_logs_target_type_target_id_created_at_idx/);
    assert.match(plans.actor, /audit_logs_actor_id_created_at_idx/);
    assert.match(plans.operation, /audit_logs_action_operation_created_at_idx/);
    assert.match(plans.time, /audit_logs_created_at_idx/);
  });

  test("audit_source enum'u contracts AuditSource ile aynı", async () => {
    const labels = await db.$queryRaw<{ label: string }[]>`
      SELECT v::text AS label FROM unnest(enum_range(NULL::audit_source)) WITH ORDINALITY AS r(v, i) ORDER BY i`;
    assert.deepEqual(labels.map((r) => r.label), [...AuditSource.options]);
  });
});

// ─── 10. Türkçe normalizasyon ─────────────────────────────────

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

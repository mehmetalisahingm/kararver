/**
 * #297 / #288 / #291 — restore edilmiş kopyada kişisel verinin arındırılması (ops/sanitize.ts).
 * - Birim: hedef güvenliği (yalnız yerel sunucu, ad kuralı, canlı DB ile aynı olamaz).
 * - PostgreSQL (TEST_DATABASE_URL yoksa atlanır): "<test>_sanitize" veritabanı migration'larla açılır, gerçek ve test hesaplı
 *   sentetik veri yazılır; deneme hiçbir şeyi değiştirmez, --apply gerçek kimlik izlerini siler ve yapısal değerleri korur.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { withDatabase } from "../ops/pg-tools.ts";
import { assertSafeTarget, sanitize } from "../ops/sanitize.ts";
import { createPrismaClient, type PrismaClient } from "../src/index.ts";

const packageDir = path.resolve(import.meta.dirname, "..");

describe("arındırma hedefi güvenliği", () => {
  test("yalnız yerel sunucu, uygun ad ve canlı DB'den farklı hedef", () => {
    assert.doesNotThrow(() => assertSafeTarget("postgresql://u:p@localhost:5432/kararver_restore_20261101", undefined));
    assert.doesNotThrow(() => assertSafeTarget("postgresql://u:p@127.0.0.1:5432/x_sanitize", undefined));
    assert.doesNotThrow(() => assertSafeTarget("postgresql://u:p@[::1]:5432/kararver_test", undefined));
    assert.throws(() => assertSafeTarget("postgresql://u:p@iriguchi.proxy.rlwy.net:34409/railway_restore", undefined), /yalnız yerel/);
    assert.throws(() => assertSafeTarget("postgresql://u:p@localhost:5432/railway", undefined), /restore/);
    assert.throws(() => assertSafeTarget("postgresql://u:p@localhost:5432/kararver_restore", "postgresql://u:p@localhost:5432/kararver_restore"), /aynı olamaz/);
  });
});

function testUrl(): string | null {
  return process.env.TEST_DATABASE_URL ?? null;
}

const base = testUrl();

describe("restore edilmiş kopyada arındırma (postgres)", { skip: base === null ? "TEST_DATABASE_URL yok (CI'da çalışır)" : false }, () => {
  const baseName = base ? decodeURIComponent(new URL(base).pathname.slice(1)) : "";
  const url = base ? withDatabase(base, `${baseName}_sanitize`) : "";
  let admin: PrismaClient;
  let db: PrismaClient;
  const real = { id: randomUUID(), email: "Gercek.Kisi@Gmail.com", username: "gercekkisi", display: "Gerçek Kişi" };
  const generic = { id: randomUUID(), email: "admin.owner@gmail.com", username: "admin", display: "admin" };
  const fake = { id: randomUUID(), email: "sec_kv44_abc@example.test", username: "sec_kv44_abc", display: "Test" };
  const pollId = randomUUID();
  const auditId = randomUUID();
  const eventId = randomUUID();

  before(async () => {
    assert.ok(baseName.endsWith("_test"), "test yalnız _test veritabanının yanında çalışır");
    admin = createPrismaClient(withDatabase(base!, "postgres"));
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${baseName}_sanitize" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${baseName}_sanitize"`);
    const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
    const r = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: packageDir, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    db = createPrismaClient(url);
    for (const u of [real, generic, fake]) {
      await db.$executeRaw`INSERT INTO users (id, email, email_normalized, username, username_normalized, display_name, bio, password_hash, updated_at)
        VALUES (${u.id}::uuid, ${u.email}, ${u.email.toLowerCase()}, ${u.username}, ${u.username}, ${u.display}, ${"bio " + u.display}, '$argon2id$x', now())`;
      await db.$executeRaw`INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
        VALUES (${randomUUID()}::uuid, ${u.id}::uuid, ${randomUUID().replaceAll("-", "").padEnd(64, "0")}, now() + interval '1 day', '203.0.113.7', 'Mozilla/5.0')`;
    }
    const [category] = await db.$queryRaw<{ id: string }[]>`SELECT id::text FROM categories LIMIT 1`;
    await db.$executeRaw`INSERT INTO polls (id, public_id, author_id, category_id, kind, title, slug, status, opens_at, results_visibility, updated_at)
      VALUES (${pollId}::uuid, ${pollId.replaceAll("-", "").slice(0, 8)}, ${real.id}::uuid, ${category!.id}::uuid, 'DISCUSSION', ${"gercekkisi ve admin soruyor"}, ${"gercekkisi-soruyor-" + pollId.slice(0, 8)}, 'ACTIVE', now(), NULL, now())`;
    // Audit: gerekçede e-posta, before/after'da kullanıcı adı değeri ve rol değeri "ADMIN"; işlem adı "admin.*".
    await db.$executeRawUnsafe(
      `ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only`,
    );
    await db.$executeRaw`INSERT INTO audit_logs (id, actor_id, source, action, operation, target_type, target_id, reason, before, after, request_id)
      VALUES (${auditId}::uuid, ${generic.id}::uuid, 'API', 'user.role.assign', 'change', 'USER', ${real.id},
              ${"talep: " + real.email + " (gercekkisi)"}, ${JSON.stringify({ username: "gercekkisi", role: "ADMIN" })}::jsonb,
              ${JSON.stringify({ username: "admin", roles: ["ADMIN", "USER"], note: "admin.users.list" })}::jsonb, 'req-1')`;
    await db.$executeRawUnsafe(`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only`);
    await db.$executeRaw`INSERT INTO domain_events (id, type, version, occurred_at, subject_type, subject_id, payload, natural_key)
      VALUES (${eventId}::uuid, 'user.registered', 1, now(), 'USER', ${real.id}, ${JSON.stringify({ email: real.email.toLowerCase(), username: "gercekkisi", action: "admin.users.list" })}::jsonb, ${"t-" + eventId})`;
  });

  after(async () => {
    await db?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${baseName}_sanitize" WITH (FORCE)`);
      await admin.$disconnect();
    }
  });

  const snapshot = async () => ({
    users: await db.$queryRaw<{ email: string; username: string; bio: string | null }[]>`SELECT email, username, bio FROM users ORDER BY id`,
    sessions: Number((await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM sessions`)[0]!.n),
    audit: (await db.$queryRaw<{ action: string; reason: string; before: unknown; after: unknown }[]>`SELECT action, reason, before, after FROM audit_logs WHERE id = ${auditId}::uuid`)[0]!,
    event: (await db.$queryRaw<{ payload: Record<string, string> }[]>`SELECT payload FROM domain_events WHERE id = ${eventId}::uuid`)[0]!.payload,
    poll: (await db.$queryRaw<{ title: string }[]>`SELECT title FROM polls WHERE id = ${pollId}::uuid`)[0]!.title,
  });

  test("deneme (dry-run) doğrular ama hiçbir şeyi değiştirmez", async () => {
    const beforeRun = await snapshot();
    const r = await sanitize(url, { apply: false });
    assert.equal(r.applied, false);
    assert.equal(r.realUsers, 2, "gmail.com iki hesap; example.test hesabı test sayılır");
    assert.deepEqual(r.remaining, { identifiers: 0, sessions: 0, mfa: 0, realUsers: 0 });
    assert.deepEqual(await snapshot(), beforeRun);
  });

  test("--apply: gerçek kimlik izleri ve oturumlar gider, yapısal değerler ve test hesabı kalır", async () => {
    const r = await sanitize(url, { apply: true });
    assert.equal(r.applied, true);
    assert.ok(r.ok, JSON.stringify(r.invariants));
    assert.equal(r.purged.sessions, 3, "bütün oturumlar (IP, user-agent) silinir");
    const after = await snapshot();
    assert.equal(after.sessions, 0);
    const dump = JSON.stringify(after);
    for (const trace of ["gercek.kisi@gmail.com", "admin.owner@gmail.com", "gercekkisi", "Gerçek Kişi", "bio admin"]) {
      assert.ok(!dump.toLowerCase().includes(trace.toLowerCase()), `iz kaldı: ${trace}`);
    }
    // Yapısal değerler: işlem adı, rol değerleri ve "admin.users.list" metni değişmez (genel ad "admin" yalnız tam değer olarak değişir).
    assert.equal(after.audit.action, "user.role.assign");
    assert.deepEqual((after.audit.before as { role: string }).role, "ADMIN");
    assert.deepEqual((after.audit.after as { roles: string[] }).roles, ["ADMIN", "USER"]);
    assert.equal((after.audit.after as { note: string }).note, "admin.users.list");
    assert.match((after.audit.after as { username: string }).username, /^user_[0-9a-f]{20}$/);
    assert.equal(after.event.action, "admin.users.list");
    assert.match(after.event.email, /^user_[0-9a-f]{20}@example\.test$/);
    assert.match(after.poll, /^user_[0-9a-f]{20} ve user_[0-9a-f]{20} soruyor$/);
    const fakeRow = after.users.find((u) => u.username === fake.username);
    assert.ok(fakeRow, "test hesabı değişmez");
    // Ekleme-yalnız tetikleyiciler geri açık.
    const [{ n }] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'D'`;
    assert.equal(Number(n), 0);
    // İkinci çalıştırma: gerçek hesap kalmadı, değişiklik yok.
    const again = await sanitize(url, { apply: true });
    assert.equal(again.realUsers, 0);
    assert.deepEqual(again.rewritten, {});
  });
});

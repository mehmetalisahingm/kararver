/**
 * #297 / #288 / #291 / #299 — izole, restore edilmiş kopyada kişisel verinin arındırılması (ops/sanitize.ts).
 * - Birim: hedef güvenliği (yalnız yerel sunucu, sorgu parametresi yok, ad kuralı, canlı DB ile aynı olamaz) ve Türkçe
 *   harf duyarsız kalıp.
 * - PostgreSQL (TEST_DATABASE_URL yoksa atlanır): her senaryo için ayrı "<test>_sanitize_*" veritabanı migration'larla
 *   açılır ve aynı sentetik veriyle doldurulur (gerçek SUPER_ADMIN, genel "admin", test hesabı, hesabı olmayan üçüncü
 *   kişinin e-postası, farklı harf yazımlı Türkçe ad, JSON içinde cümle, kullanıcı adıyla aynı JSON anahtarı).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { ISOLATED_COPY_MARKER, withDatabase } from "../ops/pg-tools.ts";
import { assertSafeTarget, caseInsensitivePattern, sanitize } from "../ops/sanitize.ts";
import { createPrismaClient, type PrismaClient } from "../src/index.ts";

const packageDir = path.resolve(import.meta.dirname, "..");

describe("arındırma hedefi güvenliği", () => {
  test("yalnız yerel sunucu, sorgu parametresiz, uygun ad ve canlı DB'den farklı hedef", () => {
    assert.doesNotThrow(() => assertSafeTarget("postgresql://u:p@localhost:5432/kararver_restore_20261101", undefined));
    assert.doesNotThrow(() => assertSafeTarget("postgresql://u:p@127.0.0.1:5432/x_sanitize", undefined));
    assert.doesNotThrow(() => assertSafeTarget("postgresql://u:p@[::1]:5432/kararver_test", undefined));
    assert.throws(() => assertSafeTarget("postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb_restore", undefined), /yalnız yerel/);
    assert.throws(() => assertSafeTarget("postgresql://u:p@iriguchi.proxy.rlwy.net:34409/railway_restore", undefined), /yalnız yerel/);
    assert.throws(() => assertSafeTarget("postgresql://u:p@localhost/x_restore?host=uzak.example.com", undefined), /sorgu parametresi/);
    assert.throws(() => assertSafeTarget("postgresql://u:p@localhost/x_restore?sslmode=require", undefined), /sorgu parametresi/);
    assert.throws(() => assertSafeTarget("postgresql://u:p@localhost:5432/railway", undefined), /restore/);
    assert.throws(() => assertSafeTarget("postgresql://u:p@localhost:5432/kararver_restore", "postgresql://u:p@localhost:5432/kararver_restore"), /aynı olamaz/);
  });

  test("harf duyarsız kalıp Türkçe harfleri ve İ/ı biçimlerini kapsar", () => {
    const re = new RegExp(`^${caseInsensitivePattern("Çağla Işık")}$`, "u");
    for (const s of ["Çağla Işık", "çağla ışık", "ÇAĞLA IŞIK", "çaĞLa iŞik"]) assert.ok(re.test(s), s);
    assert.ok(!re.test("Cagla Isik"), "Türkçe harf ASCII karşılığıyla eşleşmez (ayrı yazım)");
  });
});

const base = process.env.TEST_DATABASE_URL ?? null;

describe("izole kopyada arındırma (postgres)", { skip: base === null ? "TEST_DATABASE_URL yok (CI'da çalışır)" : false }, () => {
  const baseName = base ? decodeURIComponent(new URL(base).pathname.slice(1)) : "";
  let admin: PrismaClient;
  const opened: { name: string; db: PrismaClient }[] = [];
  const owner = { id: randomUUID(), email: "Sahip.Kisi@Gmail.com", username: "sahipkisi", display: "Sahip Kişi" };
  const real = { id: randomUUID(), email: "Cagla.Isik@Gmail.com", username: "caglaisik", display: "Çağla Işık" };
  const generic = { id: randomUUID(), email: "admin.owner@gmail.com", username: "admin", display: "admin" };
  const fake = { id: randomUUID(), email: "sec_kv44_abc@example.test", username: "sec_kv44_abc", display: "Test" };
  const third = "ucuncu.kisi@hotmail.com";

  /** Taze veritabanı + aynı sentetik veri. */
  async function fixture(suffix: string, { marked = true } = {}) {
    const name = `${baseName}_sanitize_${suffix}`;
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    // db:restore'un yazdığı izole kopya işareti (marked=false: canlı DB gibi işaretsiz).
    if (marked) await admin.$executeRawUnsafe(`COMMENT ON DATABASE "${name}" IS '${ISOLATED_COPY_MARKER} test'`);
    const url = withDatabase(base!, name);
    const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
    const r = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: packageDir, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const db = createPrismaClient(url);
    opened.push({ name, db });
    for (const u of [owner, real, generic, fake]) {
      await db.$executeRaw`INSERT INTO users (id, email, email_normalized, username, username_normalized, display_name, bio, password_hash, updated_at)
        VALUES (${u.id}::uuid, ${u.email}, ${u.email.toLowerCase()}, ${u.username}, ${u.username}, ${u.display}, ${"bio " + u.display + (u.id === owner.id ? "; üçüncü kişi: " + third : "")}, '$argon2id$x', now())`;
      await db.$executeRaw`INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
        VALUES (${randomUUID()}::uuid, ${u.id}::uuid, ${randomUUID().replaceAll("-", "").padEnd(64, "0")}, now() + interval '1 day', '203.0.113.7', 'Mozilla/5.0')`;
    }
    // Gerçek e-postalı tek SUPER_ADMIN (bootstrap verensiz satır) ve test alanlı bir ADMIN.
    await db.$executeRaw`INSERT INTO user_roles (user_id, role, created_at, updated_at) VALUES (${owner.id}::uuid, 'SUPER_ADMIN', now(), now())`;
    await db.$executeRaw`INSERT INTO user_roles (user_id, role, granted_by_id, created_at, updated_at) VALUES (${fake.id}::uuid, 'ADMIN', ${owner.id}::uuid, now(), now())`;
    const [category] = await db.$queryRaw<{ id: string }[]>`SELECT id::text FROM categories LIMIT 1`;
    const pollId = randomUUID();
    await db.$executeRaw`INSERT INTO polls (id, public_id, author_id, category_id, kind, title, slug, status, opens_at, results_visibility, updated_at)
      VALUES (${pollId}::uuid, ${pollId.replaceAll("-", "").slice(0, 8)}, ${real.id}::uuid, ${category!.id}::uuid, 'DISCUSSION',
              ${"caglaisik ve ÇAĞLA IŞIK soruyor; iletişim " + third}, ${"caglaisik-soruyor-" + pollId.slice(0, 8)}, 'ACTIVE', now(), NULL, now())`;
    await db.$executeRawUnsafe(`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only`);
    await db.$executeRaw`INSERT INTO audit_logs (id, actor_id, source, action, operation, target_type, target_id, reason, before, after, request_id)
      VALUES (${randomUUID()}::uuid, ${owner.id}::uuid, 'API', 'user.role.assign', 'change', 'USER', ${real.id},
              ${"talep: " + real.email + " (caglaisik), bilgi: " + third},
              ${JSON.stringify({ username: "caglaisik", role: "ADMIN", note: "çağla ışık başvurdu", caglaisik: 1 })}::jsonb,
              ${JSON.stringify({ username: "admin", roles: ["ADMIN", "USER"], note: "admin.users.list", admin: 3 })}::jsonb, 'req-1')`;
    await db.$executeRawUnsafe(`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only`);
    const eventId = randomUUID();
    await db.$executeRaw`INSERT INTO domain_events (id, type, version, occurred_at, subject_type, subject_id, payload, natural_key)
      VALUES (${eventId}::uuid, 'user.registered', 1, now(), 'USER', ${real.id},
              ${JSON.stringify({ email: real.email.toLowerCase(), title: "Çağla Işık soruyor", contact: third, action: "admin.users.list" })}::jsonb, ${"t-" + eventId})`;
    return { url, db, pollId };
  }

  const dump = async (db: PrismaClient) =>
    JSON.stringify({
      polls: await db.$queryRawUnsafe(`SELECT title, slug FROM polls`),
      audit: await db.$queryRawUnsafe(`SELECT reason, before, after, action FROM audit_logs`),
      events: await db.$queryRawUnsafe(`SELECT payload FROM domain_events`),
    });
  const users = (db: PrismaClient) =>
    db.$queryRawUnsafe<{ id: string; email: string; username: string; password_hash: string }[]>(`SELECT id::text, email, username, password_hash FROM users`);
  const roles = (db: PrismaClient) => db.$queryRawUnsafe<{ user_id: string; role: string }[]>(`SELECT user_id::text, role::text FROM user_roles ORDER BY role`);

  before(async () => {
    assert.ok(baseName.endsWith("_test"), "test yalnız _test veritabanının yanında çalışır");
    admin = createPrismaClient(withDatabase(base!, "postgres"));
  });
  after(async () => {
    for (const o of opened) {
      await o.db.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${o.name}" WITH (FORCE)`);
    }
    await admin?.$disconnect();
  });

  test("izole kopya işareti olmayan veritabanı (canlı DB gibi) reddedilir; hiçbir şey yazılmaz", async () => {
    const { url, db } = await fixture("unmarked", { marked: false });
    const before = await dump(db);
    await assert.rejects(sanitize(url, { apply: true }), /izole kopya işareti yok/);
    assert.equal(await dump(db), before);
    assert.equal((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM sessions`))[0]!.n, 4n);
  });

  test("deneme (dry-run) doğrular ama hiçbir şeyi değiştirmez", async () => {
    const { url, db } = await fixture("dry");
    const before = await dump(db);
    const r = await sanitize(url, { apply: false });
    assert.equal(r.applied, false);
    assert.equal(r.realUsers, 3, "üç gmail hesabı; example.test hesabı test sayılır");
    assert.deepEqual(r.remaining, { identifiers: 0, foreignEmails: 0, sessions: 0, mfa: 0, realUsers: 0 });
    assert.equal(await dump(db), before);
    assert.equal((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM sessions`))[0]!.n, 4n);
  });

  test("keep (varsayılan): gerçek SUPER_ADMIN kilitlenmez; diğer gerçek kişiler ve üçüncü kişi e-postası her yerde arındırılır", async () => {
    const { url, db } = await fixture("keep");
    const r = await sanitize(url, { apply: true });
    assert.ok(r.applied && r.ok, JSON.stringify(r.invariants));
    assert.deepEqual([r.realUsers, r.retainedRoleHolders, r.demotedRoles], [3, 1, 0]);
    assert.deepEqual(r.before.roles, r.after.roles, "rol satırları aynı");
    assert.equal(r.before.auditRows, r.after.auditRows, "audit satırı eklenmez/silinmez");
    const u = await users(db);
    const kept = u.find((x) => x.id === owner.id)!;
    assert.equal(kept.email, owner.email, "SUPER_ADMIN kimliği korunur");
    assert.equal(kept.password_hash, "$argon2id$x", "SUPER_ADMIN parolası korunur (giriş yapabilir)");
    const [ownerBio] = await db.$queryRaw<{ bio: string | null }[]>`SELECT bio FROM users WHERE id = ${owner.id}::uuid`;
    assert.ok(ownerBio?.bio?.includes("redacted@example.test"), "korunan rol sahibinin bio alanındaki üçüncü kişi e-postası da arındırılmalı");
    assert.ok(!ownerBio?.bio?.includes(third), "korunan hesap bio'sunda üçüncü kişi e-postası kalmamalı");
    assert.equal(u.find((x) => x.id === real.id)!.password_hash, "!sanitized");
    // JSON anahtarı olarak bilerek bırakılan "caglaisik" hariç (anahtarlar yapısaldır, değiştirilmez).
    const text = (await dump(db)).toLowerCase().replaceAll('"caglaisik":', "");
    for (const trace of ["cagla.isik@gmail.com", third, "caglaisik", "çağla ışık", "admin.owner@gmail.com"]) {
      assert.ok(!text.includes(trace), `iz kaldı: ${trace}`);
    }
    assert.ok(text.includes("redacted@example.test"), "üçüncü kişi e-postası");
    // Yapısal değerler: işlem adı, rol değerleri ve "admin.users.list" ile JSON anahtarları değişmez.
    const audit = (await db.$queryRawUnsafe<{ action: string; before: Record<string, unknown>; after: Record<string, unknown> }[]>(`SELECT action, before, after FROM audit_logs`))[0]!;
    assert.equal(audit.action, "user.role.assign");
    assert.equal(audit.before.role, "ADMIN");
    assert.deepEqual(audit.after.roles, ["ADMIN", "USER"]);
    assert.equal(audit.after.note, "admin.users.list");
    assert.ok("caglaisik" in audit.before && "admin" in audit.after, "JSON anahtarları korunur, araç takılmaz");
    assert.match(String(audit.after.username), /^user_[0-9a-f]{20}$/, "genel 'admin' kullanıcı adı değer olarak değişir");
    const [poll] = await db.$queryRawUnsafe<{ title: string; slug: string }[]>(`SELECT title, slug FROM polls`);
    assert.match(poll!.title, /^user_[0-9a-f]{20} ve user_[0-9a-f]{20} soruyor; iletişim redacted@example\.test$/);
    assert.match(poll!.slug, /^u[0-9a-f]{8}-soruyor-/);
    const [{ n }] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'D'`);
    assert.equal(Number(n), 0, "tetikleyiciler geri açık");
    const again = await sanitize(url, { apply: true });
    assert.deepEqual([again.realUsers - again.retainedRoleHolders, Object.keys(again.rewritten).length], [0, 0], "ikinci çalıştırma değişiklik yapmaz");
  });

  test("kısa görünen ad ve sınırdaki varchar değeri iz bırakmadan arındırılır", async () => {
    const { url, db, pollId } = await fixture("short_bounded");
    const shortId = randomUUID();
    await db.$executeRaw`INSERT INTO users (id, email, email_normalized, username, username_normalized, display_name, password_hash, updated_at)
      VALUES (${shortId}::uuid, 'su.account@gmail.com', 'su.account@gmail.com', 'shortperson', 'shortperson', 'Su', '$argon2id$x', now())`;
    const original = "Su " + "x".repeat(197);
    assert.equal(original.length, 200);
    await db.$executeRaw`UPDATE polls SET title = ${original}, updated_at = now() WHERE id = ${pollId}::uuid`;
    const preview = await sanitize(url, { apply: false });
    assert.ok(preview.ok && !preview.applied, "dry-run must verify even with expanding replacements");
    const applied = await sanitize(url, { apply: true });
    assert.ok(applied.applied && applied.ok);
    const [poll] = await db.$queryRaw<{ title: string }[]>`SELECT title FROM polls WHERE id = ${pollId}::uuid`;
    assert.ok(poll!.title.startsWith("user_"), "short display name should be replaced");
    assert.equal(poll!.title.length, 200, "expanded synthetic identifiers must respect varchar(200)");
    assert.ok(!poll!.title.includes("Su "), "short display name must not remain visible");
  });

  test("demote: gerçek rol sahipleri de arındırılır, rol satırları silinir; test alanlı rol kalır", async () => {
    const { url, db } = await fixture("demote");
    const r = await sanitize(url, { apply: true, roleHolders: "demote" });
    assert.ok(r.applied && r.ok);
    assert.deepEqual([r.retainedRoleHolders, r.demotedRoles], [0, 1]);
    assert.deepEqual(await roles(db), [{ user_id: fake.id, role: "ADMIN" }], "yalnız test hesabının rolü kalır; SUPER_ADMIN yok → bootstrap mümkün");
    const text = (await dump(db)).toLowerCase().replaceAll('"caglaisik":', "") + JSON.stringify(await users(db)).toLowerCase();
    for (const trace of ["sahip.kisi@gmail.com", "sahipkisi", "cagla.isik@gmail.com", third]) assert.ok(!text.includes(trace), `iz kaldı: ${trace}`);
  });
});

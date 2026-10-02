/**
 * KV-12 (#14) ilk SUPER_ADMIN bootstrap'ı (src/modules/rbac/bootstrap.ts). "Hiç SUPER_ADMIN yokken tek bir kez"
 * kuralını DB korumadığı için (user_roles_bootstrap_check her SUPER_ADMIN'e NULL granted_by izni verir)
 * kurallar ve advisory lock burada gerçek PostgreSQL'de sınanır. TEST_DATABASE_URL yoksa DB testleri atlanır.
 *
 * Test DB'si dosyalar arasında sıfırlanmaz; kural global olduğu için her test önce SUPER_ADMIN satırlarını siler.
 * Bu, test dosyalarının sırayla çalışmasına dayanır (package.json `test`: --test-concurrency=1). Dosyalar paralel
 * koşarsa başka dosyanın (ör. rbac.test.ts) yazdığı SUPER_ADMIN satırları hem o dosyayı hem buradaki sonuçları bozar.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import {
  BOOTSTRAP_AUDIT_REASON,
  BOOTSTRAP_LOCK_KEY,
  bootstrapSuperAdmin,
  describeDatabase,
  redactSecrets,
} from "../src/modules/rbac/bootstrap.ts";
import { prismaBackend } from "./support/harness.ts";

describe("bootstrap çıktı yardımcıları", () => {
  const url = "postgresql://kv_user:s3cr%40t-pw@db.internal:6543/kararver_prod?schema=public&sslmode=require";

  test("describeDatabase yalnız host:port/veritabanı verir", () => {
    assert.equal(describeDatabase(url), "db.internal:6543/kararver_prod");
    assert.equal(describeDatabase("postgresql://u:p@localhost/kararver"), "localhost:5432/kararver");
    assert.equal(describeDatabase("bozuk"), "(ayrıştırılamayan DATABASE_URL)");
  });

  test("redactSecrets bağlantı dizesini ve parolayı gizler", () => {
    const out = redactSecrets(`bağlanılamadı: ${url} (parola s3cr@t-pw, ham s3cr%40t-pw)`, url);
    assert.ok(!out.includes("s3cr"), out);
    assert.ok(!out.includes("kv_user"), out);
    assert.ok(out.includes("postgresql://***"), out);
  });
});

const factory = prismaBackend();
const LOCK_TEST_TIMEOUT_MS = 20_000;

describe("admin:bootstrap (PostgreSQL)", { skip: factory ? false : "TEST_DATABASE_URL tanımlı değil" }, () => {
  let prisma: PrismaClient;
  let close: () => Promise<void>;

  before(async () => {
    const backend = await factory!.create();
    prisma = backend.prisma!;
    close = backend.close;
  });
  after(() => close?.());
  beforeEach(async () => {
    await prisma.userRole.deleteMany({ where: { role: "SUPER_ADMIN" } });
  });

  type Seed = { status?: "ACTIVE" | "RESTRICTED" | "SUSPENDED" | "BANNED"; verified?: boolean; deleted?: boolean };

  /** E-posta karışık harfle yazılır; bootstrap'a boşluklu/büyük harfli verilerek auth normalizasyonu sınanır. */
  async function seedUser({ status = "ACTIVE", verified = true, deleted = false }: Seed = {}) {
    const tag = randomUUID().replaceAll("-", "").slice(0, 12);
    const email = `Boot.${tag}@Example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        emailNormalized: email.toLowerCase(),
        username: `boot_${tag}`,
        usernameNormalized: `boot_${tag}`,
        displayName: "Bootstrap Test",
        passwordHash: "not-a-real-hash",
        status,
        emailVerifiedAt: verified ? new Date() : null,
        deletedAt: deleted ? new Date() : null,
      },
      select: { id: true, username: true },
    });
    return { ...user, input: `  ${email.toUpperCase()} ` };
  }

  const superAdmins = () =>
    prisma.userRole.findMany({ where: { role: "SUPER_ADMIN" }, select: { userId: true, grantedById: true } });

  /** audit_logs append-only ve test DB'si sıfırlanmaz; kayıtlar her testin yeni kullanıcısına göre okunur (KV-39). */
  const auditsFor = (userId: string) =>
    prisma.auditLog.findMany({
      where: { targetType: "USER", targetId: userId },
      select: { actorId: true, source: true, action: true, operation: true, reason: true, before: true, after: true, requestId: true },
    });

  for (const [name, seed, reason] of [
    ["doğrulanmamış e-posta", { verified: false }, "EMAIL_NOT_VERIFIED"],
    ["ACTIVE olmayan (SUSPENDED)", { status: "SUSPENDED" }, "USER_NOT_ACTIVE"],
    ["ACTIVE olmayan (RESTRICTED)", { status: "RESTRICTED" }, "USER_NOT_ACTIVE"],
    ["silinmiş", { deleted: true }, "USER_DELETED"],
  ] as const) {
    test(`ret: ${name}`, async () => {
      const u = await seedUser(seed);
      assert.deepEqual(await bootstrapSuperAdmin(prisma, { email: u.input, apply: true }), { kind: "rejected", reason });
      assert.equal(await prisma.userRole.count({ where: { userId: u.id } }), 0);
      assert.deepEqual(await auditsFor(u.id), []);
    });
  }

  test("ret: kullanıcı yok", async () => {
    const result = await bootstrapSuperAdmin(prisma, { email: `yok.${randomUUID()}@example.test`, apply: true });
    assert.deepEqual(result, { kind: "rejected", reason: "USER_NOT_FOUND" });
    assert.equal((await superAdmins()).length, 0);
  });

  test("başarılı atama: SUPER_ADMIN, granted_by_id NULL", async () => {
    const u = await seedUser();
    const result = await bootstrapSuperAdmin(prisma, { email: u.input, apply: true });
    assert.deepEqual(result, { kind: "applied", userId: u.id, username: u.username, previousRole: null });
    assert.deepEqual(await superAdmins(), [{ userId: u.id, grantedById: null }]);
  });

  test("başarılı atama aynı transaction'da tek audit kaydı yazar: CLI, aktör NULL, user.role.assign", async () => {
    const u = await seedUser();
    await bootstrapSuperAdmin(prisma, { email: u.input, apply: true });
    assert.deepEqual(await auditsFor(u.id), [
      {
        actorId: null,
        source: "CLI",
        action: "user.role.assign",
        operation: "grant",
        reason: BOOTSTRAP_AUDIT_REASON,
        before: { role: "USER" },
        after: { role: "SUPER_ADMIN", grantedBy: null },
        requestId: null,
      },
    ]);
  });

  test("ikinci çalıştırma: farklı kullanıcı reddedilir, aynı kullanıcı 'zaten' ve satır değişmez", async () => {
    const first = await seedUser();
    const other = await seedUser();
    assert.equal((await bootstrapSuperAdmin(prisma, { email: first.input, apply: true })).kind, "applied");
    const before = await prisma.userRole.findUniqueOrThrow({ where: { userId: first.id } });

    assert.deepEqual(await bootstrapSuperAdmin(prisma, { email: other.input, apply: true }), {
      kind: "rejected",
      reason: "SUPER_ADMIN_EXISTS",
    });
    assert.equal(await prisma.userRole.count({ where: { userId: other.id } }), 0);

    assert.deepEqual(await bootstrapSuperAdmin(prisma, { email: first.input, apply: true }), {
      kind: "already",
      userId: first.id,
      username: first.username,
    });
    assert.deepEqual(await prisma.userRole.findUniqueOrThrow({ where: { userId: first.id } }), before);
    // Ret ve "zaten" audit yazmaz: ilk atamanın tek kaydı kalır.
    assert.equal((await auditsFor(first.id)).length, 1);
    assert.deepEqual(await auditsFor(other.id), []);
  });

  test("ret: SUPER_ADMIN sahibi silinmiş/banlı olsa da satırı sayılır", async () => {
    const old = await seedUser();
    await bootstrapSuperAdmin(prisma, { email: old.input, apply: true });
    await prisma.user.update({ where: { id: old.id }, data: { status: "BANNED" } });
    const u = await seedUser();
    assert.deepEqual(await bootstrapSuperAdmin(prisma, { email: u.input, apply: true }), {
      kind: "rejected",
      reason: "SUPER_ADMIN_EXISTS",
    });
  });

  test("hedef SUPER_ADMIN ama artık ACTIVE değilse 'zaten' değil ret", async () => {
    const u = await seedUser();
    await bootstrapSuperAdmin(prisma, { email: u.input, apply: true });
    await prisma.user.update({ where: { id: u.id }, data: { status: "SUSPENDED" } });
    assert.deepEqual(await bootstrapSuperAdmin(prisma, { email: u.input, apply: true }), {
      kind: "rejected",
      reason: "USER_NOT_ACTIVE",
    });
  });

  test("dry-run hiçbir satır yazmaz (yeni satır ve yükseltme planı)", async () => {
    const fresh = await seedUser();
    const granter = await seedUser();
    const mod = await seedUser();
    await prisma.userRole.create({ data: { userId: mod.id, role: "MODERATOR", grantedById: granter.id } });
    const snapshot = () => prisma.userRole.findMany({ orderBy: { userId: "asc" } });
    const before = await snapshot();

    assert.deepEqual(await bootstrapSuperAdmin(prisma, { email: fresh.input, apply: false }), {
      kind: "planned",
      userId: fresh.id,
      username: fresh.username,
      previousRole: null,
    });
    assert.deepEqual(await bootstrapSuperAdmin(prisma, { email: mod.input, apply: false }), {
      kind: "planned",
      userId: mod.id,
      username: mod.username,
      previousRole: "MODERATOR",
    });
    assert.deepEqual(await snapshot(), before);
    // READ ONLY transaction: audit de yazılmaz.
    assert.deepEqual([...(await auditsFor(fresh.id)), ...(await auditsFor(mod.id))], []);
  });

  test("MODERATOR SUPER_ADMIN'e yükseltilir, veren NULL olur", async () => {
    const granter = await seedUser();
    const mod = await seedUser();
    await prisma.userRole.create({ data: { userId: mod.id, role: "MODERATOR", grantedById: granter.id } });

    const result = await bootstrapSuperAdmin(prisma, { email: mod.input, apply: true });
    assert.deepEqual(result, { kind: "applied", userId: mod.id, username: mod.username, previousRole: "MODERATOR" });
    assert.deepEqual(await superAdmins(), [{ userId: mod.id, grantedById: null }]);
    assert.deepEqual(
      (await auditsFor(mod.id)).map((a) => [a.operation, a.before, a.after]),
      [["change", { role: "MODERATOR" }, { role: "SUPER_ADMIN", grantedBy: null }]],
    );
  });

  test("eşzamanlı iki bootstrap (farklı kullanıcı): tam olarak biri başarılı", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const results = await Promise.all([
      bootstrapSuperAdmin(prisma, { email: a.input, apply: true }),
      bootstrapSuperAdmin(prisma, { email: b.input, apply: true }),
    ]);
    assert.deepEqual(results.map((r) => r.kind).sort(), ["applied", "rejected"]);
    const rejected = results.find((r) => r.kind === "rejected");
    assert.deepEqual(rejected, { kind: "rejected", reason: "SUPER_ADMIN_EXISTS" });
    assert.equal((await superAdmins()).length, 1);
    assert.equal((await auditsFor(a.id)).length + (await auditsFor(b.id)).length, 1);
  });

  /** Kilit bekleyen bir oturum pg_locks'ta görünene kadar yoklar; zamanlamaya değil DB durumuna bakar. */
  async function waitForLockWaiter(deadline: number): Promise<void> {
    for (;;) {
      const [row] = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND ((classid::bigint << 32) | objid::bigint) = hashtextextended(${BOOTSTRAP_LOCK_KEY}, 0)`;
      if (row!.n > 0) return;
      if (Date.now() > deadline) throw new Error("İkinci bootstrap advisory lock'ta beklerken görülmedi (pg_locks)");
      await new Promise((r) => setImmediate(r));
    }
  }

  function within<T>(promise: Promise<T>, deadline: number, what: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Süre aşıldı: ${what}`)), Math.max(0, deadline - Date.now()));
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  test("advisory lock: kontrolleri geçen ilk işlem kilidi tutarken ikincisi bekler ve sonra reddedilir", { timeout: LOCK_TEST_TIMEOUT_MS }, async () => {
    const deadline = Date.now() + LOCK_TEST_TIMEOUT_MS - 2_000;
    const a = await seedUser();
    const b = await seedUser();

    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let checked!: () => void;
    const aChecked = new Promise<void>((r) => (checked = r));

    // A kontrolleri geçti (SUPER_ADMIN yok gördü), kilidi tutuyor ve henüz yazmadı.
    const first = bootstrapSuperAdmin(prisma, {
      email: a.input,
      apply: true,
      afterChecks: async () => {
        checked();
        await released;
      },
    });
    let second: Promise<unknown> | undefined;
    try {
      await within(aChecked, deadline, "ilk bootstrap kontrolleri bitirmedi");
      second = bootstrapSuperAdmin(prisma, { email: b.input, apply: true });
      // Kilit olmasaydı B burada A'nın commit'ini beklemeden SUPER_ADMIN yok görüp yazardı.
      await waitForLockWaiter(deadline);
    } catch (err) {
      // Açık transaction'lar test bittikten sonra sahipsiz hata üretmesin.
      release();
      await Promise.allSettled([first, second]);
      throw err;
    }
    release();

    const [ra, rb] = await within(Promise.all([first, second]), deadline, "bootstrap'lar tamamlanmadı");
    assert.deepEqual(ra, { kind: "applied", userId: a.id, username: a.username, previousRole: null });
    assert.deepEqual(rb, { kind: "rejected", reason: "SUPER_ADMIN_EXISTS" });
    assert.deepEqual(await superAdmins(), [{ userId: a.id, grantedById: null }]);
  });
});

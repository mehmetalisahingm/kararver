// sanctions.expire — KV-33 PR-C (#35). Süresi dolan yaptırımlardan sonra users.status senkronu (gerçek PostgreSQL).
// Test DB'si dosyalar arasında sıfırlanmaz ve job global çalışır (başka testlerin bıraktığı adaylar da işlenebilir);
// bu yüzden doğrulamalar yalnız bu dosyanın kullanıcıları üzerinden yapılır, global sayılar doğrulanmaz.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Prisma, type PrismaClient } from "@kararver/db";
import { BATCH_SIZE, candidatesSql, expireSanctions, syncUserStatus, type SanctionExpiryDeps } from "../src/jobs/sanctions/job.ts";
import { fixtures, migratedClient, testDatabaseUrl } from "./support/db.ts";

const url = testDatabaseUrl();
const HOUR = 60 * 60 * 1000;
/** Job'ın saati; yaptırımlar buna göre kurulur (ends_at > starts_at CHECK'i ve süre dolumu). */
const T = new Date("2031-03-01T12:00:00.000Z");
const at = (hours: number) => new Date(T.getTime() + hours * HOUR);

type SanctionType = "WARNING" | "RESTRICT_COMMENTS" | "RESTRICT_POSTING" | "SUSPEND" | "BAN";

describe("sanctions.expire (postgres)", { skip: url ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let db: PrismaClient;
  let f: ReturnType<typeof fixtures>;
  let admin: string;

  before(async () => {
    db = migratedClient(url!);
    f = fixtures(db);
    [admin] = await f.users(1);
  });
  after(async () => {
    await db?.$disconnect();
  });

  const deps = (overrides: Partial<SanctionExpiryDeps> = {}): SanctionExpiryDeps => ({ prisma: db, now: () => T, log: () => {}, ...overrides });

  /** Yaptırım: starts/created T-48 saat, bitiş `endsIn` saat sonra (negatif = süresi dolmuş, null = kalıcı). */
  async function sanction(userId: string, type: SanctionType, endsIn: number | null) {
    return db.sanction.create({
      data: { userId, type, reason: "test: yaptırım", startsAt: at(-48), createdAt: at(-48), endsAt: endsIn === null ? null : at(endsIn), createdById: admin! },
      select: { id: true },
    });
  }

  /** Kullanıcı + yaptırımlar + yaptırım uygulandığı andaki durum (süresi henüz dolmamışken yazılmış özet). */
  async function userWith(status: "SUSPENDED" | "RESTRICTED" | "BANNED" | "ACTIVE", ...rows: [SanctionType, number | null][]) {
    const [id] = await f.users(1);
    for (const [type, endsIn] of rows) await sanction(id!, type, endsIn);
    await db.user.update({ where: { id: id! }, data: { status } });
    return id!;
  }

  const status = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
  const audits = (id: string) =>
    db.auditLog.findMany({
      where: { targetType: "USER", targetId: id },
      select: { source: true, actorId: true, action: true, operation: true, reason: true, before: true, after: true, requestId: true, createdAt: true },
    });

  test("süresi dolan SUSPEND → ACTIVE; tek audit (WORKER, aktör NULL, user.status.sync/sync); yaptırım satırı değişmez", async () => {
    const user = await userWith("SUSPENDED", ["SUSPEND", -1]);
    const before = await db.sanction.findFirstOrThrow({ where: { userId: user } });
    await expireSanctions(deps());
    assert.equal(await status(user), "ACTIVE");
    assert.deepEqual(await audits(user), [
      {
        source: "WORKER",
        actorId: null,
        action: "user.status.sync",
        operation: "sync",
        reason: null,
        before: { status: "SUSPENDED" },
        after: { status: "ACTIVE", expiredTypes: ["SUSPEND"] },
        requestId: null,
        createdAt: T,
      },
    ]);
    // Süre dolumu bir kaldırma değildir: satır olduğu gibi kalır.
    assert.deepEqual(await db.sanction.findFirstOrThrow({ where: { userId: user } }), before);
  });

  test("SUSPEND (dolmuş) + RESTRICT (aktif) → RESTRICTED; RESTRICT (dolmuş) → ACTIVE", async () => {
    const both = await userWith("SUSPENDED", ["SUSPEND", -1], ["RESTRICT_COMMENTS", 24]);
    const restricted = await userWith("RESTRICTED", ["RESTRICT_POSTING", -2], ["WARNING", null]);
    await expireSanctions(deps());
    assert.equal(await status(both), "RESTRICTED");
    assert.equal(await status(restricted), "ACTIVE");
    assert.deepEqual((await audits(both)).map((a) => a.after), [{ status: "RESTRICTED", expiredTypes: ["SUSPEND"] }]);
  });

  test("BAN etkilenmez (dolmuş SUSPEND ile birlikte de); süresi dolmamış SUSPEND'e dokunulmaz; sınır: ends_at = now etkisiz", async () => {
    const banned = await userWith("BANNED", ["BAN", null], ["SUSPEND", -1]);
    const running = await userWith("SUSPENDED", ["SUSPEND", 1]);
    const boundary = await userWith("SUSPENDED", ["SUSPEND", 0]);
    await expireSanctions(deps());
    assert.equal(await status(banned), "BANNED");
    assert.equal(await status(running), "SUSPENDED");
    assert.equal(await status(boundary), "ACTIVE", "ends_at = now olan yaptırım aktif sayılmaz (statusFromSanctions ile aynı)");
    assert.deepEqual([...(await audits(banned)), ...(await audits(running))], []);
  });

  test("tekrar çalışma audit yazmaz; iki eşzamanlı çalışma tek audit", async () => {
    const once = await userWith("SUSPENDED", ["SUSPEND", -1]);
    await expireSanctions(deps());
    await expireSanctions(deps());
    assert.equal((await audits(once)).length, 1);

    const raced = await Promise.all(Array.from({ length: 3 }, () => userWith("SUSPENDED", ["SUSPEND", -1])));
    await Promise.all([expireSanctions(deps()), expireSanctions(deps())]);
    for (const id of raced) {
      assert.equal(await status(id), "ACTIVE");
      assert.equal((await audits(id)).length, 1, `tek audit: ${id}`);
    }
  });

  // ─── Yönetici işlemiyle yarış ───────────────────────────────

  /** KV-33 PR-B'nin yaptırım transaction'ını taklit eder: aynı kilit, yeni SUSPEND, durum yazımı. Kilitten sonraki durumu döner. */
  function adminSuspend(userId: string, hold: () => Promise<void> = async () => {}) {
    return db.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
        await hold();
        await tx.sanction.create({ data: { userId, type: "SUSPEND", reason: "test: yeni askı", startsAt: T, createdAt: T, endsAt: at(24), createdById: admin! } });
        await tx.user.update({ where: { id: userId }, data: { status: "SUSPENDED" } });
        return row!.status;
      },
      { timeout: 30_000 },
    );
  }

  /**
   * Bu veritabanında kilit bekleyen bir oturum görünene kadar yoklar (zamanlamaya değil DB durumuna bakar). Satır kilidi
   * bekleyen işlem pg_locks'ta `transactionid` tipindedir ve database kolonu NULL'dır; veritabanı pg_stat_activity'den süzülür.
   */
  async function waitForLockWaiter(): Promise<void> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const [row] = await db.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE NOT l.granted AND a.datname = current_database()`;
      if (row!.n > 0) return;
      if (Date.now() > deadline) throw new Error("kilit bekleyen işlem görülmedi (pg_locks)");
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  function gate() {
    let open!: () => void;
    const opened = new Promise<void>((r) => (open = r));
    let reached!: () => void;
    const arrived = new Promise<void>((r) => (reached = r));
    return { hold: async () => (reached(), opened), arrived, open };
  }

  test("yarış: yönetici önce yeni SUSPEND uygular → job kilitte bekler, sonra değişiklik ve audit yapmaz", async () => {
    const user = await userWith("SUSPENDED", ["SUSPEND", -1]);
    const g = gate();
    const adminTx = adminSuspend(user, g.hold);
    await g.arrived;
    const job = syncUserStatus(deps(), user);
    try {
      await waitForLockWaiter();
    } finally {
      g.open();
    }
    assert.equal(await adminTx, "SUSPENDED");
    assert.equal(await job, false);
    assert.equal(await status(user), "SUSPENDED");
    assert.deepEqual(await audits(user), []);
  });

  test("yarış: job önce ACTIVE yazar → yönetici kilitte bekler, taze durumu (ACTIVE) görür ve SUSPENDED yazar", async () => {
    const user = await userWith("SUSPENDED", ["SUSPEND", -1]);
    const g = gate();
    const job = syncUserStatus(deps({ afterLock: g.hold }), user);
    await g.arrived;
    const adminTx = adminSuspend(user);
    try {
      await waitForLockWaiter();
    } finally {
      g.open();
    }
    assert.equal(await job, true);
    assert.equal(await adminTx, "ACTIVE", "yönetici işlemi job'ın yazdığı durumu görür");
    assert.equal(await status(user), "SUSPENDED");
    assert.deepEqual((await audits(user)).map((a) => [a.before, a.after]), [[{ status: "SUSPENDED" }, { status: "ACTIVE", expiredTypes: ["SUSPEND"] }]]);
  });

  // ─── Toplu iş ve index ──────────────────────────────────────

  test("toplu iş: bir tur en fazla batchSize kullanıcı işler, kalanlar sonraki turlarda", async () => {
    assert.equal(BATCH_SIZE, 500);
    const ids = await Promise.all(Array.from({ length: 3 }, () => userWith("SUSPENDED", ["SUSPEND", -1])));
    const first = await expireSanctions(deps({ batchSize: 2 }));
    assert.equal(first.candidates, 2);
    for (let i = 0; i < 100 && (await expireSanctions(deps({ batchSize: 2 }))).candidates > 0; i++);
    for (const id of ids) assert.equal(await status(id), "ACTIVE");
  });

  test("aday sorgusu users_status_idx ve sanctions_user_id_lifted_at_ends_at_idx kullanır (migration gerekmez)", async () => {
    // Boş/küçük tabloda planner seq scan seçebilir; seq scan transaction içinde kapatılarak index'in kullanılabildiği sınanır.
    const plan = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      const rows = await tx.$queryRaw<{ "QUERY PLAN": string }[]>(Prisma.sql`EXPLAIN ${candidatesSql(T, BATCH_SIZE)}`);
      return rows.map((r) => r["QUERY PLAN"]).join("\n");
    });
    assert.match(plan, /users_status_idx/);
    assert.match(plan, /sanctions_user_id_lifted_at_ends_at_idx/);
  });
});

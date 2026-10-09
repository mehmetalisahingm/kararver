/**
 * KV-39 (#41) audit yazımı (src/modules/audit). Kayıt işlemle aynı transaction'dadır (KV-04 §4.4): işlem geri
 * alınırsa kayıt yoktur, kayıt yazılamazsa işlem de geri alınır. Ortak senaryolar bellek ve PostgreSQL store'unda
 * koşar; gerçek mutation (sanctions) ile birlikte geri alma ve append-only davranışı yalnız PostgreSQL'de sınanır.
 * TEST_DATABASE_URL yoksa PostgreSQL testleri atlanır. audit_logs append-only ve test DB'si sıfırlanmadığı için
 * sorgular her testin yeni hedef/aktör kimliğine göre yapılır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { dbErrorMap } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createPrismaAuditStore } from "../src/modules/audit/prisma-store.ts";
import type { AuditStore, AuditTx, AuditWrite } from "../src/modules/audit/store.ts";
import { writeAudit } from "../src/modules/audit/write.ts";
import { prismaBackend } from "./support/harness.ts";
import { createMemoryAuditStore } from "./support/memory-audit-store.ts";

type Backend = {
  store: AuditStore;
  run<T>(fn: (tx: AuditTx) => Promise<T>): Promise<T>;
  /** API kaydının aktörü; PostgreSQL'de FK için gerçek kullanıcı. */
  actor(): Promise<string>;
};

const T0 = new Date("2026-10-01T09:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function sanctionAudit(actorId: string, targetId: string, overrides: Partial<AuditWrite> = {}): AuditWrite {
  return {
    source: "API",
    actorId,
    action: "user.sanction",
    target: { type: "USER", id: targetId },
    reason: "  Tekrarlayan spam  ",
    before: { status: "ACTIVE" },
    after: { status: "SUSPENDED", sanctionType: "SUSPEND" },
    requestId: "req_audit_test_0001",
    at: T0,
    ...overrides,
  };
}

class Rollback extends Error {}

function scenarios(name: string, setup: () => Promise<Backend>, teardown: () => Promise<void> = async () => {}) {
  describe(`audit yazımı (${name})`, () => {
    let b: Backend;
    before(async () => {
      b = await setup();
    });
    after(teardown);

    test("commit: kayıt normalleştirilmiş yazılır (varsayılan operation, trim'li gerekçe)", async () => {
      const actor = await b.actor();
      const target = randomUUID();
      await b.run((tx) => writeAudit(tx, sanctionAudit(actor, target)));
      const [row, ...rest] = await b.store.list({ targetType: "USER", targetId: target, after: null }, 10);
      assert.deepEqual(rest, []);
      assert.deepEqual(
        // actor (admin.audit.list görünümü) yalnız Prisma store'da dolar; burada yazılan kayıt karşılaştırılır.
        (({ actor: _actor, ...r }) => ({ ...r, id: undefined }))(row!),
        {
          id: undefined,
          source: "API",
          actorId: actor,
          action: "user.sanction",
          operation: "apply",
          target: { type: "USER", id: target },
          reason: "Tekrarlayan spam",
          before: { status: "ACTIVE" },
          after: { status: "SUSPENDED", sanctionType: "SUSPEND" },
          requestId: "req_audit_test_0001",
          createdAt: T0,
        },
      );
    });

    test("transaction geri alınırsa kayıt yok", async () => {
      const actor = await b.actor();
      const target = randomUUID();
      await assert.rejects(
        b.run(async (tx) => {
          await writeAudit(tx, sanctionAudit(actor, target));
          throw new Rollback("işlem sonradan başarısız");
        }),
        Rollback,
      );
      assert.deepEqual(await b.store.list({ targetId: target, after: null }, 10), []);
    });

    test("gerekçesiz, katalog dışı, izinsiz türlü veya hassas alanlı kayıt reddedilir; hiçbiri yazılmaz", async () => {
      const actor = await b.actor();
      const target = randomUUID();
      for (const [bad, message] of [
        [{ reason: null }, /gerekçe ister/],
        [{ reason: "  " }, /gerekçe ister/],
        [{ action: "sanction.applied" as never }, /bilinmeyen işlem/],
        [{ operation: "lift" }, /geçersiz operation/],
        [{ before: { email: "x@example.test" } }, /hassas alan/],
        [{ requestId: null }, /requestId zorunlu/],
      ] as const) {
        await assert.rejects(b.run((tx) => writeAudit(tx, sanctionAudit(actor, target, bad))), message);
      }
      assert.deepEqual(await b.store.list({ targetId: target, after: null }, 10), []);
    });

    test("çok türlü işlem: operation zorunlu, ayrı sorgulanır; keyset sayfalama en yeni önce", async () => {
      const actor = await b.actor();
      const vote = randomUUID();
      const base = { source: "API", actorId: actor, action: "vote.invalidate", target: { type: "VOTE", id: vote }, reason: "Sahte hesap ağı", requestId: "req_audit_test_0002" } as const;
      await assert.rejects(b.run((tx) => writeAudit(tx, { ...base, at: at(0) })), /operation zorunlu/);
      await b.run(async (tx) => {
        await writeAudit(tx, { ...base, operation: "invalidate", after: { invalidated: true }, at: at(1) });
        await writeAudit(tx, { ...base, operation: "restore", after: { invalidated: false }, at: at(2) });
        await writeAudit(tx, { ...base, operation: "invalidate", after: { invalidated: true }, at: at(3) });
      });

      const restores = await b.store.list({ action: "vote.invalidate", operation: "restore", targetId: vote, after: null }, 10);
      assert.deepEqual(restores.map((r) => [r.operation, r.createdAt]), [["restore", at(2)]]);

      const page1 = await b.store.list({ targetId: vote, actorId: actor, after: null }, 2);
      assert.deepEqual(page1.map((r) => r.createdAt), [at(3), at(2)]);
      const last = page1.at(-1)!;
      const page2 = await b.store.list({ targetId: vote, after: { createdAt: last.createdAt, id: last.id } }, 2);
      assert.deepEqual(page2.map((r) => [r.operation, r.createdAt]), [["invalidate", at(1)]]);
      assert.deepEqual(
        (await b.store.list({ targetId: vote, from: at(2), to: at(3), after: null }, 10)).map((r) => r.createdAt),
        [at(2)],
      );
    });

    test("CLI/worker kaydı aktörsüz ve request id'siz; sistem işlemi kaynağıyla sorgulanır", async () => {
      const target = randomUUID();
      await b.run((tx) =>
        writeAudit(tx, { source: "WORKER", actorId: null, action: "user.status.sync", target: { type: "USER", id: target }, after: { status: "ACTIVE" }, at: T0 }),
      );
      const [row] = await b.store.list({ targetId: target, source: "WORKER", after: null }, 10);
      assert.deepEqual([row?.actorId, row?.requestId, row?.operation, row?.reason, row?.before], [null, null, "sync", null, null]);
    });
  });
}

scenarios("bellek", async () => {
  const memory = createMemoryAuditStore();
  return { store: memory, run: (fn) => memory.transaction(fn), actor: async () => randomUUID() };
});

const factory = prismaBackend();
let prisma: PrismaClient | undefined;
let closeBackend: (() => Promise<void>) | undefined;

async function seedUser(db: PrismaClient): Promise<string> {
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const user = await db.user.create({
    data: {
      email: `audit.${tag}@example.test`,
      emailNormalized: `audit.${tag}@example.test`,
      username: `audit_${tag}`,
      usernameNormalized: `audit_${tag}`,
      displayName: "Audit Test",
      passwordHash: "not-a-real-hash",
    },
    select: { id: true },
  });
  return user.id;
}

async function connect(): Promise<PrismaClient> {
  if (!prisma) {
    const backend = await factory!.create();
    prisma = backend.prisma!;
    closeBackend = backend.close;
  }
  return prisma;
}

if (factory) {
  scenarios(
    "PostgreSQL",
    async () => {
      const db = await connect();
      return { store: createPrismaAuditStore(db), run: (fn) => db.$transaction(fn), actor: () => seedUser(db) };
    },
  );
}

describe("audit ve mutation aynı transaction'da (PostgreSQL)", { skip: factory ? false : "TEST_DATABASE_URL tanımlı değil" }, () => {
  let db: PrismaClient;
  before(async () => {
    db = await connect();
  });
  after(() => closeBackend?.());

  async function suspend(tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0], admin: string, user: string, reason: string | null) {
    const sanction = await tx.sanction.create({
      // Zamanlar testin sabit saatine bağlı (starts_at varsayılanı now() olursa ends_at takvime göre geçmişte kalabilir).
      data: { userId: user, type: "SUSPEND", reason: "Tekrarlayan spam", startsAt: T0, endsAt: at(60 * 24), createdById: admin },
      select: { id: true },
    });
    await writeAudit(tx, {
      source: "API",
      actorId: admin,
      action: "user.sanction",
      target: { type: "USER", id: user },
      reason,
      before: { status: "ACTIVE" },
      after: { status: "SUSPENDED", sanctionId: sanction.id },
      requestId: "req_audit_test_0003",
      at: T0,
    });
    return sanction.id;
  }

  const counts = async (user: string) => ({
    sanctions: await db.sanction.count({ where: { userId: user } }),
    audits: await db.auditLog.count({ where: { targetType: "USER", targetId: user } }),
  });

  test("commit: yaptırım ve audit kaydı birlikte; özetteki sanctionId gerçek satır", async () => {
    const [admin, user] = [await seedUser(db), await seedUser(db)];
    const id = await db.$transaction((tx) => suspend(tx, admin, user, "Tekrarlayan spam"));
    assert.deepEqual(await counts(user), { sanctions: 1, audits: 1 });
    const row = await db.auditLog.findFirstOrThrow({ where: { targetId: user }, select: { after: true } });
    assert.deepEqual(row.after, { status: "SUSPENDED", sanctionId: id });
  });

  test("mutation geri alınırsa audit de yok", async () => {
    const [admin, user] = [await seedUser(db), await seedUser(db)];
    await assert.rejects(
      db.$transaction(async (tx) => {
        await suspend(tx, admin, user, "Tekrarlayan spam");
        // Ör. oturum iptali veya users.status güncellemesi sonradan patladı.
        throw new Rollback("sonraki adım başarısız");
      }),
      Rollback,
    );
    assert.deepEqual(await counts(user), { sanctions: 0, audits: 0 });
  });

  test("audit yazılamazsa (gerekçesiz) mutation da geri alınır", async () => {
    const [admin, user] = [await seedUser(db), await seedUser(db)];
    await assert.rejects(db.$transaction((tx) => suspend(tx, admin, user, null)), /user.sanction gerekçe ister/);
    assert.deepEqual(await counts(user), { sanctions: 0, audits: 0 });
  });

  test("boş özet SQL NULL yazılır (JSON null değil)", async () => {
    const admin = await seedUser(db);
    const poll = randomUUID();
    await db.$transaction((tx) =>
      writeAudit(tx, { source: "API", actorId: admin, action: "revision.read", target: { type: "POLL", id: poll }, requestId: "req_audit_test_0004" }),
    );
    const [row] = await db.$queryRaw<{ before: boolean; after: boolean }[]>`
      SELECT before IS NULL AS before, after IS NULL AS after FROM audit_logs WHERE target_id = ${poll}`;
    assert.deepEqual(row, { before: true, after: true });
  });

  test("uygulama istemcisi de kaydı değiştiremez/silemez; hata kodu sözleşmede INTERNAL_ERROR", async () => {
    const admin = await seedUser(db);
    const target = randomUUID();
    await db.$transaction((tx) => writeAudit(tx, sanctionAudit(admin, target)));
    const { id } = await db.auditLog.findFirstOrThrow({ where: { targetId: target }, select: { id: true } });
    await assert.rejects(db.auditLog.update({ where: { id }, data: { reason: "Değiştirildi" } }), /KV_AUDIT_LOGS_APPEND_ONLY/);
    await assert.rejects(db.auditLog.delete({ where: { id } }), /KV_AUDIT_LOGS_APPEND_ONLY/);
    await assert.rejects(db.auditLog.deleteMany({ where: { targetId: target } }), /KV_AUDIT_LOGS_APPEND_ONLY/);
    assert.equal(dbErrorMap.KV_AUDIT_LOGS_APPEND_ONLY, "INTERNAL_ERROR");
  });
});

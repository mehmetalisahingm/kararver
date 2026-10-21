// moderation.bulk-approvals.expire — #183 (gerçek PostgreSQL). İş global çalışır; doğrulamalar yalnız bu dosyanın kayıtları üzerinden yapılır.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { expireBulkApproval, expireBulkApprovals } from "../src/jobs/moderation/expire-approvals.ts";
import { fixtures, migratedClient, testDatabaseUrl } from "./support/db.ts";

const url = testDatabaseUrl();
const T = new Date("2031-06-01T12:00:00.000Z");
const MIN = 60_000;

describe("moderation.bulk-approvals.expire (postgres)", { skip: url ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let db: PrismaClient;
  let f: ReturnType<typeof fixtures>;
  let initiator: string;
  let approver: string;

  before(async () => {
    db = migratedClient(url!);
    f = fixtures(db);
    [initiator, approver] = (await f.users(2)) as [string, string];
  });
  after(async () => {
    await db?.$disconnect();
  });

  const ids = () => Array.from({ length: 20 }, () => crypto.randomUUID());
  async function open(expiresAt: Date) {
    const row = await db.moderationBulkApproval.create({
      data: {
        kind: "POLLS",
        action: "HIDE",
        reason: "Spam dalgası temizliği",
        digest: "a".repeat(64),
        ids: ids(),
        willChange: 20,
        needsAdmin: false,
        initiatorId: initiator,
        createdAt: new Date(expiresAt.getTime() - 30 * MIN),
        expiresAt,
      },
      select: { id: true },
    });
    return row.id;
  }
  const get = (id: string) => db.moderationBulkApproval.findUniqueOrThrow({ where: { id } });
  const auditOf = (id: string) => db.auditLog.findMany({ where: { targetType: "BULK_APPROVAL", targetId: id } });

  test("süresi geçen bekleyen talep kalıcı EXPIRED olur ve sistem audit'i yazılır; süresi dolmamış ve sonlanmış talebe dokunulmaz", async () => {
    const stale = await open(new Date(T.getTime() - MIN));
    const live = await open(new Date(T.getTime() + 10 * MIN));
    const rejected = await open(new Date(T.getTime() - MIN));
    await db.moderationBulkApproval.update({ where: { id: rejected }, data: { status: "REJECTED", decidedById: approver, decidedAt: new Date(T.getTime() - 5 * MIN), decisionReason: "Kapsam fazla geniş" } });

    const result = await expireBulkApprovals({ prisma: db, now: () => T });
    assert.ok(result.expired >= 1);
    assert.equal(result.failed, 0);

    const s = await get(stale);
    assert.equal(s.status, "EXPIRED");
    assert.deepEqual(s.decidedAt, T);
    assert.equal(s.decidedById, null);
    assert.equal(s.decisionReason, null);
    assert.equal(s.batchId, null);
    const audit = await auditOf(stale);
    assert.equal(audit.length, 1);
    assert.deepEqual([audit[0]!.action, audit[0]!.operation, audit[0]!.source, audit[0]!.actorId], ["moderation.bulk.expire", "expire", "WORKER", null]);

    assert.equal((await get(live)).status, "PENDING");
    assert.equal((await auditOf(live)).length, 0);
    assert.equal((await get(rejected)).status, "REJECTED", "karar verilmiş talep EXPIRED'a çevrilmez");
    assert.equal((await auditOf(rejected)).length, 0);
  });

  test("tekrar çalıştırma ve eşzamanlı iki worker: talep bir kez sonlanır, tek audit kaydı", async () => {
    const id = await open(new Date(T.getTime() - MIN));
    const [a, b] = await Promise.all([expireBulkApproval({ prisma: db, now: () => T }, id), expireBulkApproval({ prisma: db, now: () => T }, id)]);
    assert.deepEqual([a, b].sort(), [false, true]);
    assert.equal(await expireBulkApproval({ prisma: db, now: () => T }, id), false);
    assert.equal((await auditOf(id)).length, 1);
  });

  test("onay ile yarış: onaylanmış talep EXPIRED yapılmaz (koşullu kilit); veritabanı süresi dolan talepte karar alanlarını tutarlı tutar", async () => {
    const id = await open(new Date(T.getTime() - MIN));
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM moderation_bulk_approvals WHERE id = ${id}::uuid FOR UPDATE`;
      await tx.moderationBulkApproval.update({ where: { id }, data: { status: "CANCELED", decidedById: initiator, decidedAt: new Date(T.getTime() - 30_000), decisionReason: "Vazgeçtim" } });
    });
    assert.equal(await expireBulkApproval({ prisma: db, now: () => T }, id), false);
    assert.equal((await get(id)).status, "CANCELED");
    // EXPIRED'da karar veren veya gerekçe yazılamaz (CHECK).
    const other = await open(new Date(T.getTime() - MIN));
    await assert.rejects(db.moderationBulkApproval.update({ where: { id: other }, data: { status: "EXPIRED", decidedAt: T, decidedById: approver } }));
    await assert.rejects(db.moderationBulkApproval.update({ where: { id: other }, data: { status: "EXPIRED", decidedAt: T, decisionReason: "Süre doldu" } }));
  });
});

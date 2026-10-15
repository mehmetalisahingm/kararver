// email-change.expire — #181 (gerçek PostgreSQL). İş global çalışır; doğrulamalar yalnız bu dosyanın kayıtları üzerinden yapılır.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { expireEmailChanges } from "../src/jobs/email-change/expire.ts";
import { fixtures, migratedClient, testDatabaseUrl } from "./support/db.ts";

const url = testDatabaseUrl();
const T = new Date("2031-05-01T12:00:00.000Z");

describe("email-change.expire (postgres)", { skip: url ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let db: PrismaClient;
  let f: ReturnType<typeof fixtures>;

  before(async () => {
    db = migratedClient(url!);
    f = fixtures(db);
  });
  after(async () => {
    await db?.$disconnect();
  });

  async function open(expiresAt: Date) {
    const [userId] = await f.users(1);
    const email = `yeni_${randomUUID().slice(0, 8)}@example.test`;
    const row = await db.emailChangeRequest.create({
      data: {
        userId: userId!,
        origin: "USER",
        requestedById: userId!,
        newEmail: email,
        newEmailNormalized: email,
        newTokenHash: randomUUID().replaceAll("-", "").padEnd(64, "a"),
        oldTokenHash: randomUUID().replaceAll("-", "").padEnd(64, "b"),
        requiresOld: true,
        expiresAt,
      },
      select: { id: true },
    });
    return row.id;
  }
  const get = (id: string) => db.emailChangeRequest.findUniqueOrThrow({ where: { id } });

  test("süresi geçen açık talep EXPIRED olur ve yeni adres silinir; süresi dolmamış ve sonlanmış talebe dokunulmaz", async () => {
    const stale = await open(new Date(T.getTime() - 1000));
    const live = await open(new Date(T.getTime() + 3600_000));
    const done = await open(new Date(T.getTime() - 1000));
    await db.emailChangeRequest.update({ where: { id: done }, data: { status: "CANCELLED", newEmail: null, newEmailNormalized: null, finishedAt: new Date(T.getTime() - 5000), failure: "replaced" } });

    const result = await expireEmailChanges({ prisma: db, now: () => T });
    assert.ok(result.expired >= 1);
    const s = await get(stale);
    assert.equal(s.status, "EXPIRED");
    assert.equal(s.newEmail, null);
    assert.equal(s.newEmailNormalized, null);
    assert.deepEqual(s.finishedAt, T);
    const l = await get(live);
    assert.equal(l.status, "OPEN");
    assert.notEqual(l.newEmail, null);
    const d = await get(done);
    assert.equal(d.status, "CANCELLED");
    assert.equal(d.failure, "replaced");
  });

  test("idempotent: ikinci tur aynı kayıtlara dokunmaz", async () => {
    const stale = await open(new Date(T.getTime() - 1000));
    await expireEmailChanges({ prisma: db, now: () => T });
    const first = await get(stale);
    await expireEmailChanges({ prisma: db, now: () => new Date(T.getTime() + 60_000) });
    const second = await get(stale);
    assert.deepEqual(second.finishedAt, first.finishedAt);
    assert.equal(second.status, "EXPIRED");
  });
});

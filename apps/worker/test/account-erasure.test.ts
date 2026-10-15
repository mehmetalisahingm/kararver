// account-erasure.cleanup — #181 (gerçek PostgreSQL). Test DB'si dosyalar arasında sıfırlanmaz ve iş global çalışır;
// doğrulamalar yalnız bu dosyanın kullanıcıları üzerinden yapılır.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { BATCH_SIZE, cleanupAccountErasures, type AccountErasureDeps } from "../src/jobs/account-erasure/cleanup.ts";
import { fixtures, migratedClient, testDatabaseUrl } from "./support/db.ts";

const url = testDatabaseUrl();
const T = new Date("2031-04-01T12:00:00.000Z");

describe("account-erasure.cleanup (postgres)", { skip: url ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let db: PrismaClient;
  let f: ReturnType<typeof fixtures>;
  let sequence = 0;

  before(async () => {
    db = migratedClient(url!);
    f = fixtures(db);
  });
  after(async () => {
    await db?.$disconnect();
  });

  async function erased(avatars: number) {
    const [userId, admin] = await f.users(2);
    const assets: { id: string; original: string; processed: string }[] = [];
    for (let i = 0; i < avatars; i++) {
      const id = randomUUID();
      const original = `orig/${id}`;
      const processed = `proc/${id}`;
      await db.mediaAsset.create({
        data: { id, uploaderId: userId!, purpose: "AVATAR", status: "REJECTED", originalObjectKey: original, processedObjectKey: processed },
      });
      assets.push({ id, original, processed });
    }
    // Product policy includes poll images uploaded by the erased account.
    const pollImage = randomUUID();
    await db.mediaAsset.create({ data: { id: pollImage, uploaderId: userId!, purpose: "POLL", status: "REJECTED", originalObjectKey: `orig/${pollImage}` } });
    const record = await db.accountErasure.create({ data: { userId: userId!, requestedById: admin!, reason: "test: anonimleştirme", summary: {}, createdAt: new Date(T.getTime()-60_000+sequence++) }, select: { id: true } });
    return { userId: userId!, recordId: record.id, assets, pollImage };
  }

  function recorder(overrides: Partial<AccountErasureDeps["storage"]> = {}) {
    let now = T;
    const calls = { public: [] as string[], private: [] as string[] };
    const deps: AccountErasureDeps = {
      prisma: db,
      now: () => now,
      log: () => {},
      storage: {
        deletePublic: async (key) => void calls.public.push(key),
        deletePrivate: async (key) => void calls.private.push(key),
        ...overrides,
      },
    };
    return { calls, deps, advance: (ms: number) => { now = new Date(now.getTime()+ms); } };
  }

  const cleanedAt = async (id: string) => (await db.accountErasure.findUniqueOrThrow({ where: { id }, select: { storageCleanedAt: true } })).storageCleanedAt;

  // The API suite leaves a real backlog. A single batch does not promise to reach this test's newest record.
  async function drain(deps: AccountErasureDeps, ids: string[]) {
    const pending = await db.accountErasure.count({ where: { storageCleanedAt: null } });
    const total = { cleaned: 0, failed: 0 };
    for (let i=0; i<Math.ceil(pending/BATCH_SIZE)+2; i++) {
      const result = await cleanupAccountErasures(deps);
      total.cleaned+=result.cleaned; total.failed+=result.failed;
      if ((await Promise.all(ids.map(cleanedAt))).every(Boolean)) break;
      if (result.cleaned+result.failed===0) break;
    }
    return total;
  }

  test("avatar ve anket görsellerinin tüm kopyaları silinir; başka hesabın görseli korunur", async () => {
    const e = await erased(2);
    const { calls, deps } = recorder();
    const [other] = await f.users(1);
    const untouched = await db.mediaAsset.create({ data: { uploaderId: other!, purpose: "POLL", originalObjectKey: `other/${randomUUID()}` } });
    await drain(deps,[e.recordId]);
    for (const a of e.assets) {
      assert.ok(calls.public.includes(`m/${a.id}.webp`), "public kopya silinir");
      assert.ok(calls.private.includes(a.original) && calls.private.includes(a.processed), "özel kopyalar silinir");
    }
    assert.ok(calls.private.includes(`orig/${e.pollImage}`) && calls.public.includes(`m/${e.pollImage}.webp`), "anket görseli de silinir");
    assert.ok(!calls.private.includes(untouched.originalObjectKey), "başkasının görseline dokunulmaz");
    assert.deepEqual(await cleanedAt(e.recordId), T);
  });

  test("idempotent: işaretli kayıt tekrar işlenmez", async () => {
    const e = await erased(1);
    await drain(recorder().deps,[e.recordId]);
    const second = recorder();
    await cleanupAccountErasures(second.deps);
    assert.ok(!second.calls.public.includes(`m/${e.assets[0]!.id}.webp`), "ikinci turda nesneye dokunulmaz");
  });

  test("depo hatasında kayıt işaretlenmez ve sonraki turda yeniden denenir; hata diğer hesapları durdurmaz", async () => {
    const bad = await erased(1);
    const ok = await erased(1);
    const failing = recorder({
      deletePrivate: async (key) => {
        if (key === bad.assets[0]!.original) throw new Error("depo erişilemiyor");
      },
    });
    const first = await drain(failing.deps,[ok.recordId]);
    assert.ok(first.failed >= 1);
    assert.equal(await cleanedAt(bad.recordId), null, "silinemeyen kayıt bekler");
    assert.deepEqual(await cleanedAt(ok.recordId), T, "diğer hesap işlendi");

    const retry = recorder();
    await cleanupAccountErasures(retry.deps);
    assert.equal(await cleanedAt(bad.recordId), null, "gecikme dolmadan tekrar denenmez");
    retry.advance(60_001);
    await drain(retry.deps,[bad.recordId]);
    assert.deepEqual(await cleanedAt(bad.recordId), new Date(T.getTime()+60_001));
    assert.ok(retry.calls.private.includes(bad.assets[0]!.original));
  });

  test("avatarı olmayan hesap da işaretlenir (silinecek nesne yok)", async () => {
    const e = await erased(0);
    await drain(recorder().deps,[e.recordId]);
    assert.deepEqual(await cleanedAt(e.recordId), T);
  });

  test("a full failed batch cannot starve a later healthy record", async () => {
    const bad = await Promise.all(Array.from({ length: BATCH_SIZE },()=>erased(1)));
    const blockedKeys = new Set(bad.map(row=>row.assets[0]!.original));
    const healthy = await erased(1);
    const r = recorder({ deletePrivate: async key => { if (blockedKeys.has(key)) throw new Error("unavailable"); } });
    await drain(r.deps,[healthy.recordId]);
    assert.ok(await cleanedAt(healthy.recordId));
    for (const row of bad) {
      assert.equal(await cleanedAt(row.recordId),null);
      assert.ok((await db.accountErasure.findUniqueOrThrow({where:{id:row.recordId}})).storageNextAttemptAt! > T);
    }
  });
});

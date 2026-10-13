// account-erasure.cleanup — #181 (gerçek PostgreSQL). Test DB'si dosyalar arasında sıfırlanmaz ve iş global çalışır;
// doğrulamalar yalnız bu dosyanın kullanıcıları üzerinden yapılır.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { cleanupAccountErasures, type AccountErasureDeps } from "../src/jobs/account-erasure/cleanup.ts";
import { fixtures, migratedClient, testDatabaseUrl } from "./support/db.ts";

const url = testDatabaseUrl();
const T = new Date("2031-04-01T12:00:00.000Z");

describe("account-erasure.cleanup (postgres)", { skip: url ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let db: PrismaClient;
  let f: ReturnType<typeof fixtures>;

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
    // Başka amaçlı görsel (anket görseli) içeriktir: silinmemeli.
    const pollImage = randomUUID();
    await db.mediaAsset.create({ data: { id: pollImage, uploaderId: userId!, purpose: "POLL", status: "REJECTED", originalObjectKey: `orig/${pollImage}` } });
    const record = await db.accountErasure.create({ data: { userId: userId!, requestedById: admin!, reason: "test: anonimleştirme", summary: {} }, select: { id: true } });
    return { userId: userId!, recordId: record.id, assets, pollImage };
  }

  function recorder(overrides: Partial<AccountErasureDeps["storage"]> = {}) {
    const calls = { public: [] as string[], private: [] as string[] };
    const deps: AccountErasureDeps = {
      prisma: db,
      now: () => T,
      log: () => {},
      storage: {
        deletePublic: async (key) => void calls.public.push(key),
        deletePrivate: async (key) => void calls.private.push(key),
        ...overrides,
      },
    };
    return { calls, deps };
  }

  const cleanedAt = async (id: string) => (await db.accountErasure.findUniqueOrThrow({ where: { id }, select: { storageCleanedAt: true } })).storageCleanedAt;

  test("avatar nesneleri (public, işlenmiş, orijinal) silinir, kayıt işaretlenir; anket görseli korunur", async () => {
    const e = await erased(2);
    const { calls, deps } = recorder();
    await cleanupAccountErasures(deps);
    for (const a of e.assets) {
      assert.ok(calls.public.includes(`m/${a.id}.webp`), "public kopya silinir");
      assert.ok(calls.private.includes(a.original) && calls.private.includes(a.processed), "özel kopyalar silinir");
    }
    assert.ok(!calls.private.includes(`orig/${e.pollImage}`) && !calls.public.includes(`m/${e.pollImage}.webp`), "anket görseli içeriktir, silinmez");
    assert.deepEqual(await cleanedAt(e.recordId), T);
  });

  test("idempotent: işaretli kayıt tekrar işlenmez", async () => {
    const e = await erased(1);
    await cleanupAccountErasures(recorder().deps);
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
    const first = await cleanupAccountErasures(failing.deps);
    assert.ok(first.failed >= 1);
    assert.equal(await cleanedAt(bad.recordId), null, "silinemeyen kayıt bekler");
    assert.deepEqual(await cleanedAt(ok.recordId), T, "diğer hesap işlendi");

    const retry = recorder();
    await cleanupAccountErasures(retry.deps);
    assert.deepEqual(await cleanedAt(bad.recordId), T);
    assert.ok(retry.calls.private.includes(bad.assets[0]!.original));
  });

  test("avatarı olmayan hesap da işaretlenir (silinecek nesne yok)", async () => {
    const e = await erased(0);
    await cleanupAccountErasures(recorder().deps);
    assert.deepEqual(await cleanedAt(e.recordId), T);
  });
});

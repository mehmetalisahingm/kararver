// spam-score.refresh, gölge mod — #183 / KV-37 S1 (gerçek PostgreSQL). İş global çalışır; doğrulamalar yalnız bu dosyanın kayıtları üzerinden yapılır.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { collectSignals, refreshSpamScores } from "../src/jobs/spam-score/job.ts";
import { scoreSpam, SPAM_MIN_STORED_SCORE } from "../src/jobs/spam-score/score.ts";
import { fixtures, migratedClient, testDatabaseUrl } from "./support/db.ts";

const NOW = new Date("2031-07-01T12:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const none = { duplicatePosts: 0, comments24h: 0, youngBurst: 0 as const, actionedReports: 0, hiddenContent: 0 };

describe("spam puanı (saf kurallar)", () => {
  test("sinyal yoksa 0; ağırlıklı toplam; 100'de sınırlı; negatif/NaN sayılmaz", () => {
    assert.equal(scoreSpam(none), 0);
    assert.equal(scoreSpam({ ...none, duplicatePosts: 2 }), 30);
    assert.equal(scoreSpam({ ...none, comments24h: 10 }), 0, "ilk 10 yorum serbest");
    assert.equal(scoreSpam({ ...none, comments24h: 16 }), 12);
    assert.equal(scoreSpam({ ...none, youngBurst: 1, actionedReports: 1, hiddenContent: 1 }), 55);
    assert.equal(scoreSpam({ duplicatePosts: 50, comments24h: 500, youngBurst: 1, actionedReports: 9, hiddenContent: 9 }), 100);
    assert.equal(scoreSpam({ ...none, duplicatePosts: -5, comments24h: Number.NaN }), 0);
  });
});

describe("spam-score.refresh (postgres)", { skip: testDatabaseUrl() ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let db: PrismaClient;
  let f: ReturnType<typeof fixtures>;
  let categoryId: string;
  let actor: string;
  const log = () => {};
  const run = (enabled: boolean, at = NOW) => refreshSpamScores({ prisma: db, now: () => at, log, enabled: async () => enabled });
  const rowOf = (userId: string) => db.spamAccountScore.findUnique({ where: { userId } });

  before(async () => {
    db = migratedClient(testDatabaseUrl()!);
    f = fixtures(db);
    categoryId = await f.category();
    [actor] = await f.users(1);
  });
  after(async () => {
    await db?.$disconnect();
  });

  const oldUser = async () => {
    const [id] = await f.users(1);
    await db.user.update({ where: { id: id! }, data: { createdAt: new Date(NOW.getTime() - 200 * DAY) } });
    return id!;
  };
  const post = (authorId: string, title: string, createdAt = new Date(NOW.getTime() - DAY)) =>
    db.poll.create({
      data: { id: randomUUID(), publicId: randomUUID().replaceAll("-", "").slice(0, 12), slug: `s-${randomUUID().slice(0, 8)}`, authorId, categoryId, title, opensAt: createdAt, createdAt, closesAt: new Date(NOW.getTime() + 30 * DAY) },
      select: { id: true },
    });

  test("aynı başlıklı gönderiler (büyük/küçük harf ve boşluk yok sayılır) tekrar sinyali olur; eşik üstü saklanır, sinyaller yalnız sayaçtır", async () => {
    const user = await oldUser();
    await post(user, "Hangi telefon?");
    await post(user, "  hangi TELEFON?  ");
    await post(user, "Hangi telefon?");
    const result = await run(true);
    assert.equal(result.enabled, true);
    const row = await rowOf(user);
    assert.equal(row?.score, 30);
    assert.deepEqual(row?.signals, { duplicatePosts: 2, comments24h: 0, youngBurst: 0, actionedReports: 0, hiddenContent: 0 });
    assert.deepEqual(row?.computedAt, NOW);
    assert.deepEqual(Object.keys(row!.signals as object).sort(), ["actionedReports", "comments24h", "duplicatePosts", "hiddenContent", "youngBurst"]);
  });

  test("eşik altındaki hesap saklanmaz; pencere dışı gönderi sayılmaz", async () => {
    const user = await oldUser();
    await post(user, "Tek gönderi");
    await post(user, "Eski", new Date(NOW.getTime() - 40 * DAY));
    await post(user, "Eski", new Date(NOW.getTime() - 41 * DAY));
    assert.ok(SPAM_MIN_STORED_SCORE > 0);
    await run(true);
    assert.equal(await rowOf(user), null);
  });

  test("geri alınmamış HIDE sayılır, geri alınan sayılmaz", async () => {
    const hidden = await oldUser();
    const undone = await oldUser();
    const a = await post(hidden, "Gizlenen");
    const b = await post(undone, "Önce gizlendi sonra geri açıldı");
    await db.moderationAction.create({ data: { actorId: actor!, action: "HIDE", pollId: a.id, reason: "Spam", createdAt: new Date(NOW.getTime() - DAY) } });
    const hide = await db.moderationAction.create({ data: { actorId: actor!, action: "HIDE", pollId: b.id, reason: "Spam", createdAt: new Date(NOW.getTime() - DAY) } });
    await db.moderationAction.create({ data: { actorId: actor!, action: "RESTORE", pollId: b.id, reason: "Yanlış pozitif", undoOfId: hide.id, createdAt: new Date(NOW.getTime() - DAY / 2) } });
    await run(true);
    assert.equal((await rowOf(hidden))?.score, 15);
    assert.equal(await rowOf(undone), null);
  });

  test("yeni hesap + 10 içerik 'youngBurst' olur; yorum patlaması son 24 saatle sınırlıdır", async () => {
    const [young] = await f.users(1);
    await db.user.update({ where: { id: young! }, data: { createdAt: new Date(NOW.getTime() - 2 * DAY) } });
    const p = await post(young!, "Yeni hesap gönderisi");
    await f.comments(p.id, young!, 9, (i) => new Date(NOW.getTime() - 60_000 * (i + 1)));
    const signals = (await collectSignals(db, NOW)).find((s) => s.userId === young);
    assert.deepEqual(signals?.signals, { duplicatePosts: 0, comments24h: 9, youngBurst: 1, actionedReports: 0, hiddenContent: 0 });
  });

  test("silinmiş hesap puanlanmaz ve mevcut satırı bu turda silinir; puanı düşen hesabın satırı silinir", async () => {
    const user = await oldUser();
    await post(user, "Aynı");
    await post(user, "Aynı");
    await run(true);
    assert.ok(await rowOf(user));
    await db.user.update({ where: { id: user }, data: { deletedAt: new Date(NOW.getTime() - 1000) } });
    const result = await run(true);
    assert.equal(await rowOf(user), null, "silinmiş hesabın satırı aynı turda silinir");
    assert.ok(result.removed >= 1);
    // Puanı düşen hesap: sonraki turda yenilenmediği için satırı silinir.
    const dropped = await oldUser();
    await post(dropped, "Düşecek");
    const twin = await post(dropped, "Düşecek");
    await run(true);
    assert.ok(await rowOf(dropped));
    await db.poll.update({ where: { id: twin.id }, data: { title: "Artık farklı" } });
    await run(true, new Date(NOW.getTime() + 15 * 60_000));
    assert.equal(await rowOf(dropped), null);
  });

  test("bayrak kapalıyken hiçbir şey hesaplanmaz ve saklanan satırlar silinir", async () => {
    const user = await oldUser();
    await post(user, "Kapalı");
    await post(user, "Kapalı");
    await run(true);
    assert.ok(await rowOf(user));
    const result = await run(false);
    assert.equal(result.enabled, false);
    assert.equal(result.stored, 0);
    assert.equal(await rowOf(user), null);
    assert.equal(await db.spamAccountScore.count(), 0);
  });

  test("tekrar çalıştırma aynı sonucu verir (idempotent) ve kullanıcı satırı silinirse puan da silinir (CASCADE)", async () => {
    const user = await oldUser();
    await post(user, "İdempotent");
    await post(user, "İdempotent");
    await run(true);
    const first = await rowOf(user);
    await run(true);
    assert.deepEqual(await rowOf(user), first);
    // Kullanıcı satırı FK'lerle bağlı olduğu için doğrudan silinemez; puan tablosu için CASCADE'i ayrıca doğrularız.
    const [lone] = await f.users(1);
    await db.spamAccountScore.create({ data: { userId: lone!, score: 50, signals: none, computedAt: NOW } });
    await db.user.delete({ where: { id: lone! } });
    assert.equal(await rowOf(lone!), null);
  });
});

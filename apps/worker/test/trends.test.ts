/**
 * KV-28 (#30) trends.refresh, gerçek PostgreSQL ile (TEST_DATABASE_URL). Formüller: docs/KV-28_TRENDS.md.
 * Trend hesabı bütün veritabanına bakar. Her test, rastgele seçilmiş uzak bir gelecekteki pencereye kendi
 * fixture'ını kurar; diğer test verileri (bugünün tarihleri) pencereye girmez.
 */
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { COMPUTED_FORMATS, slotEnd, TREND_CONFIG, type ComputedFormat } from "../src/jobs/trends/config.ts";
import { pruneRuns, refreshFormat, refreshTrends, type TrendJobDeps } from "../src/jobs/trends/job.ts";
import { fixtures, migratedClient, testDatabaseUrl } from "./support/db.ts";

const url = testDatabaseUrl();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("trends.refresh (postgres)", { skip: url ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let db: PrismaClient;
  let f: ReturnType<typeof fixtures>;
  let categoryId: string;

  /** 5 dakikaya hizalı, rastgele ve uzak bir pencere sonu (2031 ile ~3900 arası). */
  const freshEnd = () => slotEnd(new Date(Date.UTC(2031, 0, 1) + randomInt(0, 50_000) * 14 * DAY));
  const deps = (now: Date): TrendJobDeps => ({ prisma: db, now: () => now, log: () => {} });

  async function ranking(format: ComputedFormat, windowEnd: Date) {
    const run = await db.trendRun.findFirst({
      where: { format, windowEnd, status: "SUCCEEDED" },
      select: { id: true, calculationVersion: true, windowStart: true, scores: { orderBy: { rank: "asc" }, select: { pollId: true, rank: true, score: true, components: true } } },
    });
    assert.ok(run, `${format} için başarılı çalıştırma yok`);
    return run;
  }
  const order = async (format: ComputedFormat, windowEnd: Date, names: Record<string, string>) =>
    (await ranking(format, windowEnd)).scores.map((s) => names[s.pollId] ?? "?");

  before(() => {
    db = migratedClient(url!);
    f = fixtures(db);
  });
  before(async () => {
    categoryId = await f.category();
  });
  after(async () => {
    await db?.$disconnect();
  });

  test("dört format ayrı ve beklenen sıralamayı verir; hesap sürümü ve pencere yazılır", async () => {
    const E = freshEnd();
    const at = (ms: number) => () => new Date(E.getTime() - ms);
    // A: eski ve büyük (pencereden önce 200 oy, hafta içinde 30) + 1 yorum.
    const A = await f.poll({ opensAt: new Date(E.getTime() - 10 * DAY), categoryId });
    await f.votes(A, 200, at(9 * DAY));
    await f.votes(A, 30, at(3 * DAY));
    await f.comments(A.id, (await f.users(1))[0]!, 1, at(2 * DAY));
    // B: 2 günlük, 40 oyun hepsi bu hafta (dün öncesi).
    const B = await f.poll({ opensAt: new Date(E.getTime() - 2 * DAY), categoryId });
    await f.votes(B, 40, at(36 * HOUR));
    // C: az oy, çok tartışma (8 kişi × 2 yorum).
    const C = await f.poll({ opensAt: new Date(E.getTime() - 4 * DAY), categoryId });
    await f.votes(C, 5, at(3 * DAY));
    for (const u of await f.users(8)) await f.comments(C.id, u, 2, at(2 * DAY));
    // D: 3 saatlik, son 2 saatte 12 oy. E: 20 saatlik, 10 saat önce 20 oy.
    const D = await f.poll({ opensAt: new Date(E.getTime() - 3 * HOUR), categoryId });
    await f.votes(D, 12, at(2 * HOUR));
    const Ep = await f.poll({ opensAt: new Date(E.getTime() - 20 * HOUR), categoryId });
    await f.votes(Ep, 20, at(10 * HOUR));
    const names = { [A.id]: "A", [B.id]: "B", [C.id]: "C", [D.id]: "D", [Ep.id]: "E" };

    const results = await refreshTrends(deps(new Date(E.getTime() + 90_000)));
    assert.deepEqual(results.map((r) => r.status), ["SUCCEEDED", "SUCCEEDED", "SUCCEEDED", "SUCCEEDED"]);

    // Günün Yükselenleri: son 24 saat, yaşla azalan ağırlık → yeni ve hızlı D, sonra E.
    assert.deepEqual(await order("DAILY_RISING", E, names), ["D", "E"]);
    // Haftanın Yükselenleri: artış oranı. B (40²/50=32) > E (20²/30) > D (12²/22) > A (30²/240). C 10 yeni oy altında.
    assert.deepEqual(await order("WEEKLY_RISING", E, names), ["B", "E", "D", "A"]);
    // En Çok Oy Verilenler: bu hafta oy veren hesap sayısı.
    assert.deepEqual(await order("WEEKLY_MOST_VOTED", E, names), ["B", "A", "E", "D", "C"]);
    // En Çok Konuşulanlar: yorum + 2 × yorumcu. C (16 + 16) > A (1 + 2).
    assert.deepEqual(await order("WEEKLY_MOST_DISCUSSED", E, names), ["C", "A"]);

    const rising = await ranking("WEEKLY_RISING", E);
    assert.equal(rising.calculationVersion, TREND_CONFIG.calculationVersion);
    assert.equal(rising.windowStart.getTime(), E.getTime() - 7 * DAY);
    assert.deepEqual(rising.scores[0]!.components, { newVoters: 40, votersBefore: 0 });
    assert.deepEqual(rising.scores.map((s) => s.rank), [1, 2, 3, 4]);
    assert.equal((await ranking("DAILY_RISING", E)).windowStart.getTime(), E.getTime() - DAY);
  });

  test("tek hesabın patlaması sınırlı: yorum hesap başına 3, oy değiştirme yeni oy değil; yazar yorumu ve ham rapor puana girmez", async () => {
    const E = freshEnd();
    const at = (ms: number) => () => new Date(E.getTime() - ms);
    const opensAt = new Date(E.getTime() - 5 * DAY);
    // Spam: tek hesap 50 yorum. Çoğul: 5 hesap birer yorum.
    const spam = await f.poll({ opensAt, categoryId });
    await f.comments(spam.id, (await f.users(1))[0]!, 50, (i) => new Date(E.getTime() - DAY - i * 60_000));
    const plural = await f.poll({ opensAt, categoryId });
    for (const u of await f.users(5)) await f.comments(plural.id, u, 1, at(DAY));
    // Ham rapor: çoğul ankete 10 rapor. Puanı düşürmemeli.
    for (const reporterId of await f.users(10)) await db.report.create({ data: { reporterId, pollId: plural.id, reason: "SPAM" } });
    // Yazarın kendi ankete 20 yorumu sayılmaz.
    const selfTalk = await f.poll({ opensAt, categoryId });
    await f.comments(selfTalk.id, selfTalk.authorId, 20, at(DAY));
    // Oy değiştirme patlaması: 5 oy pencereden önce; hafta içinde her biri iki kez değiştiriliyor.
    const churn = await f.poll({ opensAt: new Date(E.getTime() - 20 * DAY), categoryId });
    const voters = await f.votes(churn, 5, at(10 * DAY));
    const other = (await db.pollOption.findFirst({ where: { pollId: churn.id, position: 1 }, select: { id: true } }))!.id;
    for (const userId of voters) {
      for (const optionId of [other, churn.optionId]) {
        await db.vote.update({ where: { pollId_userId: { pollId: churn.id, userId } }, data: { optionId, changeCount: { increment: 1 } } });
      }
    }
    // Geçersiz sayılan oy sayılmaz: 10 oyun 4'ü geçersiz.
    const partly = await f.poll({ opensAt, categoryId });
    const partlyVoters = await f.votes(partly, 10, at(DAY));
    await db.vote.updateMany({
      where: { pollId: partly.id, userId: { in: partlyVoters.slice(0, 4) } },
      data: { invalidatedAt: new Date(E.getTime() - HOUR), invalidationReason: "test: sahte hesap" },
    });

    await refreshTrends(deps(E));
    const discussed = await ranking("WEEKLY_MOST_DISCUSSED", E);
    const byPoll = new Map(discussed.scores.map((s) => [s.pollId, s]));
    assert.deepEqual(byPoll.get(spam.id)?.components, { comments: 3, commenters: 1 });
    assert.deepEqual(byPoll.get(plural.id)?.components, { comments: 5, commenters: 5 }, "rapor puanı düşürmez");
    assert.ok(byPoll.get(plural.id)!.rank < byPoll.get(spam.id)!.rank);
    assert.equal(byPoll.has(selfTalk.id), false, "yazarın kendi yorumları sayılmaz");

    const voted = new Map((await ranking("WEEKLY_MOST_VOTED", E)).scores.map((s) => [s.pollId, s.components]));
    assert.equal(voted.has(churn.id), false, "oy değiştirme yeni oy sayılmaz");
    assert.deepEqual(voted.get(partly.id), { voters: 6 });
  });

  test("gizli, kaldırılmış ve trendden çıkarılmış anket listeye girmez; görünürlüğü değişmez", async () => {
    const E = freshEnd();
    const opensAt = new Date(E.getTime() - DAY);
    const polls = { visible: await f.poll({ opensAt, categoryId }), hidden: await f.poll({ opensAt, categoryId }), removed: await f.poll({ opensAt, categoryId }), excluded: await f.poll({ opensAt, categoryId }) };
    for (const p of Object.values(polls)) await f.votes(p, 3, () => new Date(E.getTime() - HOUR));
    await db.poll.update({ where: { id: polls.hidden.id }, data: { status: "HIDDEN" } });
    await db.poll.update({ where: { id: polls.removed.id }, data: { status: "REMOVED" } });
    await db.poll.update({ where: { id: polls.excluded.id }, data: { trendExcludedAt: new Date(E.getTime() - 2 * HOUR) } });

    await refreshTrends(deps(E));
    const ids = (await ranking("WEEKLY_MOST_VOTED", E)).scores.map((s) => s.pollId);
    assert.deepEqual(ids, [polls.visible.id]);
    assert.equal((await db.poll.findUnique({ where: { id: polls.excluded.id }, select: { status: true } }))!.status, "ACTIVE");
  });

  test("idempotent: aynı 5 dakikalık dilim ikinci kez hesaplanmaz; eşzamanlı çalıştırmada tek sonuç", async () => {
    const E = freshEnd();
    const p = await f.poll({ opensAt: new Date(E.getTime() - DAY), categoryId });
    await f.votes(p, 3, () => new Date(E.getTime() - HOUR));

    assert.ok((await refreshTrends(deps(new Date(E.getTime() + 60_000)))).every((r) => r.status === "SUCCEEDED"));
    const again = await refreshTrends(deps(new Date(E.getTime() + 4 * 60_000)));
    assert.deepEqual(again.map((r) => r.status === "SKIPPED" && r.reason), [...COMPUTED_FORMATS.map(() => "already_done")]);
    assert.equal(await db.trendRun.count({ where: { windowEnd: E } }), COMPUTED_FORMATS.length);

    // Sonraki dilim yeni çalıştırma açar.
    const next = new Date(E.getTime() + 5 * 60_000);
    assert.equal((await refreshFormat(deps(next), "WEEKLY_MOST_VOTED", next)).status, "SUCCEEDED");

    // Eşzamanlı 5 worker aynı dilim için: tek başarılı çalıştırma.
    const slot = new Date(E.getTime() + 10 * 60_000);
    const racing = await Promise.all(Array.from({ length: 5 }, () => refreshFormat(deps(slot), "WEEKLY_MOST_VOTED", slot)));
    assert.equal(racing.filter((r) => r.status === "SUCCEEDED").length, 1);
    assert.equal(await db.trendRun.count({ where: { windowEnd: slot, format: "WEEKLY_MOST_VOTED" } }), 1);
  });

  test("çalıştırma açan transaction commit etmeden ikinci worker beklenir ve yeni çalıştırma açmaz", async () => {
    // HTTP/Promise yarışı zamanlamaya bağlı; burada çakışan worker elle tutulur. Kilit olmasaydı ikinci worker
    // commit edilmemiş RUNNING satırını göremez ve aynı dilim için ikinci çalıştırmayı açardı.
    const E = freshEnd();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));
    const holder = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"trends.refresh:WEEKLY_MOST_VOTED"}, 0))`;
        await tx.trendRun.create({
          data: { format: "WEEKLY_MOST_VOTED", calculationVersion: TREND_CONFIG.calculationVersion, windowStart: new Date(E.getTime() - 7 * DAY), windowEnd: E, startedAt: E },
        });
        locked();
        await hold;
      },
      { timeout: 10_000 },
    );
    await holding;
    const second = refreshFormat(deps(E), "WEEKLY_MOST_VOTED", E);
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await holder;
    assert.deepEqual(await second, { format: "WEEKLY_MOST_VOTED", status: "SKIPPED", reason: "in_progress" });
    assert.equal(await db.trendRun.count({ where: { windowEnd: E, format: "WEEKLY_MOST_VOTED" } }), 1);
  });

  test("yarım kalan çalıştırma: taze RUNNING beklenir, bayat RUNNING FAILED olur ve yeniden hesaplanır", async () => {
    const E = freshEnd();
    const running = (startedAt: Date) =>
      db.trendRun.create({ data: { format: "DAILY_RISING", calculationVersion: TREND_CONFIG.calculationVersion, windowStart: new Date(E.getTime() - DAY), windowEnd: E, startedAt } });

    const fresh = await running(new Date(E.getTime() - 60_000));
    assert.deepEqual(await refreshFormat(deps(E), "DAILY_RISING", E), { format: "DAILY_RISING", status: "SKIPPED", reason: "in_progress" });

    const later = new Date(E.getTime() + 20 * 60_000);
    const result = await refreshFormat(deps(later), "DAILY_RISING", E);
    assert.equal(result.status, "SUCCEEDED");
    const old = await db.trendRun.findUniqueOrThrow({ where: { id: fresh.id } });
    assert.equal(old.status, "FAILED");
    assert.match(old.error!, /zaman aşımı/);
  });

  test("hata: çalıştırma FAILED ve hata metniyle kapanır, önceki başarılı sıralama yerinde kalır", async () => {
    const E = freshEnd();
    assert.equal((await refreshFormat(deps(E), "WEEKLY_MOST_VOTED", E)).status, "SUCCEEDED");
    const next = new Date(E.getTime() + 5 * 60_000);
    // İkinci transaction (puanlama) patlar; ilk transaction (çalıştırmayı açma) normal.
    let calls = 0;
    const failing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "$transaction") {
          return (...args: unknown[]) => (++calls === 2 ? Promise.reject(new Error("test: puanlama hatası")) : (target.$transaction as (...a: unknown[]) => unknown)(...args));
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const result = await refreshFormat({ prisma: failing, now: () => next, log: () => {} }, "WEEKLY_MOST_VOTED", next);
    assert.equal(result.status, "FAILED");
    const failed = await db.trendRun.findFirstOrThrow({ where: { windowEnd: next, format: "WEEKLY_MOST_VOTED" } });
    assert.deepEqual([failed.status, failed.error], ["FAILED", "test: puanlama hatası"]);
    assert.equal(await db.trendScore.count({ where: { runId: failed.id } }), 0);
    assert.equal(await db.trendRun.count({ where: { windowEnd: E, format: "WEEKLY_MOST_VOTED", status: "SUCCEEDED" } }), 1);
  });

  test("temizlik: 24 saatten eski çalıştırmalar silinir, her formatın güncel başarılısı kalır", async () => {
    // Bütün testlerden daha ileri bir tarih: formatların güncel çalıştırması bunlar olur.
    const base = slotEnd(new Date(Date.UTC(9000, 0, 1)));
    const make = (format: ComputedFormat, windowEnd: Date, status: "SUCCEEDED" | "FAILED") =>
      db.trendRun.create({
        data: { id: randomUUID(), format, calculationVersion: 1, status, windowStart: new Date(windowEnd.getTime() - DAY), windowEnd, startedAt: windowEnd, finishedAt: windowEnd },
      });
    const oldOk = await make("DAILY_RISING", base, "SUCCEEDED");
    const oldFailed = await make("DAILY_RISING", new Date(base.getTime() + HOUR), "FAILED");
    const newest = await make("DAILY_RISING", new Date(base.getTime() + 2 * HOUR), "SUCCEEDED");
    const onlyOld = await make("WEEKLY_RISING", base, "SUCCEEDED");
    const recent = await make("WEEKLY_RISING", new Date(base.getTime() + 47 * HOUR), "FAILED");

    await pruneRuns(deps(new Date(base.getTime() + 48 * HOUR)));
    const left = new Set((await db.trendRun.findMany({ where: { id: { in: [oldOk.id, oldFailed.id, newest.id, onlyOld.id, recent.id] } }, select: { id: true } })).map((r) => r.id));
    assert.deepEqual(left, new Set([newest.id, onlyOld.id, recent.id]));
    // Bu tarihler "güncel çalıştırma" olarak kalmasın (yerelde API testleri aynı DB'yi kullanır).
    await db.trendRun.deleteMany({ where: { id: { in: [...left] } } });
  });
});

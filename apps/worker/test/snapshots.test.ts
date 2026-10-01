/**
 * KV-29 (#31) snapshots.daily ve Haftanın Değişkenleri (WEEKLY_MOVERS), gerçek PostgreSQL ile. Kurallar:
 * DATA_MODEL §8 (Europe/Istanbul takvim günü, vote_events'ten hesap). Tarihli fixture: her test rastgele ve uzak
 * bir gelecek gününe kendi verisini kurar; saatler İstanbul saatiyle yazılır.
 */
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { istanbulDate, recomputeStaleSnapshots, runDailySnapshots, snapshotDay, type SnapshotJobDeps } from "../src/jobs/snapshots/job.ts";
import { TREND_CONFIG } from "../src/jobs/trends/config.ts";
import { refreshFormat, refreshTrends, type TrendJobDeps } from "../src/jobs/trends/job.ts";
import { fixtures, migratedClient, testDatabaseUrl } from "./support/db.ts";

const url = testDatabaseUrl();
const DAY = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD + gün. */
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** İstanbul saatiyle an (UTC+3; Türkiye 2016'dan beri sabit, test hesabı yine AT TIME ZONE ile doğrulanır). */
const ist = (d: string, hh: number, mm = 0) => new Date(Date.parse(`${d}T00:00:00Z`) + ((hh - 3) * 60 + mm) * 60_000);
/** Rastgele uzak gelecek günü (2031 sonrası). */
const freshDay = () => addDays("2031-01-01", randomInt(0, 40_000));

describe("snapshots.daily ve Haftanın Değişkenleri (postgres)", { skip: url ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let db: PrismaClient;
  let f: ReturnType<typeof fixtures>;
  let categoryId: string;
  const snapDeps = (now: Date): SnapshotJobDeps => ({ prisma: db, now: () => now, log: () => {} });
  const trendDeps = (now: Date): TrendJobDeps => ({ prisma: db, now: () => now, log: () => {} });

  async function day(pollId: string, localDate: string) {
    const row = await db.pollDailySnapshot.findUnique({
      where: { pollId_localDate: { pollId, localDate: new Date(`${localDate}T00:00:00Z`) } },
      include: { options: { include: { option: { select: { position: true } } } } },
    });
    if (!row) return null;
    const byPosition = Object.fromEntries(row.options.map((o) => [o.option.position, o.validVoteCount]));
    return { pollDay: row.pollDay, total: row.totalValidVotes, cutoffAt: row.cutoffAt.toISOString(), A: byPosition[0] ?? null, B: byPosition[1] ?? null, version: row.calculationVersion };
  }

  before(async () => {
    db = migratedClient(url!);
    f = fixtures(db);
    categoryId = await f.category();
  });
  after(async () => {
    await db?.$disconnect();
  });

  test("gün sonu dağılımı: kullanıcı başına son olay; değiştirme kişi sayısını büyütmez; geçersiz oy hiç sayılmaz; İstanbul gün sınırı", async () => {
    const D0 = freshDay();
    const D1 = addDays(D0, 1);
    const p = await f.poll({ opensAt: ist(D0, 10), categoryId });
    const [A, B] = p.optionIds;
    // u1: A'ya oy, ertesi gün üç kez değiştirip B'de kalır.
    await f.voter(p.id, [[ist(D0, 12), "CAST", A], [ist(D1, 9), "CHANGE", B], [ist(D1, 10), "CHANGE", A], [ist(D1, 11), "CHANGE", B]]);
    // u2: İstanbul'da D1 00:30 (UTC'de hâlâ D0 21:30) → D1'e sayılır, D0'a değil.
    await f.voter(p.id, [[ist(D1, 0, 30), "CAST", B]]);
    // u3: İstanbul'da D0 23:30 (UTC'de D0 20:30) → D0'a sayılır.
    await f.voter(p.id, [[ist(D0, 23, 30), "CAST", A]]);
    // u4: D0'da oy, D1'de geçersiz sayıldı → şu an geçersiz: hiçbir günde sayılmaz (§5.4).
    await f.voter(p.id, [[ist(D0, 13), "CAST", A], [ist(D1, 8), "INVALIDATE", null]]);

    const now = ist(addDays(D1, 1), 0, 5);
    assert.equal(await snapshotDay(snapDeps(now), D0), 1);
    assert.equal(await snapshotDay(snapDeps(now), D1), 1);
    assert.deepEqual(await day(p.id, D0), { pollDay: 0, total: 2, cutoffAt: ist(D1, 0).toISOString(), A: 2, B: 0, version: 1 });
    assert.deepEqual(await day(p.id, D1), { pollDay: 1, total: 3, cutoffAt: ist(addDays(D1, 1), 0).toISOString(), A: 1, B: 2, version: 1 });
    assert.equal(ist(D1, 0).toISOString().slice(0, 10), D0, "cutoff UTC'de bir önceki gündür (21:00Z)");
  });

  test("tekrar çalışan job aynı sonucu yazar; bitmemiş gün ve açılıştan önceki gün yazılmaz (eksik geçmiş uydurulmaz)", async () => {
    const D0 = freshDay();
    const p = await f.poll({ opensAt: ist(D0, 9), categoryId });
    await f.voter(p.id, [[ist(D0, 10), "CAST", p.optionIds[0]]]);
    const after = ist(addDays(D0, 1), 0, 5);

    for (let i = 0; i < 3; i++) await snapshotDay(snapDeps(after), D0);
    assert.equal(await db.pollDailySnapshot.count({ where: { pollId: p.id } }), 1);
    assert.equal(await db.pollOptionDailySnapshot.count({ where: { pollId: p.id } }), 2);
    assert.deepEqual(await day(p.id, D0), { pollDay: 0, total: 1, cutoffAt: ist(addDays(D0, 1), 0).toISOString(), A: 1, B: 0, version: 1 });

    // Gün bitmeden (23:59) çalışırsa satır yok.
    const D1 = addDays(D0, 1);
    assert.equal(await snapshotDay(snapDeps(ist(D1, 23, 59)), D1), 0);
    assert.equal(await day(p.id, D1), null);
    // Açılıştan önceki gün için satır yok.
    await snapshotDay(snapDeps(after), addDays(D0, -1));
    assert.equal(await day(p.id, addDays(D0, -1)), null);

    // Job gövdesi: dünden geriye 3 gün; geç çalışsa da (D0+3 00:05) D0'ı yazar, sonucu aynı.
    const results = await runDailySnapshots(snapDeps(ist(addDays(D0, 3), 0, 5)));
    assert.deepEqual(results.map((r) => r.localDate), [D0, addDays(D0, 1), addDays(D0, 2)]);
    assert.equal(istanbulDate(ist(addDays(D0, 3), 0, 5)), addDays(D0, 3));
    assert.deepEqual((await day(p.id, D0))!.total, 1);
    assert.equal(await db.pollDailySnapshot.count({ where: { pollId: p.id } }), 3);
  });

  /**
   * 14 günlük anket: pencere 1 = gün 0–6, pencere 2 = gün 7–13.
   * Pencere 1 sonunda 40 oy (30 A / 10 B = %75 / %25). Pencere 2'de 12 yeni B oyu ve 5 kişi A→B:
   * sonda 25 A / 27 B (52) = %48,08 / %51,92. A −26,92 puan, B +26,92 puan; eşitlikte ilk seçenek (A).
   */
  async function moverPoll(D0: string, opts: { resultsVisibility?: "ALWAYS" | "AFTER_VOTE"; before?: [number, number]; newB?: number; switchers?: number } = {}) {
    const p = await f.poll({ opensAt: ist(D0, 9), categoryId, resultsVisibility: opts.resultsVisibility ?? "ALWAYS" });
    const [A, B] = p.optionIds;
    const [a, b] = opts.before ?? [30, 10];
    const w1 = ist(addDays(D0, 2), 12);
    const w2 = ist(addDays(D0, 10), 12);
    const switchers = opts.switchers ?? 5;
    for (let i = 0; i < a; i++) {
      await f.voter(p.id, i < switchers ? [[w1, "CAST", A], [w2, "CHANGE", B]] : [[w1, "CAST", A]]);
    }
    for (let i = 0; i < b; i++) await f.voter(p.id, [[w1, "CAST", B]]);
    for (let i = 0; i < (opts.newB ?? 12); i++) await f.voter(p.id, [[w2, "CAST", B]]);
    return p;
  }

  async function snapshotRange(D0: string, days: number[], now: Date) {
    for (const d of days) await snapshotDay(snapDeps(now), addDays(D0, d));
  }

  test("Haftanın Değişkenleri: yüzde puan, örneklem ve pencere tarihleri doğru; eşikler ve görünürlük uygulanır", async () => {
    const D0 = freshDay();
    const end13 = ist(addDays(D0, 14), 0); // gün 13'ün sonu
    const now = new Date(end13.getTime() + 10 * 60_000);
    const mover = await moverPoll(D0);
    const hidden = await moverPoll(D0, { resultsVisibility: "AFTER_VOTE" }); // açık ve AFTER_VOTE: sonucu sızdırmaz
    const thin = await moverPoll(D0, { before: [21, 8] }); // pencere 1 sonunda 29 oy: eşik altı
    // Pencere 2'de sadece 4 farklı hesap, her biri 6 kez gidip geliyor: 24 olay ama 4 aktif hesap.
    const churn = await moverPoll(D0, { newB: 0, switchers: 0 });
    for (let i = 0; i < 4; i++) {
      const steps: [Date, "CAST" | "CHANGE", string][] = [[ist(addDays(D0, 8), 10), "CAST", churn.optionIds[1]]];
      for (let k = 0; k < 6; k++) steps.push([ist(addDays(D0, 9 + Math.floor(k / 2)), 10 + k), "CHANGE", churn.optionIds[k % 2]]);
      await f.voter(churn.id, steps);
    }
    await snapshotRange(D0, [0, 6, 7, 13], now);

    const result = await refreshFormat(trendDeps(now), "WEEKLY_MOVERS", now);
    assert.equal(result.status, "SUCCEEDED");
    const run = await db.trendRun.findFirstOrThrow({
      where: { format: "WEEKLY_MOVERS", windowEnd: now, status: "SUCCEEDED" },
      include: { scores: { orderBy: { rank: "asc" } } },
    });
    const ours = run.scores.filter((s) => [mover.id, hidden.id, thin.id, churn.id].includes(s.pollId));
    assert.deepEqual(ours.map((s) => s.pollId), [mover.id], "AFTER_VOTE, eşik altı ve az aktif hesaplı anket listede yok");
    assert.deepEqual(ours[0]!.components, {
      optionId: mover.optionIds[0],
      fromPercent: 75,
      toPercent: 48.08,
      deltaPoints: -26.92,
      sampleFrom: 40,
      sampleTo: 52,
      windowFromEnd: ist(addDays(D0, 7), 0).toISOString().replace("Z", "+00:00").replace(".000", ""),
      windowToEnd: end13.toISOString().replace("Z", "+00:00").replace(".000", ""),
      activeAccounts: 17,
    });
    assert.equal(ours[0]!.score, 26.92);
    assert.equal(TREND_CONFIG.movers.minVotes, 30);
    assert.equal(TREND_CONFIG.movers.minActiveAccounts, 10);
  });

  test("eksik snapshot uydurulmaz; pencere sonu son 7 gün dışındaysa listede yok", async () => {
    const D0 = freshDay();
    const end13 = ist(addDays(D0, 14), 0);
    const now = new Date(end13.getTime() + 10 * 60_000);
    const missing = await moverPoll(D0);
    await snapshotRange(D0, [13], now); // gün 6 snapshot'ı yok
    await refreshFormat(trendDeps(now), "WEEKLY_MOVERS", now);
    const run = await db.trendRun.findFirstOrThrow({ where: { format: "WEEKLY_MOVERS", windowEnd: now }, include: { scores: true } });
    assert.equal(run.scores.some((s) => s.pollId === missing.id), false);

    // Gün 6 sonradan hesaplanınca (vote_events'ten tam hesap, uydurma değil) bir sonraki çalıştırmada girer.
    await snapshotRange(D0, [6], now);
    const later = new Date(now.getTime() + 5 * 60_000);
    await refreshFormat(trendDeps(later), "WEEKLY_MOVERS", later);
    const next = await db.trendRun.findFirstOrThrow({ where: { format: "WEEKLY_MOVERS", windowEnd: later }, include: { scores: true } });
    assert.equal(next.scores.some((s) => s.pollId === missing.id), true);

    // 8 gün sonra pencere sonu çalıştırma penceresinin dışında kalır.
    const old = new Date(end13.getTime() + 8 * DAY);
    await refreshFormat(trendDeps(old), "WEEKLY_MOVERS", old);
    const stale = await db.trendRun.findFirstOrThrow({ where: { format: "WEEKLY_MOVERS", windowEnd: old }, include: { scores: true } });
    assert.equal(stale.scores.some((s) => s.pollId === missing.id), false);
  });

  test("KV-43: geçersiz sayılan oydan sonra etkilenen günler yeniden üretilir; işaret temizlenir; trend job'u da yapar", async () => {
    const D0 = freshDay();
    const [D1, D2, D3] = [addDays(D0, 1), addDays(D0, 2), addDays(D0, 3)];
    const p = await f.poll({ opensAt: ist(D0, 9), categoryId });
    const [A, B] = p.optionIds;
    const fake = await f.voter(p.id, [[ist(D0, 10), "CAST", A]]);
    await f.voter(p.id, [[ist(D0, 11), "CAST", A]]);
    await f.voter(p.id, [[ist(D1, 10), "CAST", B]]);
    const afterDays = ist(D3, 0, 5);
    await snapshotRange(D0, [0, 1, 2], afterDays);
    const totals = async () => [(await day(p.id, D0))!.total, (await day(p.id, D1))!.total, (await day(p.id, D2))!.total];
    assert.deepEqual(await totals(), [2, 3, 3]);

    // API'nin (admin.votes.invalidate) yaptığı düzeltme: oy geçersiz, olay aktörlü, anket işaretli.
    const [admin] = await f.users(1);
    const vote = await db.vote.findUniqueOrThrow({ where: { pollId_userId: { pollId: p.id, userId: fake } } });
    const at = ist(D3, 1);
    await db.vote.update({ where: { id: vote.id }, data: { invalidatedAt: at, invalidationReason: "sahte hesap" } });
    await db.voteEvent.create({ data: { voteId: vote.id, pollId: p.id, userId: fake, type: "INVALIDATE", fromOptionId: A, reason: "sahte hesap", actorId: admin!, occurredAt: at } });
    await db.poll.update({ where: { id: p.id }, data: { snapshotsStaleSince: vote.createdAt } });

    const done = await recomputeStaleSnapshots(snapDeps(ist(D3, 2)));
    assert.deepEqual(done.find((d) => d.pollId === p.id), { pollId: p.id, days: 3 });
    assert.deepEqual(await totals(), [1, 2, 2], "geçmiş günler düzeldi");
    assert.equal((await day(p.id, D0))!.A, 1);
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: p.id } })).snapshotsStaleSince, null);
    assert.equal((await recomputeStaleSnapshots(snapDeps(ist(D3, 3)))).some((d) => d.pollId === p.id), false, "ikinci çalıştırmada iş yok");

    // Geri alma da aynı yoldan: trend job'u (her 5 dk) önce düzeltmeyi işler.
    await db.vote.update({ where: { id: vote.id }, data: { invalidatedAt: null, invalidationReason: null } });
    await db.voteEvent.create({ data: { voteId: vote.id, pollId: p.id, userId: fake, type: "RESTORE", toOptionId: A, reason: "itiraz kabul", actorId: admin!, occurredAt: ist(D3, 4) } });
    await db.poll.update({ where: { id: p.id }, data: { snapshotsStaleSince: vote.createdAt } });
    await refreshTrends(trendDeps(ist(D3, 5)));
    assert.deepEqual(await totals(), [2, 3, 3], "geri alınan oy yeniden sayılır");
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: p.id } })).snapshotsStaleSince, null);
  });
});

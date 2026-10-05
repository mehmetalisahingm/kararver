// KV-21 PR-3 — kitlesel bildirim fan-out ölçümü. Test değildir, CI'da koşmaz; elle çalıştırılır.
//
// Ne ölçer: poll.closed / decision.updated fan-out'unun (fanoutToVoters: 1000'lik dilimler, dilim başına tek
// INSERT … SELECT unnest … ON CONFLICT DO NOTHING) N geçerli oy verenli bir ankette, tüketici transaction'ı gibi tek
// transaction'da kaç saniye sürdüğünü; ardından aynı olayın retry'ını (bütün satırlar dedupe ile atlanır).
// Karar eşiği: tüketici transaction sınırı 30 sn'nin yarısı (15 sn). Sonuç ve makine: docs/KV-21_NOTIFICATIONS.md §6.3.
//
// Çalıştırma (PowerShell):
//   $env:TEST_DATABASE_URL = "postgresql://kararver:...@127.0.0.1:5432/kararver_test"
//   node apps/worker/scripts/notifications-fanout-bench.ts [alıcı=50000]
// Yalnız açıkça verilen TEST_DATABASE_URL hedefine yazar (.env'deki DATABASE_URL'den türetmez) ve veritabanı adı "_test"
// ile bitmelidir. O veritabanına N kullanıcı, bir anket, N oy ve N bildirim yazar ve bırakır; sonra `pnpm test:reset`.
import os from "node:os";
import { newEventId } from "@kararver/contracts";
import { fixtures, migratedClient } from "../test/support/db.ts";
import { allowAll } from "../src/jobs/notifications/policy.ts";
import { fanoutToVoters, type NotificationDraft } from "../src/jobs/notifications/write.ts";

const N = Number(process.argv[2] ?? 50_000);
if (!Number.isInteger(N) || N < 1) throw new Error("Alıcı sayısı pozitif tam sayı olmalı");
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL tanımlı değil: bu script yalnız açıkça verilen test veritabanına yazar");
const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
if (!dbName.endsWith("_test")) throw new Error(`Güvenlik: veritabanı adı "_test" ile bitmeli (şu an: "${dbName}")`);
const db = migratedClient(url);
const f = fixtures(db);
const CHUNK = 5000;

const t0 = performance.now();
const ids: string[] = [];
for (let i = 0; i < N; i += CHUNK) ids.push(...(await f.users(Math.min(CHUNK, N - i))));
const categoryId = await f.category();
const opensAt = new Date(Date.now() - 24 * 60 * 60_000);
const poll = await f.poll({ opensAt, categoryId });
for (let i = 0; i < N; i += CHUNK) {
  await db.vote.createMany({
    data: ids.slice(i, i + CHUNK).map((userId, j) => ({ pollId: poll.id, optionId: poll.optionIds[(i + j) % 2]!, userId, createdAt: new Date(opensAt.getTime() + i + j) })),
  });
}
const setupMs = performance.now() - t0;

const eventId = newEventId();
const draft: NotificationDraft = {
  type: "POLL_CLOSED",
  eventId,
  eventActorId: null,
  actorId: null,
  subject: { type: "POLL", id: poll.id },
  pollId: poll.id,
  data: { reason: "EXPIRED" },
  dedupeKey: `notifications:poll.closed:${poll.id}`,
  createdAt: new Date(),
};

async function run() {
  const started = performance.now();
  const result = await db.$transaction((tx) => fanoutToVoters(tx, draft, { pollId: poll.id, policy: allowAll }), { timeout: 120_000, maxWait: 10_000 });
  return { ...result, ms: Math.round(performance.now() - started) };
}

const first = await run();
const retry = await run();
const rows = await db.notification.count({ where: { eventId } });
console.log(JSON.stringify({
  recipients: N,
  setupMs: Math.round(setupMs),
  first,
  retry,
  rowsInDb: rows,
  thresholdMs: 15_000,
  verdict: first.ms < 15_000 ? "eşiğin altında" : "EŞİK AŞILDI",
  host: { cpu: os.cpus()[0]?.model, threads: os.cpus().length, ramGb: Math.round(os.totalmem() / 2 ** 30), platform: `${os.platform()} ${os.release()}`, node: process.version },
}, null, 2));
await db.$disconnect();

// Toplu moderasyon (#183) web tarafı: seçim sınırı, özet metinleri ve istemci çağrıları.
import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { AdminClient } from "../src/features/admin/admin-client.ts";
import { BULK_MAX, blockedLabels, canApply, previewSummary, resultSummary, toggleSelection } from "../src/features/admin/bulk-model.ts";
import { HttpClient } from "../src/lib/http-client.ts";
import { UiError } from "../src/lib/model.ts";

const IDS = ["01998b9a-0000-7000-8000-000000000940", "01998b9a-0000-7000-8000-000000000941", "01998b9a-0000-7000-8000-000000000942"];

test("seçim: ekle/çıkar, sınır BULK_MAX'ta ekleme reddedilir ve `full` bildirir; çıkarma sınırda da çalışır", () => {
  let sel: ReadonlySet<string> = new Set();
  for (let i = 0; i < BULK_MAX; i++) {
    const r = toggleSelection(sel, `id-${i}`);
    assert.equal(r.full, false);
    sel = r.next;
  }
  assert.equal(sel.size, BULK_MAX);
  const over = toggleSelection(sel, "fazla");
  assert.equal(over.full, true);
  assert.equal(over.next.size, BULK_MAX);
  assert.equal(over.next.has("fazla"), false);
  const removed = toggleSelection(sel, "id-0");
  assert.equal(removed.full, false);
  assert.equal(removed.next.size, BULK_MAX - 1);
  assert.equal(sel.size, BULK_MAX, "girdi değişmez");
});

function reply(endpoint: string, name: string) {
  const e = structuredClone(examples.find((x) => x.endpoint === endpoint && x.name === name)!);
  return new Response(e.body === null ? null : JSON.stringify(e.body), { status: e.status });
}
type Seen = { url: string; method: string; body: unknown };
function admin(respond: () => Response) {
  const calls: Seen[] = [];
  const client = new AdminClient(new HttpClient("http://api.test", async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : undefined });
    return respond();
  }));
  return { client, calls };
}

test("önizleme özeti ve uygulanabilirlik: yalnız değişecek kayıt varsa onay açılır; uygulanamayanlar nedenleriyle etiketli", async () => {
  const a = admin(() => reply("admin.moderation.polls.bulkPreview", "ok"));
  const preview = await a.client.bulkPreview("polls", IDS, "HIDE");
  assert.equal(a.calls[0]!.method, "GET");
  assert.ok(a.calls[0]!.url.includes("/admin/moderation/polls/bulk/preview"));
  assert.ok(a.calls[0]!.url.includes(`ids=${encodeURIComponent(IDS.join(","))}`) || a.calls[0]!.url.includes(`ids=${IDS.join(",")}`));
  assert.ok(a.calls[0]!.url.includes("action=HIDE"));
  assert.match(previewSummary(preview), /1 kayıt değişecek, 1 zaten bu durumda, 2 uygulanamayacak/);
  assert.equal(canApply(preview), true);
  assert.equal(canApply({ ...preview, summary: { willChange: 0, noChange: 2, blocked: 1 } }), false);
  assert.equal(canApply(null), false);
  assert.ok(preview.items.every((i) => i.blocked === null || blockedLabels[i.blocked]), "her engel kodunun metni var");
  const blocked = preview.items.filter((i) => i.outcome === "BLOCKED");
  assert.ok(blocked.every((i) => i.label === null), "yetkisiz/olmayan kayıtta içerik yok");
});

test("uygulama: gövde ids+action+reason+digest taşır, sonuç özeti kısmi başarısızlığı nedenleriyle yazar; stale ve hız sınırı hata olarak yüzeye çıkar", async () => {
  const ok = admin(() => reply("admin.moderation.polls.bulk", "ok"));
  const result = await ok.client.bulkApply("polls", { ids: IDS, action: "HIDE", reason: "Toplu moderasyon incelemesi", digest: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90" });
  assert.equal(ok.calls[0]!.method, "POST");
  assert.ok(ok.calls[0]!.url.endsWith("/admin/moderation/polls/bulk"));
  assert.deepEqual(Object.keys(ok.calls[0]!.body as object).sort(), ["action", "digest", "ids", "reason"]);
  assert.equal(result.summary.applied, 1);
  assert.equal(resultSummary(result), "1 uygulandı, 1 değişmedi, 1 başarısız (1 × Kapsam dışı: bu topluluk için yetkin yok).");

  const stale = admin(() => reply("admin.moderation.comments.bulk", "stale"));
  await assert.rejects(stale.client.bulkApply("comments", { ids: IDS, action: "HIDE", reason: "Toplu moderasyon incelemesi", digest: "a".repeat(64) }), (e) => e instanceof UiError && e.code === "CONFLICT");
  const limited = admin(() => reply("admin.moderation.polls.bulk", "rate-limited"));
  await assert.rejects(limited.client.bulkApply("polls", { ids: IDS, action: "HIDE", reason: "Toplu moderasyon incelemesi", digest: "a".repeat(64) }), (e) => e instanceof UiError && e.code === "RATE_LIMITED");
});

test("parti geçmişi doğru endpoint'ten gelir ve sözleşmeyle doğrulanır", async () => {
  const a = admin(() => reply("admin.moderation.batches.list", "ok"));
  const list = await a.client.moderationBatches();
  assert.ok(a.calls[0]!.url.includes("/admin/moderation/batches"));
  assert.equal(list.items[0]!.applied, 1);
  assert.equal(list.next, null);
});

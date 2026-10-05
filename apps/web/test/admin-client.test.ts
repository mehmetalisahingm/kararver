// Yönetim ekranı istemcisi (KV-14/24/32/37/38): doğru endpoint, yöntem, gövde ve sözleşme doğrulaması.
import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { AdminClient } from "../src/features/admin/admin-client.ts";
import { HttpClient } from "../src/lib/http-client.ts";
import { UiError } from "../src/lib/model.ts";

type Seen = { url: string; method: string; body: unknown; headers: Record<string, string> };

function fixture(endpoint: string, name: string) {
  return structuredClone(examples.find((e) => e.endpoint === endpoint && e.name === name)!);
}
function reply(endpoint: string, name: string) {
  const e = fixture(endpoint, name);
  return new Response(e.body === null ? null : JSON.stringify(e.body), { status: e.status });
}
function client(respond: (seen: Seen) => Response) {
  const calls: Seen[] = [];
  const http = new HttpClient("http://api.test", async (url, init) => {
    const seen = { url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : undefined, headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(seen);
    return respond(seen);
  });
  return { admin: new AdminClient(http), calls };
}

test("rapor kuyruğu: durum ve tür filtresiyle istenir, sayfa bilgisi sözleşmeden okunur", async () => {
  const { admin, calls } = client(() => reply("admin.reports.list", "ok"));
  const page = await admin.reports({ status: "OPEN", targetType: "POLL", cursor: "abc_DEF-1" });
  assert.equal(calls[0].method, "GET");
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v1/admin/reports");
  assert.deepEqual([url.searchParams.get("status"), url.searchParams.get("targetType"), url.searchParams.get("cursor"), url.searchParams.get("limit")], ["OPEN", "POLL", "abc_DEF-1", "20"]);
  assert.equal(page.items.length, 1);
  assert.equal(page.next, null);
});

test("tür filtresi boşsa sorguya girmez", async () => {
  const { admin, calls } = client(() => reply("admin.reports.list", "ok"));
  await admin.reports({ status: "DISMISSED" });
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.has("targetType"), false);
  assert.equal(url.searchParams.has("cursor"), false);
});

test("rapor sonuçlandırma: POST /admin/reports/:id/resolve, karar ve gerekçe gövdede", async () => {
  const resolve = fixture("admin.reports.resolve", "ok");
  const { admin, calls } = client(() => reply("admin.reports.resolve", "ok"));
  await admin.resolveReport((resolve.request!.params as { id: string }).id, "ACTIONED", "Yorum kaldırıldı");
  assert.equal(calls[0].method, "POST");
  assert.ok(calls[0].url.endsWith(`/v1/admin/reports/${(resolve.request!.params as { id: string }).id}/resolve`));
  assert.deepEqual(calls[0].body, { resolution: "ACTIONED", note: "Yorum kaldırıldı" });
});

test("içerik moderasyonu: anket ve yorum ayrı endpoint'lere gider", async () => {
  const polls = client(() => reply("admin.moderation.polls", "hide"));
  const outcome = await polls.admin.moderate("polls", "01998b9a-0000-7000-8000-000000000020", "HIDE", "Spam doğrulandı");
  assert.ok(polls.calls[0].url.endsWith("/v1/admin/polls/01998b9a-0000-7000-8000-000000000020/moderation"));
  assert.deepEqual(polls.calls[0].body, { action: "HIDE", reason: "Spam doğrulandı" });
  assert.equal(typeof outcome.status, "string");

  const comments = client(() => reply("admin.moderation.comments", "remove"));
  await comments.admin.moderate("comments", "01998b9a-0000-7000-8000-000000000040", "REMOVE", "Hakaret");
  assert.ok(comments.calls[0].url.includes("/v1/admin/comments/"));
});

test("yetkisiz moderasyon 403 olarak UiError'a çevrilir", async () => {
  const { admin } = client(() => reply("admin.moderation.polls", "out-of-scope"));
  await assert.rejects(admin.moderate("polls", "01998b9a-0000-7000-8000-000000000020", "HIDE", "Deneme"), (e: UiError) => e.code === "FORBIDDEN");
});

test("görsel kuyruğu ve karar", async () => {
  const list = client(() => reply("admin.media.list", "ok"));
  const page = await list.admin.media({ status: "QUARANTINED" });
  assert.equal(new URL(list.calls[0].url).searchParams.get("status"), "QUARANTINED");
  assert.equal(page.items[0].status, "QUARANTINED");
  assert.ok(page.items[0].preview, "karantinadaki görsel önizleme taşır");

  const decide = client(() => reply("admin.media.decide", "ok"));
  const media = await decide.admin.decideMedia("01998b9a-0000-7000-8000-000000000050", "APPROVE", "Uygun içerik");
  assert.equal(decide.calls[0].method, "POST");
  assert.ok(decide.calls[0].url.endsWith("/v1/admin/media/01998b9a-0000-7000-8000-000000000050/decision"));
  assert.deepEqual(decide.calls[0].body, { decision: "APPROVE", reason: "Uygun içerik" });
  assert.equal(media.status, "APPROVED");
});

test("yasaklı görsel listesi: liste, ekleme, 409 mesajı ve 204 ile kaldırma", async () => {
  const list = client(() => reply("admin.media.bans.list", "ok"));
  const bans = await list.admin.bans();
  assert.equal(bans.items[0].matchesExact, true);
  assert.equal("contentSha256" in bans.items[0], false, "parmak izi değeri arayüze gelmez");

  const create = client(() => reply("admin.media.bans.create", "ok"));
  await create.admin.banMedia("01998b9a-0000-7000-8000-000000000050", "Tekrar yüklenen uygunsuz görsel");
  assert.deepEqual(create.calls[0].body, { mediaId: "01998b9a-0000-7000-8000-000000000050", reason: "Tekrar yüklenen uygunsuz görsel" });

  const conflict = client(() => reply("admin.media.bans.create", "reddedilmemis"));
  await assert.rejects(conflict.admin.banMedia("01998b9a-0000-7000-8000-000000000050", "Henüz karara bağlanmadı"), (e: UiError) => e.code === "CONFLICT" && /reddedilmiş/i.test(e.message));

  const remove = client(() => reply("admin.media.bans.delete", "ok"));
  await remove.admin.unban("01998b9a-0000-7000-8000-000000000051");
  assert.equal(remove.calls[0].method, "DELETE");
});

test("topluluk yönetimi: açma idempotency anahtarıyla, düzenleme gerekçeyle, moderatör ata/kaldır", async () => {
  const create = client(() => reply("admin.communities.create", "ok"));
  await create.admin.createCommunity({ slug: "samsun-universitesi", name: "Samsun Üniversitesi", membersVisibility: "MEMBERS" }, "topluluk-anahtar-123");
  assert.equal(create.calls[0].headers["Idempotency-Key"], "topluluk-anahtar-123");
  assert.equal(create.calls[0].method, "POST");

  const update = client(() => reply("admin.communities.update", "ok"));
  await update.admin.updateCommunity("01998b9a-0000-7000-8000-000000000060", { status: "HIDDEN" }, "Geçici kapatma");
  assert.equal(update.calls[0].method, "PATCH");
  assert.deepEqual(update.calls[0].body, { status: "HIDDEN", reason: "Geçici kapatma" });

  const assign = client(() => reply("admin.communities.moderators.put", "ok"));
  await assign.admin.assignModerator("01998b9a-0000-7000-8000-000000000060", "01998b9a-0000-7000-8000-000000000002", "Aktif üye");
  assert.equal(assign.calls[0].method, "PUT");
  assert.deepEqual(assign.calls[0].body, { reason: "Aktif üye" });

  const remove = client(() => reply("admin.communities.moderators.delete", "ok"));
  await remove.admin.removeModerator("01998b9a-0000-7000-8000-000000000060", "01998b9a-0000-7000-8000-000000000002");
  assert.equal(remove.calls[0].method, "DELETE");
});

test("sözleşmeye uymayan cevap reddedilir (sızıntı: fazladan alan)", async () => {
  const poisoned = fixture("admin.media.bans.list", "ok");
  (poisoned.body as { data: Record<string, unknown>[] }).data[0].contentSha256 = "a".repeat(64);
  const { admin } = client(() => new Response(JSON.stringify(poisoned.body), { status: 200 }));
  await assert.rejects(admin.bans(), (e: UiError) => e.code === "INVALID_RESPONSE");
});

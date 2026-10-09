// Yönetim ekranı istemcisi (KV-14/24/32/37/38): doğru endpoint, yöntem, gövde ve sözleşme doğrulaması.
import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { AdminClient } from "../src/features/admin/admin-client.ts";
import { HttpClient } from "../src/lib/http-client.ts";
import { UiError } from "../src/lib/model.ts";

type Seen = { url: string; method: string; body: unknown; headers: Record<string, string> };

test("user list and role assignment use real admin contracts", async () => {
  const listing = client(() => reply("admin.users.list", "ok"));
  await listing.admin.users("faruk");
  assert.equal(new URL(listing.calls[0].url).pathname, "/v1/admin/users");
  assert.equal(new URL(listing.calls[0].url).searchParams.get("q"), "faruk");
  const id = "01998b9a-0000-7000-8000-000000000020";
  const assigning = client(() => new Response(JSON.stringify({ data: { userId: id, roles: ["ADMIN"] } }), { status: 200 }));
  await assigning.admin.setUserRole(id, "ADMIN", "Test yönetici ataması");
  assert.equal(assigning.calls[0].method, "PUT");
  assert.ok(assigning.calls[0].url.endsWith(`/admin/users/${id}/role`));
  assert.deepEqual(assigning.calls[0].body, { role: "ADMIN", reason: "Test yönetici ataması" });
});

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

// ─── KV-37 (#39): arama, taşıma, geçmiş, uyar ve yaptırım bağlantısı ───

test("anket araması: süzgeçler sorguya gider, boş olanlar girmez, boolean 'true' olarak gönderilir", async () => {
  const { admin, calls } = client(() => reply("admin.content.polls", "ok"));
  const page = await admin.polls({ q: "araba", status: "HIDDEN", reported: true }, "cur_1");
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v1/admin/polls");
  assert.deepEqual(
    [url.searchParams.get("q"), url.searchParams.get("status"), url.searchParams.get("reported"), url.searchParams.get("cursor"), url.searchParams.get("limit")],
    ["araba", "HIDDEN", "true", "cur_1", "20"],
  );
  assert.equal(url.searchParams.has("trendExcluded"), false);
  assert.equal(url.searchParams.has("communityId"), false);
  assert.equal(page.items[0].commentsClosed, false);
});

test("yorum araması ve içerik geçmişi sözleşme şemasıyla okunur", async () => {
  const comments = client(() => reply("admin.content.comments", "ok"));
  const found = await comments.admin.comments({ q: "boyalı", pollId: "01998b9a-0000-7000-8000-000000000020" });
  assert.equal(new URL(comments.calls[0].url).searchParams.get("pollId"), "01998b9a-0000-7000-8000-000000000020");
  assert.equal(found.items[0].pollTitle.length > 0, true);

  const history = client(() => reply("admin.moderation.history.polls", "ok"));
  const timeline = await history.admin.history("polls", "01998b9a-0000-7000-8000-000000000020");
  assert.ok(new URL(history.calls[0].url).pathname.endsWith("/moderation-history"));
  assert.deepEqual(timeline.items.map((item) => item.kind), ["ACTION", "REPORT"]);
});

test("taşıma: yalnız verilen alanlar PATCH gövdesinde; gerekçe zorunlu; topluluktan çıkarma null gönderir", async () => {
  const { admin, calls } = client(() => reply("admin.moderation.polls.move", "ok"));
  await admin.movePoll("01998b9a-0000-7000-8000-000000000020", { categoryId: "01998b9a-0000-7000-8000-000000000010" }, "Yanlış kategori");
  assert.equal(calls[0].method, "PATCH");
  assert.ok(calls[0].url.endsWith("/v1/admin/polls/01998b9a-0000-7000-8000-000000000020/placement"));
  assert.deepEqual(calls[0].body, { categoryId: "01998b9a-0000-7000-8000-000000000010", reason: "Yanlış kategori" });

  await admin.movePoll("01998b9a-0000-7000-8000-000000000020", { communityId: null }, "Topluluk dışı");
  assert.deepEqual(calls[1].body, { communityId: null, reason: "Topluluk dışı" });
});

test("taşıma 409'u (kaldırılmış anket) UiError olarak yüzeye çıkar", async () => {
  const { admin } = client(() => reply("admin.moderation.polls.move", "removed"));
  await assert.rejects(admin.movePoll("01998b9a-0000-7000-8000-000000000020", { communityId: null }, "Topluluk dışı"), (e: UiError) => e.code === "CONFLICT");
});

test("yorumları kapat işlemi moderasyon gövdesinde; cevap commentsClosed taşır", async () => {
  const { admin, calls } = client(() => reply("admin.moderation.polls", "close-comments"));
  const outcome = await admin.moderate("polls", "01998b9a-0000-7000-8000-000000000020", "CLOSE_COMMENTS", "Tartışma kontrolden çıktı");
  assert.deepEqual(calls[0].body, { action: "CLOSE_COMMENTS", reason: "Tartışma kontrolden çıktı" });
  assert.equal(outcome.commentsClosed, true);
});

test("uyar: rapor kimliğine POST, gerekçe gövdede; yaptırım reportId ve süreyle gider", async () => {
  const warn = client(() => reply("admin.reports.warn", "ok"));
  const result = await warn.admin.warn("01998b9a-0000-7000-8000-000000000060", "Hakaret içeren yorum, ilk uyarı");
  assert.ok(warn.calls[0].url.endsWith("/v1/admin/reports/01998b9a-0000-7000-8000-000000000060/warn"));
  assert.deepEqual(warn.calls[0].body, { reason: "Hakaret içeren yorum, ilk uyarı" });
  assert.equal(result.closedReports, 2);

  const sanction = client(() => reply("admin.sanctions.create", "suspend-rapor-bagli"));
  await sanction.admin.sanction("01998b9a-0000-7000-8000-000000000002", "SUSPEND", "Tekrarlayan spam", "01998b9a-0000-7000-8000-000000000060", "2026-12-01T00:00:00.000Z");
  assert.deepEqual(sanction.calls[0].body, { type: "SUSPEND", reason: "Tekrarlayan spam", endsAt: "2026-12-01T00:00:00.000Z", reportId: "01998b9a-0000-7000-8000-000000000060" });
});

test("kuyruk satırı hedef özeti, durumu ve sahibini taşır", async () => {
  const { admin } = client(() => reply("admin.reports.list", "ok"));
  const [report] = (await admin.reports({ status: "OPEN" })).items;
  assert.deepEqual([report.excerpt, report.contentStatus, report.targetUser?.username], ["Boyalı parça fiyatı düşürür.", "ACTIVE", "umit"]);
});


test("KV-42 admin client: öne çıkarma CRUD doğru endpoint ve idempotency anahtarını kullanır", async () => {
  const create = client(() => reply("admin.featured.create", "ok"));
  const f = fixture("admin.featured.create", "ok");
  const body = f.request!.body as any;
  const { reason, ...input } = body;
  await create.admin.createFeatured(input, reason, "featured-key-123");
  assert.equal(create.calls[0].method, "POST");
  assert.ok(create.calls[0].url.endsWith("/v1/admin/featured"));
  assert.equal(create.calls[0].headers["Idempotency-Key"], "featured-key-123");
  assert.deepEqual(create.calls[0].body, body);

  const remove = client(() => reply("admin.featured.delete", "ok"));
  await remove.admin.deleteFeatured((fixture("admin.featured.delete", "ok").request!.params as { id: string }).id);
  assert.equal(remove.calls[0].method, "DELETE");
});

test("KV-42 admin client: duyuru hedef grubu API gövdesine gider", async () => {
  const create = client(() => reply("admin.announcements.create", "ok"));
  const f = fixture("admin.announcements.create", "ok");
  const raw = f.request!.body as any;
  const input = {
    title: raw.title,
    body: raw.body,
    level: "INFO" as const,
    audience: "ALL" as const,
    startsAt: raw.startsAt,
    endsAt: null,
  };
  await create.admin.createAnnouncement(input, raw.reason, "announcement-key-123");
  assert.equal(create.calls[0].headers["Idempotency-Key"], "announcement-key-123");
  assert.equal((create.calls[0].body as any).audience, "ALL");
});

test("audit (KV-39): yalnız dolu süzgeçler gönderilir; kayıt sözleşmeden okunur", async () => {
  const { admin, calls } = client(() => reply("admin.audit.list", "ok"));
  const page = await admin.audit({ action: "user.sanction", targetType: "USER", source: "API", from: "2026-10-01T00:00:00.000Z", targetId: "" }, "cur_1");
  const url = new URL(calls[0].url);
  assert.equal(calls[0].method, "GET");
  assert.equal(url.pathname, "/v1/admin/audit");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    limit: "30",
    action: "user.sanction",
    targetType: "USER",
    source: "API",
    from: "2026-10-01T00:00:00.000Z",
    cursor: "cur_1",
  });
  assert.equal(page.items[0]!.action, "user.sanction");
  assert.equal(page.items[0]!.reason, "Tekrarlayan spam");
});

// ─── KV-40 (#42): sistem ayarları ve acil durum ───

test("ayarlar: liste sözleşme şemasıyla okunur", async () => {
  const { admin, calls } = client(() => reply("admin.settings.list", "ok"));
  const list = await admin.settings();
  assert.ok(calls[0].url.endsWith("/v1/admin/settings"));
  assert.equal(calls[0].method, "GET");
  assert.equal(list[0].key, "polls.voteChangeAllowed");
  assert.equal(list[0].version, 3);
});

test("ayar güncelleme: PATCH, anahtar yolda; değer, sürüm ve gerekçe gövdede", async () => {
  const { admin, calls } = client(() => reply("admin.settings.update", "ok"));
  const out = await admin.updateSetting("polls.voteChangeAllowed", false, 3, "Beta kararı");
  assert.equal(calls[0].method, "PATCH");
  assert.ok(calls[0].url.endsWith("/v1/admin/settings/polls.voteChangeAllowed"));
  assert.deepEqual(calls[0].body, { value: false, version: 3, reason: "Beta kararı" });
  assert.equal(out.version, 4);
});

test("eski sürüm VERSION_CONFLICT olarak yüzeye çıkar (panel listeyi yeniler)", async () => {
  const { admin } = client(() => reply("admin.settings.update", "stale"));
  await assert.rejects(admin.updateSetting("polls.voteChangeAllowed", false, 2, "Beta kararı"), (e: UiError) => e.code === "VERSION_CONFLICT");
});

test("acil durum: yalnız verilen anahtarlar PUT gövdesinde; yanıt bütün anahtarları verir", async () => {
  const { admin, calls } = client(() => reply("admin.emergency.put", "ok"));
  const state = await admin.putEmergency({ uploads: false }, "Görsel saldırısı");
  assert.equal(calls[0].method, "PUT");
  assert.ok(calls[0].url.endsWith("/v1/admin/emergency"));
  assert.deepEqual(calls[0].body, { switches: { uploads: false }, reason: "Görsel saldırısı" });
  assert.equal(state.uploads, false);
  assert.equal(state.maintenance, false);
});

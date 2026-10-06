// Topluluk ve rapor istemcisi (KV-31, KV-24): doğru endpoint/yöntem/gövde, sözleşme doğrulaması ve hata eşlemesi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { CommunityClient, ReportClient } from "../src/features/community/community-client.ts";
import { HttpClient } from "../src/lib/http-client.ts";
import { UiError } from "../src/lib/model.ts";

type Seen = { url: string; method: string; body: unknown };

function fixture(endpoint: string, name: string) {
  return structuredClone(examples.find((e) => e.endpoint === endpoint && e.name === name)!);
}
function reply(endpoint: string, name: string) {
  const e = fixture(endpoint, name);
  return new Response(e.body === null ? null : JSON.stringify(e.body), { status: e.status });
}
function http(respond: (seen: Seen) => Response) {
  const calls: Seen[] = [];
  const client = new HttpClient("http://api.test", async (url, init) => {
    const seen = { url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : undefined };
    calls.push(seen);
    return respond(seen);
  });
  return { client, calls };
}
const COMM = "01998b9a-0000-7000-8000-000000000060";

test("topluluk listesi ve sayfası sözleşmeden okunur", async () => {
  const list = http(() => reply("communities.list", "ok"));
  const api = new CommunityClient(list.client, () => { throw new Error("kullanılmamalı"); });
  const page = await api.list("abc_1");
  assert.equal(new URL(list.calls[0].url).pathname, "/v1/communities");
  assert.equal(new URL(list.calls[0].url).searchParams.get("cursor"), "abc_1");
  assert.equal(page.items.length, 1);
  assert.equal(page.next, null);

  const detail = http(() => reply("communities.get", "ok"));
  const community = await new CommunityClient(detail.client, () => { throw new Error("x"); }).get("samsun-universitesi");
  assert.ok(detail.calls[0].url.endsWith("/v1/communities/samsun-universitesi"));
  assert.equal(community.slug, "samsun-universitesi");
});

test("katıl PUT, ayrıl DELETE; rol cevaptan gelir", async () => {
  const join = http(() => reply("communities.join", "ok"));
  const api = new CommunityClient(join.client, () => { throw new Error("x"); });
  assert.equal(await api.join(COMM), "MEMBER");
  assert.equal(join.calls[0].method, "PUT");
  assert.ok(join.calls[0].url.endsWith(`/v1/communities/${COMM}/membership`));

  const leave = http(() => reply("communities.leave", "ok"));
  await new CommunityClient(leave.client, () => { throw new Error("x"); }).leave(COMM);
  assert.equal(leave.calls[0].method, "DELETE");
});

test("üye listesi: yetkisiz izleyicinin 404'ü NOT_FOUND olarak yüzeye çıkar (ekran kapalı liste durumuna düşer)", async () => {
  const hidden = http(() => new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Topluluk bulunamadı.", details: [] }, requestId: "r-12345678" }), { status: 404 }));
  const api = new CommunityClient(hidden.client, () => { throw new Error("x"); });
  await assert.rejects(api.members(COMM), (e: UiError) => e.code === "NOT_FOUND");

  const ok = http(() => reply("communities.members", "ok"));
  const members = await new CommunityClient(ok.client, () => { throw new Error("x"); }).members(COMM);
  assert.equal(members.items[0].role, "MEMBER");
});

test("topluluk akışı: feed.list communityId ile istenir ve gönderiler eşlenir", async () => {
  const feed = http(() => reply("feed.list", "guest"));
  const mapped: unknown[] = [];
  const api = new CommunityClient(feed.client, ((wire: unknown) => { mapped.push(wire); return { id: "x" }; }) as never);
  const page = await api.feed(COMM, "cur_1");
  const url = new URL(feed.calls[0].url);
  assert.equal(url.pathname, "/v1/feed");
  assert.deepEqual([url.searchParams.get("communityId"), url.searchParams.get("cursor"), url.searchParams.get("tab")], [COMM, "cur_1", "new"]);
  assert.equal(page.items.length, mapped.length);
  assert.ok(page.items.length > 0);
});

test("rapor gönderme: hedef, neden ve not gövdede; boş not gönderilmez; kimlik döner", async () => {
  const r = http(() => reply("reports.create", "ok"));
  const api = new ReportClient(r.client);
  const id = await api.create({ type: "COMMENT", id: "01998b9a-0000-7000-8000-000000000040" }, "HARASSMENT", "  Hakaret içeriyor  ");
  assert.equal(r.calls[0].method, "POST");
  assert.ok(r.calls[0].url.endsWith("/v1/reports"));
  assert.deepEqual(r.calls[0].body, { target: { type: "COMMENT", id: "01998b9a-0000-7000-8000-000000000040" }, reason: "HARASSMENT", note: "Hakaret içeriyor" });
  assert.equal(typeof id, "string");

  await api.create({ type: "POLL", id: "01998b9a-0000-7000-8000-000000000020" }, "SPAM", "   ");
  assert.equal("note" in (r.calls[1].body as object), false);
});

test("görünmeyen içerik raporu 404 olarak UiError'a çevrilir", async () => {
  const gone = http(() => new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Raporlanacak içerik bulunamadı.", details: [] }, requestId: "r-12345678" }), { status: 404 }));
  await assert.rejects(new ReportClient(gone.client).create({ type: "POLL", id: "01998b9a-0000-7000-8000-000000000020" }, "SPAM", ""), (e: UiError) => e.code === "NOT_FOUND" && /bulunamadı/.test(e.message));
});

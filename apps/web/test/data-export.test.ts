// KVKK veri dışa aktarma (#181) web tarafı: token yönetimi, hata metinleri ve istemci çağrıları.
import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { AdminClient } from "../src/features/admin/admin-client.ts";
import { downloadErrorMessage, forgetToken, packageFileName, resolveToken, TOKEN_STORAGE_KEY } from "../src/features/data-export/download-model.ts";
import { ApiClient } from "../src/lib/api-client.ts";
import { HttpClient } from "../src/lib/http-client.ts";
import { UiError } from "../src/lib/model.ts";

const memoryStore = () => {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};
const TOKEN = "bXlfZXhwb3J0X3Rva2VuX2Zvcl9maXh0dXJlcw";

test("token: fragment'tan alınır ve sekme depolamasına yazılır; fragment yoksa saklanan döner", () => {
  const store = memoryStore();
  assert.equal(resolveToken(`#token=${TOKEN}`, store), TOKEN);
  assert.equal(store.map.get(TOKEN_STORAGE_KEY), TOKEN);
  // Giriş sayfasından dönüşte fragment yoktur.
  assert.equal(resolveToken("", store), TOKEN);
  forgetToken(store);
  assert.equal(resolveToken("", store), null);
  assert.equal(resolveToken("#baska=1", store), null);
});

test("token: depolama erişilemezse (private mod/engelli) fragment yine okunur, hata fırlatılmaz", () => {
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(resolveToken(`#token=${TOKEN}`, broken), TOKEN);
  assert.equal(resolveToken("", broken), null);
  assert.doesNotThrow(() => forgetToken(broken));
  assert.equal(resolveToken(`#token=${TOKEN}`, null), TOKEN);
  assert.equal(resolveToken("", null), null);
});

test("hata metni: geçersiz bağlantı yeniden denenmez ve hesap varlığını ele vermez; ağ hatası yeniden denenir", () => {
  const invalid = downloadErrorMessage(new UiError("TOKEN_INVALID_OR_EXPIRED", "x"));
  assert.equal(invalid.retryable, false);
  assert.match(invalid.message, /geçersiz|süresi dolmuş/);
  assert.equal(downloadErrorMessage(new UiError("UNAUTHENTICATED", "x")).retryable, false);
  const network = downloadErrorMessage(new TypeError("fetch failed"));
  assert.equal(network.retryable, true);
  assert.equal(downloadErrorMessage(new UiError("INTERNAL_ERROR", "Veri paketi şu an okunamadı")).retryable, true);
});

test("dosya adı tarih taşır ve kişisel bilgi içermez", () => {
  assert.equal(packageFileName(new Date("2026-10-12T08:30:00Z")), "kararver-verilerim-2026-10-12.json");
});

function fixture(endpoint: string, name: string) {
  return structuredClone(examples.find((e) => e.endpoint === endpoint && e.name === name)!);
}
function reply(endpoint: string, name: string) {
  const e = fixture(endpoint, name);
  return new Response(e.body === null ? null : JSON.stringify(e.body), { status: e.status });
}
type Seen = { url: string; method: string; body: unknown };
function recorder(respond: () => Response) {
  const calls: Seen[] = [];
  const http = new HttpClient("http://api.test", async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : undefined });
    return respond();
  });
  return { http, calls };
}

test("yönetici istemcisi: liste, talep ve teslim doğru endpoint'e gider; yanıtlarda token/bağlantı yok; 409 yüzeye çıkar", async () => {
  const id = "01998b9a-0000-7000-8000-000000000001";
  const exportId = "01998b9a-0000-7000-8000-000000000900";
  const listing = recorder(() => reply("admin.users.dataExports.list", "ok"));
  const listed = await new AdminClient(listing.http).dataExports(id);
  assert.equal(listing.calls[0]!.method, "GET");
  assert.ok(listing.calls[0]!.url.endsWith(`/admin/users/${id}/data-exports`));
  assert.equal(listed[0]!.status, "READY");

  const requesting = recorder(() => reply("admin.users.dataExports.create", "ok"));
  const created = await new AdminClient(requesting.http).requestDataExport(id, "KVKK erişim talebi, kimlik doğrulandı");
  assert.equal(requesting.calls[0]!.method, "POST");
  assert.deepEqual(requesting.calls[0]!.body, { reason: "KVKK erişim talebi, kimlik doğrulandı" });
  assert.equal(created.status, "PENDING");

  const delivering = recorder(() => reply("admin.users.dataExports.deliver", "ok"));
  const delivered = await new AdminClient(delivering.http).deliverDataExport(id, exportId, "Kimlik doğrulandı, paket gönderilsin");
  assert.ok(delivering.calls[0]!.url.endsWith(`/admin/users/${id}/data-exports/${exportId}/deliver`));
  assert.deepEqual(Object.keys(delivered).sort(), ["linkExpiresAt", "sent"]);

  const notReady = recorder(() => reply("admin.users.dataExports.deliver", "not-ready"));
  await assert.rejects(new AdminClient(notReady.http).deliverDataExport(id, exportId, "Kimlik doğrulandı, paket gönderilsin"), (e) => e instanceof UiError && e.code === "CONFLICT");
  const restricted = recorder(() => reply("admin.users.dataExports.create", "restricted"));
  await assert.rejects(new AdminClient(restricted.http).requestDataExport(id, "KVKK erişim talebi, kimlik doğrulandı"), (e) => e instanceof UiError && e.code === "CONFLICT");
});

test("kullanıcı istemcisi: indirme yalnız token gönderir ve paketi sözleşmeyle doğrular; geçersiz bağlantı yüzeye çıkar", async () => {
  const ok = new ApiClient("http://api.test", async (url, init) => {
    assert.ok(String(url).endsWith("/me/data-export/download"));
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(init!.body as string), { token: TOKEN });
    return reply("dataExports.download", "ok");
  });
  const pkg = await ok.downloadDataExport(TOKEN);
  assert.equal(pkg.schemaVersion, 1);
  assert.ok(Array.isArray(pkg.collections.polls));

  const invalid = new ApiClient("http://api.test", async () => reply("dataExports.download", "invalid-token"));
  await assert.rejects(invalid.downloadDataExport(TOKEN), (e) => e instanceof UiError && e.code === "TOKEN_INVALID_OR_EXPIRED");
});

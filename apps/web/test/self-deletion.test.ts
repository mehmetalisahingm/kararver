// Kendi hesabını silme (#181) web tarafı: bağlantı ayrıştırma, güvenli varsayılan, metinler ve istemci çağrıları.
import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { deletionError, deletionResultMessage, deletionStatusLine, describeDeletionLink, parseDeletionLink, SELF_BLOCKER_TEXT } from "../src/features/account/deletion-model.ts";
import { ApiClient } from "../src/lib/api-client.ts";
import { UiError } from "../src/lib/model.ts";

const TOKEN = "bXlfZGVsZXRpb25fdG9rZW5fZm9yX2ZpeHR1cmVz";

test("bağlantı: token ve aksiyon fragment'tan okunur; token yoksa bağlantı yok; bilinmeyen/eksik aksiyon asla silme sayılmaz (güvenli yön iptal)", () => {
  assert.deepEqual(parseDeletionLink(`#token=${TOKEN}&action=confirm`), { token: TOKEN, action: "confirm" });
  assert.deepEqual(parseDeletionLink(`#token=${TOKEN}&action=cancel`), { token: TOKEN, action: "cancel" });
  assert.deepEqual(parseDeletionLink(`#token=${TOKEN}`), { token: TOKEN, action: "cancel" });
  assert.deepEqual(parseDeletionLink(`#token=${TOKEN}&action=delete`), { token: TOKEN, action: "cancel" });
  assert.equal(parseDeletionLink(""), null);
  assert.equal(parseDeletionLink("#action=confirm"), null);
});

test("bağlantı metni: silme geri alınamazlığı açıkça söyler ve tehlike düğmesidir; iptal 'bu ben değilim' der ve tehlike değildir", () => {
  const confirm = describeDeletionLink({ token: TOKEN, action: "confirm" });
  const cancel = describeDeletionLink({ token: TOKEN, action: "cancel" });
  assert.match(confirm.body, /geri alınamaz/);
  assert.match(confirm.button, /kalıcı olarak sil/i);
  assert.equal(confirm.danger, true);
  assert.match(cancel.button, /bu ben değilim/i);
  assert.match(cancel.body, /oturum/);
  assert.equal(cancel.danger, false);
  assert.notEqual(confirm.title, cancel.title);
});

test("sonuç metinleri: silindi oturumların kapandığını, iptal güvenlik önerisini söyler", () => {
  assert.match(deletionResultMessage("deleted"), /kalıcı olarak silindi/);
  assert.match(deletionResultMessage("unchanged"), /zaten silinmiş/);
  assert.match(deletionResultMessage("cancelled"), /şifreni değiştir/i);
});

test("hata metni: geçersiz bağlantı yeniden denenmez; 409 sunucu metnini gösterir; ağ hatası yeniden denenir", () => {
  const invalid = deletionError(new UiError("TOKEN_INVALID_OR_EXPIRED", "x"));
  assert.equal(invalid.retryable, false);
  assert.match(invalid.message, /geçersiz|süresi dolmuş/);
  const blocked = deletionError(new UiError("CONFLICT", SELF_BLOCKER_TEXT.legal_hold));
  assert.equal(blocked.retryable, false);
  assert.match(blocked.message, /saklama yükümlülüğü/);
  assert.equal(deletionError(new UiError("NETWORK_ERROR", "Sunucuya ulaşılamadı.")).retryable, true);
});

test("engel metinleri: her engel için var, yasal saklamanın gerekçesi/ayrıntısı yok; rol ve saklama destek yönlendirir", () => {
  for (const code of ["legal_hold", "active_sanction", "has_role", "export_in_progress"] as const) assert.ok(SELF_BLOCKER_TEXT[code].length > 20, code);
  assert.match(SELF_BLOCKER_TEXT.legal_hold, /Destek/);
  assert.match(SELF_BLOCKER_TEXT.has_role, /Destek/);
});

test("durum satırı: açık talep onay beklediğini ve hesabın silinmediğini söyler", () => {
  const base = { id: "01998b9a-0000-7000-8000-000000000920", expiresAt: "2026-09-28T09:00:00.000Z", createdAt: "2026-09-27T09:00:00.000Z", finishedAt: null, failure: null };
  assert.match(deletionStatusLine({ ...base, status: "OPEN" }), /silinmez/);
  assert.match(deletionStatusLine({ ...base, status: "EXPIRED" }), /silinmedi/);
  assert.match(deletionStatusLine({ ...base, status: "CANCELLED" }), /iptal/);
});

function reply(endpoint: string, name: string) {
  const e = structuredClone(examples.find((x) => x.endpoint === endpoint && x.name === name)!);
  return new Response(e.body === null ? null : JSON.stringify(e.body), { status: e.status });
}
type Seen = { url: string; method: string; body: unknown };
function api(respond: () => Response) {
  const calls: Seen[] = [];
  const client = new ApiClient("http://api.test", async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : undefined });
    return respond();
  });
  return { client, calls };
}

test("istemci: önizleme/talep/iptal/onay/bağlantı iptali doğru endpoint'e gider ve yanıtlar sözleşmeyle doğrulanır; hata kodları yüzeye çıkar", async () => {
  const preview = api(() => reply("me.deletion.preview", "ok"));
  const view = await preview.client.getDeletionPreview();
  assert.equal(preview.calls[0]!.method, "GET");
  assert.ok(preview.calls[0]!.url.endsWith("/me/deletion"));
  assert.equal(view.canRequest, true);
  assert.equal((await api(() => reply("me.deletion.preview", "blocked")).client.getDeletionPreview()).blockers[0], "legal_hold");
  assert.equal((await api(() => reply("me.deletion.preview", "pending")).client.getDeletionPreview()).request?.status, "OPEN");

  const req = api(() => reply("me.deletion.request", "ok"));
  assert.equal((await req.client.requestDeletion("guclu-bir-sifre-1", "deniz")).status, "CONFIRMATION_SENT");
  assert.equal(req.calls[0]!.method, "POST");
  assert.deepEqual(req.calls[0]!.body, { password: "guclu-bir-sifre-1", confirmUsername: "deniz" });
  for (const [name, code] of [["wrong-password", "INVALID_CREDENTIALS"], ["mismatch", "CONFLICT"], ["mfa-required", "CONFLICT"], ["disabled", "FEATURE_DISABLED"]] as const) {
    await assert.rejects(api(() => reply("me.deletion.request", name)).client.requestDeletion("x", "deniz"), (e) => e instanceof UiError && e.code === code, name);
  }

  const cancel = api(() => reply("me.deletion.cancel", "ok"));
  assert.deepEqual(await cancel.client.cancelDeletion(), { cancelled: true });
  assert.equal(cancel.calls[0]!.method, "DELETE");

  const confirm = api(() => reply("auth.deletion.confirm", "deleted"));
  assert.deepEqual(await confirm.client.confirmDeletion(TOKEN), { status: "deleted" });
  assert.deepEqual(confirm.calls[0]!.body, { token: TOKEN });
  assert.ok(confirm.calls[0]!.url.endsWith("/auth/deletion/confirm"));
  assert.deepEqual(await api(() => reply("auth.deletion.confirm", "unchanged")).client.confirmDeletion(TOKEN), { status: "unchanged" });
  await assert.rejects(api(() => reply("auth.deletion.confirm", "invalid")).client.confirmDeletion(TOKEN), (e) => e instanceof UiError && e.code === "TOKEN_INVALID_OR_EXPIRED");
  await assert.rejects(api(() => reply("auth.deletion.confirm", "blocked")).client.confirmDeletion(TOKEN), (e) => e instanceof UiError && e.code === "CONFLICT");

  const link = api(() => reply("auth.deletion.cancel", "ok"));
  await link.client.cancelDeletionByLink(TOKEN);
  assert.ok(link.calls[0]!.url.endsWith("/auth/deletion/cancel"));
  await assert.rejects(api(() => reply("auth.deletion.cancel", "already-deleted")).client.cancelDeletionByLink(TOKEN), (e) => e instanceof UiError && e.code === "CONFLICT");
});

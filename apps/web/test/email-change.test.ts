// E-posta değişimi (#181) web tarafı: bağlantı ayrıştırma, metinler ve istemci çağrıları.
import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { AdminClient } from "../src/features/admin/admin-client.ts";
import { describeLink, emailChangeError, parseLink, resultMessage, statusLine } from "../src/features/account/email-change-model.ts";
import { ApiClient } from "../src/lib/api-client.ts";
import { HttpClient } from "../src/lib/http-client.ts";
import { UiError } from "../src/lib/model.ts";

const ID = "01998b9a-0000-7000-8000-000000000001";
const TOKEN = "bXlfZW1haWxfY2hhbmdlX3Rva2VuX2Zvcl9maXh0dXJlcw";

test("bağlantı: token ve adım/aksiyon fragment'tan okunur; token yoksa bağlantı yok, bilinmeyen değerler yok sayılır", () => {
  assert.deepEqual(parseLink(`#token=${TOKEN}&step=new`), { token: TOKEN, step: "new", action: null });
  assert.deepEqual(parseLink(`#token=${TOKEN}&step=old&action=deny`), { token: TOKEN, step: "old", action: "deny" });
  assert.deepEqual(parseLink(`#token=${TOKEN}&step=x&action=y`), { token: TOKEN, step: null, action: null });
  assert.equal(parseLink(""), null);
  assert.equal(parseLink("#step=new"), null);
});

test("bağlantı metni: yeni adres doğrulama, eski adres onayı ve reddet ayrı başlık ve düğme taşır; ret tehlike olarak işaretlenir", () => {
  const verify = describeLink({ token: TOKEN, step: "new", action: null });
  const approve = describeLink({ token: TOKEN, step: "old", action: "approve" });
  const deny = describeLink({ token: TOKEN, step: "old", action: "deny" });
  assert.match(verify.button, /doğrula/i);
  assert.match(approve.button, /onayla/i);
  assert.match(deny.button, /reddet/i);
  assert.deepEqual([verify.deny, approve.deny, deny.deny], [false, false, true]);
  assert.equal(new Set([verify.title, approve.title, deny.title]).size, 3);
});

test("sonuç metinleri: uygulandı oturumların kapandığını, ret güvenlik önerisini, bekleme eksik adımı söyler", () => {
  assert.match(resultMessage("applied", "old"), /oturum.*kapatıldı/);
  assert.match(resultMessage("denied", "old"), /şifreni değiştir/);
  assert.match(resultMessage("waiting", "new"), /diğer onay/);
  assert.match(resultMessage("waiting", "old"), /yeni adres/);
});

test("hata metni: geçersiz bağlantı yeniden denenmez ve talep varlığını ele vermez; 409 sunucu metnini gösterir; ağ hatası yeniden denenir", () => {
  const invalid = emailChangeError(new UiError("TOKEN_INVALID_OR_EXPIRED", "x"));
  assert.equal(invalid.retryable, false);
  assert.match(invalid.message, /geçersiz|süresi dolmuş/);
  const conflict = emailChangeError(new UiError("CONFLICT", "Yeni e-posta adresi bu arada başka bir hesapta kullanıldı; talep sonlandı."));
  assert.equal(conflict.retryable, false);
  assert.match(conflict.message, /başka bir hesapta/);
  assert.equal(emailChangeError(new UiError("NETWORK_ERROR", "Sunucuya ulaşılamadı.")).retryable, true);
  assert.equal(emailChangeError(new Error("beklenmeyen")).retryable, true);
});

test("durum satırı: açık talepte hangi onayların beklendiği, sonlanmış talepte sonuç yazılır", () => {
  const open = { status: "OPEN", newEmailMasked: "y***@example.test", requiresOld: true, newConfirmed: true, oldConfirmed: false };
  assert.match(statusLine(open), /y\*\*\*@example\.test/);
  assert.match(statusLine(open), /eski adresin onayı/);
  assert.doesNotMatch(statusLine(open), /yeni adresin doğrulanması/);
  assert.match(statusLine({ ...open, newConfirmed: false, oldConfirmed: false }), /yeni adresin doğrulanması ve eski adresin onayı/);
  assert.doesNotMatch(statusLine({ ...open, requiresOld: false, newConfirmed: false }), /eski adresin onayı/);
  assert.match(statusLine({ ...open, status: "DENIED" }), /reddedildi/);
  assert.match(statusLine({ ...open, status: "COMPLETED" }), /tamamlandı/);
});

function reply(endpoint: string, name: string) {
  const e = structuredClone(examples.find((x) => x.endpoint === endpoint && x.name === name)!);
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

test("kullanıcı istemcisi: başlat/durum/iptal/onay/ret doğru endpoint'e gider ve yanıtlar sözleşmeyle doğrulanır; hata kodları yüzeye çıkar", async () => {
  const api = (respond: () => Response) => {
    const r = recorder(respond);
    return { client: new ApiClient("http://api.test", async (url, init) => {
      r.calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : undefined });
      return respond();
    }), calls: r.calls };
  };
  const a = api(() => reply("me.emailChange.request", "ok"));
  assert.equal((await a.client.requestEmailChange("yeni@example.test", "guclu-bir-sifre-1")).status, "VERIFICATION_SENT");
  assert.equal(a.calls[0]!.method, "POST");
  assert.ok(a.calls[0]!.url.endsWith("/me/email-change"));
  assert.deepEqual(a.calls[0]!.body, { newEmail: "yeni@example.test", password: "guclu-bir-sifre-1" });

  const wrong = api(() => reply("me.emailChange.request", "wrong-password"));
  await assert.rejects(wrong.client.requestEmailChange("yeni@example.test", "yanlis-parola-123"), (e) => e instanceof UiError && e.code === "INVALID_CREDENTIALS");
  const off = api(() => reply("me.emailChange.request", "disabled"));
  await assert.rejects(off.client.requestEmailChange("yeni@example.test", "guclu-bir-sifre-1"), (e) => e instanceof UiError && e.code === "FEATURE_DISABLED");

  const got = api(() => reply("me.emailChange.get", "open"));
  const view = await got.client.getEmailChange();
  assert.equal(view?.status, "OPEN");
  assert.equal(view?.newEmailMasked, "y***@example.test");
  assert.equal(await api(() => reply("me.emailChange.get", "none")).client.getEmailChange(), null);

  const cancel = api(() => reply("me.emailChange.cancel", "ok"));
  assert.deepEqual(await cancel.client.cancelEmailChange(), { cancelled: true });
  assert.equal(cancel.calls[0]!.method, "DELETE");

  const waiting = api(() => reply("auth.emailChange.confirm", "waiting"));
  assert.deepEqual(await waiting.client.confirmEmailChange(TOKEN), { status: "waiting", step: "new" });
  assert.deepEqual(waiting.calls[0]!.body, { token: TOKEN });
  assert.ok(waiting.calls[0]!.url.endsWith("/auth/email-change/confirm"));
  assert.equal((await api(() => reply("auth.emailChange.confirm", "applied")).client.confirmEmailChange(TOKEN)).status, "applied");
  await assert.rejects(api(() => reply("auth.emailChange.confirm", "invalid")).client.confirmEmailChange(TOKEN), (e) => e instanceof UiError && e.code === "TOKEN_INVALID_OR_EXPIRED");
  await assert.rejects(api(() => reply("auth.emailChange.confirm", "taken")).client.confirmEmailChange(TOKEN), (e) => e instanceof UiError && e.code === "CONFLICT");

  const denied = api(() => reply("auth.emailChange.deny", "ok"));
  await denied.client.denyEmailChange(TOKEN);
  assert.ok(denied.calls[0]!.url.endsWith("/auth/email-change/deny"));
  await assert.rejects(api(() => reply("auth.emailChange.deny", "already-applied")).client.denyEmailChange(TOKEN), (e) => e instanceof UiError && e.code === "CONFLICT");
});

test("yönetici istemcisi: liste maskeli adres döner; başlat gerekçeyle gider; iptal gerekçeyle gider; açık talep varken 409", async () => {
  const list = recorder(() => reply("admin.users.emailChange.list", "ok"));
  const items = await new AdminClient(list.http).emailChanges(ID);
  assert.ok(list.calls[0]!.url.endsWith(`/admin/users/${ID}/email-change`));
  assert.equal(items[0]!.newEmailMasked, "y***@example.test");

  const start = recorder(() => reply("admin.users.emailChange.start", "ok"));
  const started = await new AdminClient(start.http).startEmailChange(ID, "yeni@example.test", "Eski adrese erişim kaybı; kimlik destek kanalında doğrulandı");
  assert.equal(start.calls[0]!.method, "POST");
  assert.deepEqual(start.calls[0]!.body, { newEmail: "yeni@example.test", reason: "Eski adrese erişim kaybı; kimlik destek kanalında doğrulandı" });
  assert.equal(started.status, "VERIFICATION_SENT");

  const open = recorder(() => reply("admin.users.emailChange.start", "request-open"));
  await assert.rejects(new AdminClient(open.http).startEmailChange(ID, "yeni@example.test", "Eski adrese erişim kaybı; kimlik destek kanalında doğrulandı"), (e) => e instanceof UiError && e.code === "CONFLICT");

  const cancel = recorder(() => reply("admin.users.emailChange.cancel", "ok"));
  assert.deepEqual(await new AdminClient(cancel.http).cancelEmailChange(ID, "Destek talebi vazgeçildi"), { cancelled: true });
  assert.ok(cancel.calls[0]!.url.endsWith(`/admin/users/${ID}/email-change/cancel`));
});

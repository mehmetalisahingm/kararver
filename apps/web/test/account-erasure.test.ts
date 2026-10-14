// Hesap anonimleştirme ekranı (#181, KV-33 §10): saf model ve yönetici istemcisi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { AdminClient } from "../src/features/admin/admin-client.ts";
import { BLOCKER_TEXT, confirmationMatches, removalLines, retainedLine } from "../src/features/admin/erasure-model.ts";
import { HttpClient } from "../src/lib/http-client.ts";
import { UiError } from "../src/lib/model.ts";

const ID = "01998b9a-0000-7000-8000-000000000001";
const REASON = "KVKK silme talebi; kimlik destek kanalında doğrulandı";

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

test("yazılı teyit: büyük/küçük harf ve baştaki @ önemsiz, boş veya farklı ad geçmez (sunucu kuralıyla aynı)", () => {
  assert.equal(confirmationMatches("deniz", "deniz"), true);
  assert.equal(confirmationMatches("  @Deniz ", "deniz"), true);
  assert.equal(confirmationMatches("", "deniz"), false);
  assert.equal(confirmationMatches("@", "deniz"), false);
  assert.equal(confirmationMatches("deniz2", "deniz"), false);
  assert.equal(confirmationMatches("deniz@example.test", "deniz"), false);
});

test("etki özeti: yalnız sıfırdan büyük kalemler yazılır; korunan içerik anonim kalacağını söyler", () => {
  const will = { polls: 0, comments: 0, media: 0, sessions: 2, dataExports: 0, avatar: 1, communityMemberships: 3, ownedCommunities: 1, pendingCommunityRequests: 0, preferences: 7 };
  assert.deepEqual(removalLines(will), [
    "2 açık oturum",
    "1 profil görseli",
    "3 topluluk üyeliği",
    "1 sahip olunan topluluk (yönetici yönetimine döner)",
    "7 tercih, takip, kayıt ve ilgi alanı kaydı",
  ]);
  assert.deepEqual(removalLines({ ...will, sessions: 0, avatar: 0, communityMemberships: 0, ownedCommunities: 0, preferences: 0 }), []);
  assert.match(retainedLine({ polls: 0, comments: 0, votes: 30, reportsFiled: 1 }), /30 oyun hesapla bağı kaldırılarak/);
});

test("engel metinleri sözleşmedeki her engel için var ve yönlendirici", () => {
  for (const code of ["legal_hold", "active_sanction", "has_role", "export_in_progress"] as const) assert.ok(BLOCKER_TEXT[code].length > 20, code);
  assert.match(BLOCKER_TEXT.has_role, /önce rolü kaldır/);
});

test("yönetici istemcisi: önizleme GET, anonimleştirme POST (gerekçe + teyit), saklama PUT/POST doğru endpoint'e gider", async () => {
  const pv = recorder(() => reply("admin.users.erasure.preview", "ok"));
  const preview = await new AdminClient(pv.http).erasurePreview(ID);
  assert.equal(pv.calls[0]!.method, "GET");
  assert.ok(pv.calls[0]!.url.endsWith(`/admin/users/${ID}/erasure`));
  assert.equal(preview.canAnonymize, true);
  assert.equal(preview.username, "deniz");

  const blocked = recorder(() => reply("admin.users.erasure.preview", "blocked"));
  const b = await new AdminClient(blocked.http).erasurePreview(ID);
  assert.deepEqual(b.blockers, ["legal_hold", "active_sanction"]);
  assert.equal(b.legalHold?.reason, "Devam eden hukuki süreç nedeniyle saklama");

  const erase = recorder(() => reply("admin.users.erasure.create", "ok"));
  const done = await new AdminClient(erase.http).anonymizeUser(ID, REASON, "deniz");
  assert.equal(erase.calls[0]!.method, "POST");
  assert.ok(erase.calls[0]!.url.endsWith(`/admin/users/${ID}/erasure`));
  assert.deepEqual(erase.calls[0]!.body, { reason: REASON, confirmUsername: "deniz" });
  assert.equal(done.status, "anonymized");

  const again = recorder(() => reply("admin.users.erasure.create", "unchanged"));
  assert.equal((await new AdminClient(again.http).anonymizeUser(ID, REASON, "deniz")).status, "unchanged");

  for (const name of ["mismatch", "legal-hold"]) {
    const rejected = recorder(() => reply("admin.users.erasure.create", name));
    await assert.rejects(new AdminClient(rejected.http).anonymizeUser(ID, REASON, "deniz"), (e) => e instanceof UiError && e.code === "CONFLICT");
  }

  const hold = recorder(() => reply("admin.users.legalHold.put", "ok"));
  const placed = await new AdminClient(hold.http).putLegalHold(ID, "Devam eden hukuki süreç nedeniyle saklama");
  assert.equal(hold.calls[0]!.method, "PUT");
  assert.ok(hold.calls[0]!.url.endsWith(`/admin/users/${ID}/legal-hold`));
  assert.equal(placed.legalHold.placedById.length > 0, true);

  const release = recorder(() => reply("admin.users.legalHold.release", "ok"));
  assert.deepEqual(await new AdminClient(release.http).releaseLegalHold(ID, "Hukuki süreç sona erdi"), { legalHold: null });
  assert.equal(release.calls[0]!.method, "POST");
  assert.ok(release.calls[0]!.url.endsWith(`/admin/users/${ID}/legal-hold/release`));
});

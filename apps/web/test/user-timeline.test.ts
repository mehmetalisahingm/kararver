// Kullanıcı birleşik geçmişi (#183) web tarafı: süzgeç → sorgu, satır metni, özet çipleri ve istemci çağrıları.
import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { AdminClient } from "../src/features/admin/admin-client.ts";
import { HttpClient } from "../src/lib/http-client.ts";
import { UiError } from "../src/lib/model.ts";
import { TIMELINE_KINDS, contentIdProblem, describeItem, emptyFilter, kindLabels, summaryChips, toQuery } from "../src/features/admin/timeline-model.ts";

const USER = "01998b9a-0000-7000-8000-000000000001";
const COMMUNITY = "01998b9a-0000-7000-8000-000000000940";
const POLL = "01998b9a-0000-7000-8000-000000000960";

function reply(endpoint: string, name: string) {
  const e = structuredClone(examples.find((x) => x.endpoint === endpoint && x.name === name)!);
  return new Response(e.body === null ? null : JSON.stringify(e.body), { status: e.status });
}
function admin(respond: () => Response) {
  const calls: string[] = [];
  const client = new AdminClient(new HttpClient("http://api.test", async (url) => { calls.push(String(url)); return respond(); }));
  return { client, calls };
}

test("süzgeç → sorgu: boş süzgeç sorgu üretmez; tür listesi sıralı gider; hepsi seçiliyse tür süzgeci yok sayılır", () => {
  assert.deepEqual(toQuery(emptyFilter()), {});
  assert.equal(toQuery({ ...emptyFilter(), kinds: new Set(["SANCTION", "POLL"] as const) }).kinds, "POLL,SANCTION");
  assert.equal(toQuery({ ...emptyFilter(), kinds: new Set(TIMELINE_KINDS) }).kinds, undefined);
});

test("süzgeç → sorgu: geçersiz UUID gönderilmez; bitiş günü kapsayıcıdır (ertesi gün 00:00)", () => {
  const q = toQuery({ ...emptyFilter(), communityId: COMMUNITY, contentId: ` ${POLL} `, from: "2026-09-01", to: "2026-09-30" });
  assert.equal(q.communityId, COMMUNITY);
  assert.equal(q.contentId, POLL);
  assert.equal(q.from, new Date("2026-09-01T00:00:00").toISOString());
  assert.equal(q.to, new Date("2026-10-01T00:00:00").toISOString());
  const bad = toQuery({ ...emptyFilter(), communityId: "x", contentId: "abc" });
  assert.deepEqual(bad, {});
  assert.equal(contentIdProblem("abc"), "İçerik kimliği geçerli bir UUID olmalı.");
  assert.equal(contentIdProblem(""), null);
  assert.equal(contentIdProblem(POLL), null);
});

test("istemci: zaman çizgisi GET sorgusu süzgeç + sayfa boyutunu taşır; satır metinleri ve etiketler eksiksiz", async () => {
  const a = admin(() => reply("admin.users.timeline", "ok"));
  const result = await a.client.userTimeline(USER, { kinds: "POLL,COMMENT", communityId: COMMUNITY });
  assert.ok(a.calls[0]!.includes(`/admin/users/${USER}/timeline?`));
  assert.ok(a.calls[0]!.includes("kinds=POLL%2CCOMMENT") || a.calls[0]!.includes("kinds=POLL,COMMENT"));
  assert.ok(a.calls[0]!.includes("limit=30"));
  assert.ok(result.items.length > 0);
  assert.ok(result.items.every((i) => kindLabels[i.kind] && describeItem(i) !== undefined));
  const moderation = result.items.find((i) => i.kind === "MODERATION")!;
  assert.match(describeItem(moderation), /Gerekçe: Moderatör incelemesi · @moderator/);
  const report = result.items.find((i) => i.kind === "REPORT_AGAINST")!;
  assert.match(describeItem(report), /Taciz/);
});

test("özet: yalnız sayısı > 0 olan türler çip olur; geçersiz imleç hata olarak yüzeye çıkar", async () => {
  const a = admin(() => reply("admin.users.timeline.summary", "ok"));
  const summary = await a.client.userTimelineSummary(USER);
  assert.ok(a.calls[0]!.endsWith(`/admin/users/${USER}/timeline/summary`));
  const chips = summaryChips(summary.counts);
  assert.ok(chips.length > 0 && chips.every((c) => c.count > 0));
  assert.equal(chips.some((c) => c.kind === "MODERATION_BY"), false, "sıfır sayılı tür çip olmaz");

  const bad = admin(() => reply("admin.users.timeline", "invalid-cursor"));
  await assert.rejects(bad.client.userTimeline(USER, {}, "eski"), (e) => e instanceof UiError && e.code === "INVALID_CURSOR");
});

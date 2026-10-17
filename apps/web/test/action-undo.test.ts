// Tek moderasyon kararının geri alınması (#183, KV-37 §10) web tarafı: öneri kuralı, özet metinleri ve istemci çağrıları.
import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { AdminClient, type HistoryAction } from "../src/features/admin/admin-client.ts";
import { actionUndoBlockedLabels, actionUndoSummary, canOfferActionUndo, undoActionLabels } from "../src/features/admin/bulk-model.ts";
import { HttpClient } from "../src/lib/http-client.ts";
import { UiError } from "../src/lib/model.ts";

const ACTION = "01998b9a-0000-7000-8000-000000000061";
const DIGEST = "c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2";

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
const actor = (id: string) => ({ id, username: id, displayName: id, avatarUrl: null });

test("öneri kuralı: yalnız geri alınabilir türde, geri alınmamış, geri alma olmayan karar; moderatör yalnız kendi kararını görür", () => {
  const base = { action: "HIDE" as HistoryAction["action"], undone: false, undoOfId: null, actor: actor("u1") };
  assert.equal(canOfferActionUndo(base, "u1", false), true, "moderatör kendi kararı");
  assert.equal(canOfferActionUndo(base, "u2", false), false, "moderatör başkasının kararı");
  assert.equal(canOfferActionUndo(base, "u2", true), true, "ADMIN+ herkesinki");
  assert.equal(canOfferActionUndo(base, null, false), false, "kimlik bilinmiyorsa moderatöre önerilmez");
  assert.equal(canOfferActionUndo({ ...base, undone: true }, "u1", true), false, "zaten geri alınmış");
  assert.equal(canOfferActionUndo({ ...base, undoOfId: "x" }, "u1", true), false, "geri alma kararı");
  for (const action of ["WARN_USER", "SANCTION_USER", "DISMISS_REPORT", "MOVE", "APPROVE", "REJECT"]) assert.equal(canOfferActionUndo({ ...base, action: action as never }, "u1", true), false, action);
  for (const action of ["HIDE", "REMOVE", "RESTORE", "LOCK", "UNLOCK", "EXCLUDE_FROM_TRENDS", "INCLUDE_IN_TRENDS", "CLOSE_COMMENTS", "OPEN_COMMENTS"]) {
    assert.equal(canOfferActionUndo({ ...base, action: action as never }, "u1", true), true, action);
    assert.ok(undoActionLabels[action], `${action} için telafi etiketi`);
  }
});

test("istemci: önizleme GET, geri alma gerekçe + özetle POST; sonuç telafi kaydını gösterir", async () => {
  const p = admin(() => reply("admin.moderation.actions.undoPreview", "ok"));
  const preview = await p.client.actionUndoPreview(ACTION);
  assert.equal(p.calls[0]!.method, "GET");
  assert.ok(p.calls[0]!.url.endsWith(`/admin/moderation/actions/${ACTION}/undo/preview`));
  assert.equal(preview.outcome, "WILL_UNDO");
  assert.match(actionUndoSummary(preview), /Şimdiki durum ACTIVE; telafi kararı: Yorumları aç\./);
  assert.match(actionUndoSummary(preview), /^“Bu karar doğru mu\?”/);

  const u = admin(() => reply("admin.moderation.actions.undo", "ok"));
  const result = await u.client.undoAction(ACTION, "Yanlış karar: yorumlar yeniden açılıyor", DIGEST);
  assert.equal(u.calls[0]!.method, "POST");
  assert.ok(u.calls[0]!.url.endsWith(`/admin/moderation/actions/${ACTION}/undo`));
  assert.deepEqual(u.calls[0]!.body, { reason: "Yanlış karar: yorumlar yeniden açılıyor", digest: DIGEST });
  assert.equal(result.undoOfId, ACTION);
});

test("engelli karar: özet ve neden metni; eski özet ve araya girmiş karar 409 olarak yüzeye çıkar", async () => {
  const p = admin(() => reply("admin.moderation.actions.undoPreview", "superseded"));
  const preview = await p.client.actionUndoPreview(ACTION);
  assert.equal(preview.outcome, "BLOCKED");
  assert.equal(preview.blocked, "status_changed");
  assert.match(actionUndoSummary(preview), /şimdi geri alınamaz/);
  for (const code of ["forbidden", "admin_required", "not_reversible", "is_undo", "status_changed", "superseded", "author_erased"]) assert.ok(actionUndoBlockedLabels[code], code);

  for (const name of ["stale", "superseded"]) {
    const u = admin(() => reply("admin.moderation.actions.undo", name));
    await assert.rejects(u.client.undoAction(ACTION, "Yanlış karar: geri alınıyor", DIGEST), (e) => e instanceof UiError && e.code === "CONFLICT", name);
  }
});

test("geçmiş: eylem satırları undoOfId ve undone taşır", async () => {
  const h = admin(() => reply("admin.moderation.history.polls", "ok"));
  const page = await h.client.history("polls", "01998b9a-0000-7000-8000-000000000940");
  const actions = page.items.filter((i) => i.kind === "ACTION");
  assert.ok(actions.length >= 2);
  assert.ok(actions.some((i) => i.kind === "ACTION" && i.undone), "geri alınmış karar işaretli");
});

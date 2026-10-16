// Toplu moderasyon ikinci onayı (#183, KV-37 §8) web tarafı: eşik uyarısı, 200/202 ayrımı, talep istemcisi ve karar kuralları.
import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { AdminClient } from "../src/features/admin/admin-client.ts";
import { approvalActions, approvalNotice, approvalStatusLabels, pendingMessage } from "../src/features/admin/bulk-model.ts";
import { HttpClient } from "../src/lib/http-client.ts";
import { UiError } from "../src/lib/model.ts";

const IDS = ["01998b9a-0000-7000-8000-000000000940", "01998b9a-0000-7000-8000-000000000941", "01998b9a-0000-7000-8000-000000000942"];
const DIGEST = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const APPROVAL = "01998b9a-0000-7000-8000-000000000960";

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

test("bulkApply: 200 uygulanmış parti, 202 bekleyen onay talebi olarak ayrışır; talep içerik değiştirmediğini söyler", async () => {
  const done = admin(() => reply("admin.moderation.polls.bulk", "ok"));
  const applied = await done.client.bulkApply("polls", { ids: IDS, action: "HIDE", reason: "Spam dalgası temizliği", digest: DIGEST });
  assert.equal(applied.kind, "applied");

  const pending = admin(() => reply("admin.moderation.polls.bulk", "approval-required"));
  const outcome = await pending.client.bulkApply("polls", { ids: IDS, action: "HIDE", reason: "Spam dalgası temizliği", digest: DIGEST });
  assert.equal(outcome.kind, "pending");
  if (outcome.kind !== "pending") return;
  assert.equal(outcome.approval.status, "PENDING");
  assert.match(pendingMessage(outcome.approval), /24 kayıt için ikinci onay talebi açıldı; başka bir yönetici onaylayana kadar hiçbir şey değişmez/);

  const many = admin(() => reply("admin.moderation.polls.bulk", "too-many-pending"));
  await assert.rejects(many.client.bulkApply("polls", { ids: IDS, action: "HIDE", reason: "Spam dalgası temizliği", digest: DIGEST }), (e) => e instanceof UiError && e.code === "CONFLICT");
});

test("önizleme uyarısı: yalnız ikinci onay gerekince, eşik ve pencere sayılarıyla; gerekmezse metin yok", async () => {
  const a = admin(() => reply("admin.moderation.polls.bulkPreview", "ok"));
  const preview = await a.client.bulkPreview("polls", IDS, "HIDE");
  assert.equal(preview.approval.required, false);
  assert.equal(approvalNotice(preview), null);
  assert.equal(approvalNotice(null), null);
  const required = { ...preview, approval: { required: true, threshold: 20, windowMinutes: 60, windowApplied: 5 } };
  const text = approvalNotice(required)!;
  assert.match(text, /son 60 dakikada onaysız 5 kayıt/);
  assert.match(text, /20 ve üstü ikinci onay gerektirir/);
  assert.match(text, /kayıtları değiştirmez/);
});

test("talep istemcisi: liste/ayrıntı GET, onay/ret/geri çekme gerekçeyle POST; step-up me.mfa.stepup'a kod yollar", async () => {
  const list = admin(() => reply("admin.moderation.bulkApprovals.list", "ok"));
  const page = await list.client.bulkApprovals("PENDING", undefined);
  assert.ok(list.calls[0]!.url.includes("/admin/moderation/bulk-approvals?"));
  assert.ok(list.calls[0]!.url.includes("status=PENDING") && list.calls[0]!.url.includes("limit=20"));
  assert.equal(page.items[0]!.status, "PENDING");

  const detail = admin(() => reply("admin.moderation.bulkApprovals.get", "ok"));
  const view = await detail.client.bulkApproval(APPROVAL);
  assert.ok(detail.calls[0]!.url.endsWith(`/admin/moderation/bulk-approvals/${APPROVAL}`));
  assert.equal(view.stale, false);
  assert.ok(view.items.length > 0);

  const ok = admin(() => reply("admin.moderation.bulkApprovals.approve", "ok"));
  const decision = await ok.client.approveBulk(APPROVAL, "Kayıtları inceledim");
  assert.equal(ok.calls[0]!.method, "POST");
  assert.ok(ok.calls[0]!.url.endsWith(`/admin/moderation/bulk-approvals/${APPROVAL}/approve`));
  assert.deepEqual(ok.calls[0]!.body, { reason: "Kayıtları inceledim" });
  assert.equal(decision.approval.status, "APPROVED");
  assert.equal(decision.result.summary.applied, 1);

  for (const [name, call, path] of [["reject", (c: AdminClient) => c.rejectBulk(APPROVAL, "Kapsam fazla geniş"), "reject"], ["cancel", (c: AdminClient) => c.cancelBulk(APPROVAL, "Vazgeçtim"), "cancel"]] as const) {
    const a = admin(() => reply(`admin.moderation.bulkApprovals.${name}`, "ok"));
    await call(a.client);
    assert.ok(a.calls[0]!.url.endsWith(`/${path}`));
  }

  const step = admin(() => new Response(JSON.stringify({ data: { expiresAt: "2026-09-28T09:05:00.000Z" } }), { status: 200 }));
  await step.client.stepUp("123456").catch(() => undefined);
  assert.ok(step.calls[0]!.url.endsWith("/me/mfa/step-up"));
  assert.deepEqual(step.calls[0]!.body, { code: "123456" });
});

test("hata yüzeyi: self_approval ve stepup_required 403, preview_stale ve closed 409 olarak kullanıcıya iletilir", async () => {
  for (const [name, status, code] of [["self-approval", 403, "FORBIDDEN"], ["stepup-required", 403, "FORBIDDEN"], ["stale", 409, "CONFLICT"], ["closed", 409, "CONFLICT"]] as const) {
    const a = admin(() => reply("admin.moderation.bulkApprovals.approve", name));
    await assert.rejects(a.client.approveBulk(APPROVAL, "Kayıtları inceledim"), (e) => e instanceof UiError && e.code === code, `${name} → ${status}`);
  }
});

test("karar kuralları: yalnız açık talepte; başlatan geri çeker, başka ADMIN+ onaylar/reddeder; kendi talebini onaylayamaz; moderatör karar veremez", () => {
  const mine = { status: "PENDING" as const, initiator: { id: "u1", username: "a", displayName: "A", avatarUrl: null } };
  assert.deepEqual(approvalActions(mine, "u1", true), { approve: false, reject: false, cancel: true });
  assert.deepEqual(approvalActions(mine, "u2", true), { approve: true, reject: true, cancel: false });
  assert.deepEqual(approvalActions(mine, "u2", false), { approve: false, reject: false, cancel: false });
  assert.deepEqual(approvalActions({ ...mine, status: "APPROVED" }, "u2", true), { approve: false, reject: false, cancel: false });
  assert.deepEqual(approvalActions(mine, null, true), { approve: true, reject: true, cancel: false }, "kimlik bilinmiyorsa sunucu self_approval ile engeller");
  for (const status of ["PENDING", "APPROVED", "REJECTED", "CANCELED", "EXPIRED"] as const) assert.ok(approvalStatusLabels[status]);
});

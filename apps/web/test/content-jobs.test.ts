// Toplu içerik işlemi (#181) web istemcisi: önizleme sorgusu, ayrı onay gövdesi, liste, geri alma, durdurma ve 409 yüzeye çıkışı.
import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { AdminClient } from "../src/features/admin/admin-client.ts";
import { HttpClient } from "../src/lib/http-client.ts";
import { UiError } from "../src/lib/model.ts";

const ID = "01998b9a-0000-7000-8000-000000000001";
const JOB = "01998b9a-0000-7000-8000-000000000910";

function reply(endpoint: string, name: string) {
  const e = structuredClone(examples.find((x) => x.endpoint === endpoint && x.name === name)!);
  return new Response(JSON.stringify(e.body), { status: e.status });
}
type Seen = { url: string; method: string; body: unknown };
function recorder(respond: () => Response) {
  const calls: Seen[] = [];
  const http = new HttpClient("http://api.test", async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : undefined });
    return respond();
  });
  return { admin: new AdminClient(http), calls };
}

test("önizleme: GET, işlem ve kapsam sorguda; yanıt sözleşmeyle doğrulanır ve hiçbir şey yazılmaz", async () => {
  const { admin, calls } = recorder(() => reply("admin.users.contentJobs.preview", "ok"));
  const preview = await admin.previewContentJob(ID, "REMOVE", "comments");
  assert.equal(calls[0]!.method, "GET");
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, `/v1/admin/users/${ID}/content-jobs/preview`);
  assert.deepEqual([url.searchParams.get("action"), url.searchParams.get("scope")], ["REMOVE", "comments"]);
  assert.equal(preview.total, preview.affected.polls + preview.affected.comments);
  assert.ok(preview.maxItems > 0);
});

test("onay: önizlemedeki cutoff ve sayılar gerekçeyle birlikte gövdede gider; kuyruğa alınan iş döner; 409 preview_stale yüzeye çıkar", async () => {
  const ok = recorder(() => reply("admin.users.contentJobs.create", "ok"));
  const job = await ok.admin.createContentJob(ID, { action: "HIDE", scope: "all", cutoffAt: "2026-09-27T09:00:00.000Z", expected: { polls: 2, comments: 5 }, reason: "Spam hesabı: tüm içerik gizlensin" });
  assert.equal(ok.calls[0]!.method, "POST");
  assert.ok(ok.calls[0]!.url.endsWith(`/admin/users/${ID}/content-jobs`));
  assert.deepEqual(ok.calls[0]!.body, { action: "HIDE", scope: "all", cutoffAt: "2026-09-27T09:00:00.000Z", expected: { polls: 2, comments: 5 }, reason: "Spam hesabı: tüm içerik gizlensin" });
  assert.equal(job.status, "QUEUED");

  const stale = recorder(() => reply("admin.users.contentJobs.create", "stale"));
  await assert.rejects(
    stale.admin.createContentJob(ID, { action: "HIDE", scope: "all", cutoffAt: "2026-09-27T09:00:00.000Z", expected: { polls: 2, comments: 5 }, reason: "Spam hesabı: tüm içerik gizlensin" }),
    (e) => e instanceof UiError && e.code === "CONFLICT",
  );
});

test("liste, geri alma ve durdurma: doğru yol ve gövde; canUndo ve sayaçlar sözleşmeden okunur", async () => {
  const listing = recorder(() => reply("admin.users.contentJobs.list", "ok"));
  const jobs = await listing.admin.contentJobs(ID);
  assert.equal(listing.calls[0]!.method, "GET");
  assert.equal(jobs[0]!.canUndo, true);
  assert.equal(jobs[0]!.applied, 7);

  const undoing = recorder(() => reply("admin.users.contentJobs.undo", "ok"));
  const undone = await undoing.admin.undoContentJob(ID, JOB, "Hesap yanlışlıkla işaretlenmişti");
  assert.ok(undoing.calls[0]!.url.endsWith(`/admin/users/${ID}/content-jobs/${JOB}/undo`));
  assert.deepEqual(undoing.calls[0]!.body, { reason: "Hesap yanlışlıkla işaretlenmişti" });
  assert.equal(undone.kind, "UNDO");

  const cancelling = recorder(() => reply("admin.users.contentJobs.cancel", "ok"));
  const cancelled = await cancelling.admin.cancelContentJob(ID, JOB, "Yanlış hesap seçilmiş");
  assert.ok(cancelling.calls[0]!.url.endsWith(`/admin/users/${ID}/content-jobs/${JOB}/cancel`));
  assert.equal(cancelled.status, "CANCELLED");
});

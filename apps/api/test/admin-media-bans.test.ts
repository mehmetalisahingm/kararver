/**
 * KV-38 (#40) yasaklı görsel listesi: admin.media.bans.list/create/delete ve admin.media.decide ile etkileşimi.
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL; CI'da tanımlı). Worker tarafı (sha256/dHash eşleşmesi):
 * apps/worker/test/job.test.ts.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { BannedMediaView, ErrorBody } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string };

describe("yasaklı görsel listesi (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let superAdmin: User;
  let admin: User;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    superAdmin = await signUp();
    await db.userRole.create({ data: { userId: superAdmin.id, role: "SUPER_ADMIN" } });
    admin = await staff("ADMIN");
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "GET" | "POST" | "DELETE", url: string, body?: unknown, cookie?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: { origin: WEB_ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function assertError(res: { statusCode: number; body: string; json(): any }, status: number, code: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `ban_${id}@example.test`, username: `ban_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  async function staff(role: "ADMIN" | "MODERATOR"): Promise<User> {
    const user = await signUp();
    await db.userRole.create({ data: { userId: user.id, role, grantedById: superAdmin.id } });
    return user;
  }

  const sha = () => createHash("sha256").update(randomBytes(16)).digest("hex");
  const phash = () => randomBytes(8).toString("hex");

  async function media(
    seed: { status?: "REJECTED" | "QUARANTINED" | "APPROVED"; sha?: string | null; phash?: string | null; processed?: boolean } = {},
  ) {
    const uploader = await signUp();
    const status = seed.status ?? "REJECTED";
    const key = `test/${randomUUID()}`;
    const processed = seed.processed ?? true;
    const row = await db.mediaAsset.create({
      data: {
        uploaderId: uploader.id,
        purpose: "POLL",
        status,
        originalObjectKey: `${key}/original`,
        processedObjectKey: processed ? `${key}/processed.webp` : null,
        contentSha256: seed.sha === undefined ? sha() : seed.sha,
        perceptualHash: seed.phash === undefined ? phash() : seed.phash,
        ...(status === "APPROVED" ? { publicObjectKey: `m/${randomUUID()}.webp` } : {}),
      },
    });
    if (processed) h.storage.put(row.processedObjectKey!, 1000, "image/webp");
    return row;
  }

  const ban = (cookie: string | undefined, mediaId: string, reason = "Kuralları ihlal eden görsel tekrar yüklendi") =>
    send("POST", "/admin/media/bans", { mediaId, reason }, cookie);
  const unban = (cookie: string | undefined, id: string) => send("DELETE", `/admin/media/bans/${id}`, undefined, cookie);
  const list = (cookie: string | undefined, query = "") => send("GET", `/admin/media/bans${query}`, undefined, cookie);

  // ─── Senaryolar ─────────────────────────────────────────────

  test("yetki: misafir 401; normal kullanıcı ve moderatör 403 (yalnız ADMIN+)", async () => {
    const item = await media();
    const moderator = await staff("MODERATOR");
    const user = await signUp();
    for (const cookie of [user.cookie, moderator.cookie]) {
      assertError(await list(cookie), 403, "FORBIDDEN");
      assertError(await ban(cookie, item.id), 403, "FORBIDDEN");
      assertError(await unban(cookie, randomUUID()), 403, "FORBIDDEN");
    }
    assertError(await list(undefined), 401, "UNAUTHENTICATED");
    assertError(await ban(undefined, item.id), 401, "UNAUTHENTICATED");
    assert.equal(await db.bannedMediaHash.count({ where: { sourceMediaId: item.id } }), 0);
  });

  test("reddedilmiş görsel yasaklanır: parmak izi saklanır ama cevapta dönmez; tekrar aynı kaydı döner", async () => {
    const item = await media();
    const res = await ban(admin.cookie, item.id);
    assert.equal(res.statusCode, 201, res.body);
    const view = BannedMediaView.parse(res.json().data);
    assert.deepEqual(
      [view.sourceMediaId, view.matchesExact, view.matchesSimilar, view.createdBy.id, view.reason],
      [item.id, true, true, admin.id, "Kuralları ihlal eden görsel tekrar yüklendi"],
    );
    assert.equal(JSON.stringify(res.json()).includes(item.contentSha256!), false, "sha256 cevaba sızmamalı");
    assert.equal(JSON.stringify(res.json()).includes(item.perceptualHash!), false, "dHash cevaba sızmamalı");

    const row = await db.bannedMediaHash.findUniqueOrThrow({ where: { sourceMediaId: item.id } });
    assert.deepEqual([row.contentSha256, row.perceptualHash, row.createdById], [item.contentSha256, item.perceptualHash, admin.id]);

    const again = await ban(admin.cookie, item.id, "Başka bir gerekçe");
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().data.id, view.id);
    assert.equal(again.json().data.reason, view.reason, "mevcut kaydın gerekçesi değişmez");
  });

  test("eşzamanlı yasaklama tek kayıt üretir; aynı dosyanın başka yüklemesi mevcut yasağı döner", async () => {
    const item = await media();
    const results = await Promise.all(Array.from({ length: 6 }, () => ban(admin.cookie, item.id)));
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 200, 200, 200, 200, 201]);
    assert.equal(new Set(results.map((r) => r.json().data.id)).size, 1);
    assert.equal(await db.bannedMediaHash.count({ where: { sourceMediaId: item.id } }), 1);

    const duplicateUpload = await media({ sha: item.contentSha256 });
    const res = await ban(admin.cookie, duplicateUpload.id);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.sourceMediaId, item.id);
  });

  test("hatalar: reddedilmemiş 409 not_rejected, parmak izsiz 409 no_fingerprint, olmayan 404, kısa gerekçe 400", async () => {
    for (const status of ["QUARANTINED", "APPROVED"] as const) {
      const res = await ban(admin.cookie, (await media({ status })).id);
      assertError(res, 409, "CONFLICT");
      assert.equal(res.json().error.details[0].code, "not_rejected");
    }
    const bare = await ban(admin.cookie, (await media({ sha: null, phash: null })).id);
    assertError(bare, 409, "CONFLICT");
    assert.equal(bare.json().error.details[0].code, "no_fingerprint");

    // Yalnız dHash'i olan eski kayıt da yasaklanabilir (sha256 yoksa yalnız yakınlık eşleşir).
    const onlyPhash = await ban(admin.cookie, (await media({ sha: null })).id);
    assert.equal(onlyPhash.statusCode, 201, onlyPhash.body);
    assert.deepEqual([onlyPhash.json().data.matchesExact, onlyPhash.json().data.matchesSimilar], [false, true]);

    assertError(await ban(admin.cookie, randomUUID()), 404, "NOT_FOUND");
    assertError(await ban(admin.cookie, (await media()).id, "x"), 400, "VALIDATION_ERROR");
  });

  test("liste en yeni önce sayfalanır; yasak kaldırılınca listeden çıkar, tekrar kaldırma idempotent", async () => {
    // Diğer testlerin ve önceki koşuların kayıtlarının önünde kalmak için tarih tabanı her koşuda ileri gider.
    const base = Date.now() + 5 * 365 * 86_400_000;
    const created: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await ban(admin.cookie, (await media()).id);
      created.push(res.json().data.id);
      await db.bannedMediaHash.update({ where: { id: res.json().data.id }, data: { createdAt: new Date(base + i) } });
    }
    const first = await list(admin.cookie, "?limit=2");
    assert.equal(first.statusCode, 200, first.body);
    assert.deepEqual(first.json().data.map((b: any) => b.id), [created[2], created[1]]);
    assert.equal(first.json().page.hasMore, true);
    const second = await list(admin.cookie, `?limit=2&cursor=${first.json().page.nextCursor}`);
    assert.equal(second.json().data[0].id, created[0]);
    assertError(await list(admin.cookie, "?cursor=bozuk"), 400, "INVALID_CURSOR");

    assert.equal((await unban(admin.cookie, created[2])).statusCode, 204);
    assert.equal((await unban(admin.cookie, created[2])).statusCode, 204);
    assert.equal((await unban(admin.cookie, randomUUID())).statusCode, 204);
    assert.equal(await db.bannedMediaHash.count({ where: { id: created[2] } }), 0);
    assert.equal((await list(admin.cookie, "?limit=1")).json().data[0].id, created[1]);
  });

  test("yasaklı görsel onaylanamaz (yayına çıkmaz); yasak kaldırılınca onaylanabilir", async () => {
    const item = await media();
    const created = await ban(admin.cookie, item.id);

    const blocked = await send("POST", `/admin/media/${item.id}/decision`, { decision: "APPROVE", reason: "İtiraz kabul edildi" }, admin.cookie);
    assertError(blocked, 409, "CONFLICT");
    assert.equal(blocked.json().error.details[0].code, "banned");
    assert.equal(h.storage.publicKeys.has(`m/${item.id}.webp`), false, "yasaklı görsel public bucket'a kopyalanmamalı");
    assert.equal((await db.mediaAsset.findUniqueOrThrow({ where: { id: item.id } })).status, "REJECTED");

    assert.equal((await unban(admin.cookie, created.json().data.id)).statusCode, 204);
    const approved = await send("POST", `/admin/media/${item.id}/decision`, { decision: "APPROVE", reason: "İtiraz kabul edildi" }, admin.cookie);
    assert.equal(approved.statusCode, 200, approved.body);
    assert.equal(approved.json().data.status, "APPROVED");
  });
});

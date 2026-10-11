/**
 * #181 KVKK veri dışa aktarma: talep (yönetici) → paket (worker job'ı) → bağlantı (e-posta) → indirme (kullanıcı).
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL veya .env). Worker job'ı API testinde doğrudan çalıştırılır; private
 * bucket bellek içidir ve API ile worker aynı nesne deposunu görür. audit_logs append-only ve test DB'si dosyalar arasında
 * sıfırlanmaz: sorgular her testin yeni kullanıcısına göre yapılır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { DataExport, DataExportPackage, ErrorBody, headers } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { PackageTooLargeError } from "../../worker/src/jobs/data-exports/collect.ts";
import { encryptPackage, newPackageKey } from "../../worker/src/jobs/data-exports/crypto.ts";
import { PACKAGE_TTL_MS, runDataExports, STALE_CLAIM_MS, type DataExportDeps } from "../../worker/src/jobs/data-exports/job.ts";
import { decryptPackage } from "../src/modules/data-exports/crypto.ts";
import { DELIVER_COOLDOWN_MS, DELIVER_HOURLY_LIMIT, LINK_TTL_MS, MAX_DOWNLOADS, registerDataExportRoutes } from "../src/modules/data-exports/routes.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string; username: string; email: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const REASON = "KVKK erişim talebi; kimlik destek kanalında doğrulandı";

describe("KVKK veri dışa aktarma (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let superAdmin: User;
  let admin: User;
  let categoryId: string;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `kvkk-${randomUUID().slice(0, 8)}`, name: "KVKK" } })).id;
    superAdmin = await signUp();
    await db.userRole.create({ data: { userId: superAdmin.id, role: "SUPER_ADMIN" } });
    admin = await signUp();
    await db.userRole.create({ data: { userId: admin.id, role: "ADMIN", grantedById: superAdmin.id } });
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "GET" | "POST", url: string, body?: unknown, cookie?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as Promise<Res>;
  }

  function assertError(res: Res, status: number, code: string, detail?: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
    if (detail) assert.equal(res.json().error.details[0]?.code, detail, res.body);
  }

  async function signUp(): Promise<User & { password: string }> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `dx_${id}@example.test`, username: `dx_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id, username: account.username, email: account.email, password: account.password };
  }

  const create = (userId: string, cookie = superAdmin.cookie, reason: unknown = REASON) => send("POST", `/admin/users/${userId}/data-exports`, { reason }, cookie);
  const list = (userId: string, cookie = superAdmin.cookie) => send("GET", `/admin/users/${userId}/data-exports`, undefined, cookie);
  const deliver = (userId: string, exportId: string, cookie = superAdmin.cookie, reason: unknown = REASON) =>
    send("POST", `/admin/users/${userId}/data-exports/${exportId}/deliver`, { reason }, cookie);
  const download = (token: string, cookie?: string) => send("POST", "/me/data-export/download", { token }, cookie);

  /** Worker job'ı: API ile aynı bellek içi private bucket. */
  const workerDeps = (overrides: Partial<DataExportDeps> = {}): DataExportDeps => ({
    prisma: db,
    storage: {
      writePrivate: async (key, data) => void h.storage.blobs.set(key, data),
      deletePrivate: async (key) => void h.storage.blobs.delete(key),
    },
    now: () => h.clock.now,
    log: () => {},
    ...overrides,
  });
  const runWorker = (overrides: Partial<DataExportDeps> = {}) => runDataExports(workerDeps(overrides));

  const auditOf = (userId: string, operation: string) =>
    db.auditLog.findMany({ where: { action: operation === "download" ? "privacy.export.download" : "privacy.export.manage", operation, targetType: "USER", targetId: userId }, orderBy: { createdAt: "asc" } });
  const mailsTo = (email: string) => h.mails.filter((m) => m.to === email);
  const rowOf = (id: string) => db.dataExport.findUniqueOrThrow({ where: { id } });

  /** İçerikli bir hesap: anket, yorum, oy (başkasının anketine), yaptırım, rapor yapan/edilen. */
  async function richUser() {
    const user = await signUp();
    const other = await signUp();
    const poll = await db.poll.create({
      data: {
        authorId: user.id,
        categoryId,
        publicId: randomUUID().replaceAll("-", "").slice(0, 12),
        slug: "kvkk-anketi",
        title: "KVKK paket anketi",
        closesAt: new Date("2031-01-01T00:00:00Z"),
        options: { create: [{ position: 0, label: "Evet" }, { position: 1, label: "Hayır" }] },
      },
      select: { id: true },
    });
    const othersPoll = await db.poll.create({
      data: {
        authorId: other.id,
        categoryId,
        publicId: randomUUID().replaceAll("-", "").slice(0, 12),
        slug: "baskasi",
        title: "Başkasının anketi",
        closesAt: new Date("2031-01-01T00:00:00Z"),
        options: { create: [{ position: 0, label: "Seçenek A" }, { position: 1, label: "Seçenek B" }] },
      },
      select: { id: true, options: { orderBy: { position: "asc" }, select: { id: true } } },
    });
    await db.comment.create({ data: { pollId: poll.id, authorId: user.id, body: "Kullanıcının kendi yorumu" } });
    await db.comment.create({ data: { pollId: poll.id, authorId: other.id, body: "BASKASININ-YORUMU" } });
    await db.vote.create({ data: { pollId: othersPoll.id, optionId: othersPoll.options[1]!.id, userId: user.id } });
    await db.sanction.create({ data: { userId: user.id, type: "WARNING", reason: "Uyarı gerekçesi", createdById: admin.id } });
    await db.report.create({ data: { reporterId: other.id, reportedUserId: user.id, reason: "SPAM", details: "RAPORLAYAN-NOTU" } });
    await db.report.create({ data: { reporterId: user.id, pollId: othersPoll.id, reason: "OTHER", details: "kendi raporum" } });
    return { user, other, poll, othersPoll };
  }

  /** Talep aç, worker'la hazırla, bağlantıyı gönder; ham token'ı kullanıcının e-postasından döner. */
  async function readyAndDelivered(user: User) {
    const created = await create(user.id);
    assert.equal(created.statusCode, 202, created.body);
    const id = created.json().data.id as string;
    assert.equal((await runWorker()).built >= 1, true);
    const before = mailsTo(user.email).length;
    const delivered = await deliver(user.id, id);
    assert.equal(delivered.statusCode, 202, delivered.body);
    const mails = mailsTo(user.email);
    assert.equal(mails.length, before + 1);
    return { id, token: tokenFrom(mails.at(-1)) };
  }

  // ─── Yetki ve doğrulama ─────────────────────────────────────

  test("yetki: misafir 401; kullanıcı ve ADMIN 403 (yalnız SUPER_ADMIN); olmayan kullanıcı 404; üç endpoint de aynı", async () => {
    const user = await signUp();
    const fake = randomUUID();
    for (const call of [
      (cookie?: string) => create(user.id, cookie ?? ""),
      (cookie?: string) => list(user.id, cookie ?? ""),
      (cookie?: string) => deliver(user.id, fake, cookie ?? ""),
    ]) {
      assertError(await call(), 401, "UNAUTHENTICATED");
      assertError(await call(user.cookie), 403, "FORBIDDEN");
      assertError(await call(admin.cookie), 403, "FORBIDDEN");
    }
    assertError(await create(randomUUID()), 404, "NOT_FOUND");
    assertError(await list(randomUUID()), 404, "NOT_FOUND");
    assertError(await deliver(user.id, fake), 404, "NOT_FOUND");
    assert.equal(await db.dataExport.count({ where: { userId: user.id } }), 0);
  });

  test("gerekçe zorunlu: eksik ve kısa gerekçe 400; iz bırakmaz", async () => {
    const user = await signUp();
    assertError(await send("POST", `/admin/users/${user.id}/data-exports`, {}, superAdmin.cookie), 400, "VALIDATION_ERROR");
    assertError(await create(user.id, superAdmin.cookie, "ab"), 400, "VALIDATION_ERROR");
    assert.equal(await db.dataExport.count({ where: { userId: user.id } }), 0);
    assert.equal((await auditOf(user.id, "request")).length, 0);
  });

  test("kısıtlı hesap (BANNED/SUSPENDED) 409 account_restricted, silinmiş 409 user_deleted; satır ve audit yok; RESTRICTED serbest", async () => {
    const banned = await signUp();
    const suspended = await signUp();
    const deleted = await signUp();
    const restricted = await signUp();
    await db.user.update({ where: { id: banned.id }, data: { status: "BANNED" } });
    await db.user.update({ where: { id: suspended.id }, data: { status: "SUSPENDED" } });
    await db.user.update({ where: { id: deleted.id }, data: { deletedAt: h.clock.now } });
    await db.user.update({ where: { id: restricted.id }, data: { status: "RESTRICTED" } });
    assertError(await create(banned.id), 409, "CONFLICT", "account_restricted");
    assertError(await create(suspended.id), 409, "CONFLICT", "account_restricted");
    assertError(await create(deleted.id), 409, "CONFLICT", "user_deleted");
    for (const u of [banned, suspended, deleted]) {
      assert.equal(await db.dataExport.count({ where: { userId: u.id } }), 0);
      assert.equal((await auditOf(u.id, "request")).length, 0);
    }
    assert.equal((await create(restricted.id)).statusCode, 202);
  });

  // ─── Talep ve idempotency ───────────────────────────────────

  test("talep: PENDING döner (sözleşmeye uygun), audit gerekçe + request id ile; aynı hesap için tekrar aynı talebi döner, tek satır tek audit", async () => {
    const user = await signUp();
    const first = await create(user.id);
    assert.equal(first.statusCode, 202, first.body);
    const view = DataExport.parse(first.json().data);
    assert.equal(view.status, "PENDING");
    assert.deepEqual([view.readyAt, view.expiresAt, view.sizeBytes, view.deliveredAt, view.downloadCount], [null, null, null, null, 0]);

    const again = await create(user.id, superAdmin.cookie, "başka bir gerekçe ile tekrar");
    assert.equal(again.statusCode, 202);
    assert.equal(again.json().data.id, view.id);
    assert.equal(await db.dataExport.count({ where: { userId: user.id } }), 1);

    const audits = await auditOf(user.id, "request");
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.actorId, superAdmin.id);
    assert.equal(audits[0]!.reason, REASON);
    assert.ok(audits[0]!.requestId);
    assert.deepEqual(audits[0]!.after, { exportId: view.id });

    const listed = await list(user.id);
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(listed.json().data.map((e: any) => e.id), [view.id]);
  });

  test("eşzamanlı talepler: yedi paralel istek tek satır ve tek audit üretir", async () => {
    const user = await signUp();
    const results = await Promise.all(Array.from({ length: 7 }, () => create(user.id)));
    assert.deepEqual(new Set(results.map((r) => r.statusCode)), new Set([202]));
    assert.equal(new Set(results.map((r) => r.json().data.id)).size, 1);
    assert.equal(await db.dataExport.count({ where: { userId: user.id } }), 1);
    assert.equal((await auditOf(user.id, "request")).length, 1);
  });

  // ─── Paket (worker) ─────────────────────────────────────────

  test("worker: paket şifreli saklanır (düz metin yok), anahtar yalnız DB'de; READY görünümü boyut ve 7 günlük süre taşır, sır sızmaz", async () => {
    const { user } = await richUser();
    const id = (await create(user.id)).json().data.id as string;
    const result = await runWorker();
    assert.equal(result.built >= 1, true);

    const row = await rowOf(id);
    assert.equal(row.status, "READY");
    assert.equal(row.expiresAt!.getTime() - row.readyAt!.getTime(), PACKAGE_TTL_MS);
    const blob = h.storage.blobs.get(row.objectKey!)!;
    assert.equal(blob.length, row.sizeBytes);
    assert.equal(blob.includes(Buffer.from("KVKK paket anketi")), false, "düz metin nesnede görünmemeli");
    assert.equal(row.encKey!.length, 32);

    const view = list(user.id).then((r) => r.json().data[0]);
    const body = JSON.stringify(await view);
    assert.equal(body.includes(row.objectKey!), false);
    assert.equal(body.includes(Buffer.from(row.encKey!).toString("base64")), false);
    assert.equal(DataExport.parse(await view).status, "READY");
  });

  test("worker: tekrar çalışması hazır talebe dokunmaz; takılmış PROCESSING talebi süre sonra yeniden alınır", async () => {
    const user = await signUp();
    const id = (await create(user.id)).json().data.id as string;
    await runWorker();
    const keyBefore = (await rowOf(id)).objectKey;
    await runWorker();
    assert.equal((await rowOf(id)).objectKey, keyBefore, "READY talep yeniden üretilmez");

    const stuck = await signUp();
    const stuckId = (await create(stuck.id)).json().data.id as string;
    await db.dataExport.update({ where: { id: stuckId }, data: { status: "PROCESSING", claimedAt: new Date(h.clock.now.getTime() - STALE_CLAIM_MS - 1000) } });
    await runWorker();
    assert.equal((await rowOf(stuckId)).status, "READY");
  });

  test("worker: taze PROCESSING talebi (başka worker çalışıyor) alınmaz", async () => {
    const user = await signUp();
    const id = (await create(user.id)).json().data.id as string;
    await db.dataExport.update({ where: { id }, data: { status: "PROCESSING", claimedAt: h.clock.now } });
    await runWorker();
    assert.equal((await rowOf(id)).status, "PROCESSING");
  });

  test("worker: talep başka worker'a geçtiyse bu denemenin nesnesi silinir, satır bozulmaz (lost)", async () => {
    const user = await signUp();
    const id = (await create(user.id)).json().data.id as string;
    const objectsBefore = h.storage.blobs.size;
    const result = await runWorker({
      afterClaim: async (claimedId) => {
        if (claimedId === id) await db.dataExport.update({ where: { id }, data: { claimedAt: new Date(h.clock.now.getTime() + 1) } });
      },
    });
    assert.equal(result.lost >= 1, true);
    const row = await rowOf(id);
    assert.equal(row.status, "PROCESSING");
    assert.equal(row.objectKey, null);
    assert.equal(h.storage.blobs.size, objectsBefore, "kaybeden denemenin nesnesi kalmamalı");
  });

  test("worker hatası: talep FAILED + kısa kod (build_failed | too_large), nesne ve anahtar yok; yeni talep açılabilir", async () => {
    const user = await signUp();
    const id = (await create(user.id)).json().data.id as string;
    const objectsBefore = h.storage.blobs.size;
    await runWorker({
      collect: async (_p, userId) => {
        if (userId === user.id) throw new Error("veritabanı ayrıntısı: sızmamalı");
        throw new Error("başka");
      },
    });
    const failed = await rowOf(id);
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.failure, "build_failed");
    assert.equal(failed.encKey, null);
    assert.equal(h.storage.blobs.size, objectsBefore);
    assert.equal(JSON.stringify((await list(user.id)).json().data[0]).includes("ayrıntısı"), false);

    const second = await create(user.id);
    assert.equal(second.statusCode, 202);
    assert.notEqual(second.json().data.id, id, "FAILED talep açık sayılmaz");
    await runWorker({ collect: async () => Promise.reject(new PackageTooLargeError("büyük")) });
    assert.equal((await rowOf(second.json().data.id)).failure, "too_large");
  });

  // ─── Teslim (e-posta bağlantısı) ────────────────────────────

  test("teslim: hazır değilken 409 not_ready; READY'de bağlantı yalnız kullanıcının e-postasına gider; yanıt ve audit'te token yok", async () => {
    const user = await signUp();
    const id = (await create(user.id)).json().data.id as string;
    assertError(await deliver(user.id, id), 409, "CONFLICT", "not_ready");
    assert.equal(mailsTo(user.email).length, 1, "yalnız kayıt doğrulama maili");

    await runWorker();
    const res = await deliver(user.id, id);
    assert.equal(res.statusCode, 202, res.body);
    assert.deepEqual(Object.keys(res.json().data).sort(), ["linkExpiresAt", "sent"]);
    assert.equal(res.json().data.sent, true);
    assert.equal(new Date(res.json().data.linkExpiresAt).getTime() - h.clock.now.getTime(), LINK_TTL_MS);

    const mail = mailsTo(user.email).at(-1)!;
    assert.match(mail.text, /\/veri-indir#token=/);
    const token = tokenFrom(mail);
    assert.equal(res.body.includes(token), false);
    const [entry, ...rest] = await auditOf(user.id, "deliver");
    assert.equal(rest.length, 0);
    assert.equal(entry!.actorId, superAdmin.id);
    assert.equal(entry!.reason, REASON);
    const row = await rowOf(id);
    assert.notEqual(row.tokenHash, token);
    for (const text of [JSON.stringify(entry), JSON.stringify(await list(user.id))]) {
      assert.equal(text.includes(token), false);
      assert.equal(text.includes(user.email), false);
    }
    // Başka hesabın talebi bu hesap yoluyla teslim edilemez.
    const other = await signUp();
    assertError(await deliver(other.id, id), 404, "NOT_FOUND");
  });

  test("teslim sıklığı: 60 sn bekleme ve saatte 3 gönderim (429 + Retry-After); yeni bağlantı eskisini geçersiz kılar", async () => {
    const { user } = await richUser();
    const { id, token: first } = await readyAndDelivered(user);
    h.clock.advance(10 * 1000);
    const limited = await deliver(user.id, id);
    assertError(limited, 429, "RATE_LIMITED");
    assert.equal(limited.headers[headers.retryAfter.toLowerCase()], String((DELIVER_COOLDOWN_MS - 10 * 1000) / 1000));
    assert.equal(mailsTo(user.email).length, 2);

    let last = first;
    for (let i = 1; i < DELIVER_HOURLY_LIMIT; i++) {
      h.clock.advance(DELIVER_COOLDOWN_MS + 1000);
      assert.equal((await deliver(user.id, id)).statusCode, 202);
      last = tokenFrom(mailsTo(user.email).at(-1));
    }
    assert.notEqual(last, first);
    h.clock.advance(DELIVER_COOLDOWN_MS + 1000);
    assertError(await deliver(user.id, id), 429, "RATE_LIMITED");
    assert.equal((await auditOf(user.id, "deliver")).length, DELIVER_HOURLY_LIMIT);

    assertError(await download(first, user.cookie), 400, "TOKEN_INVALID_OR_EXPIRED");
    assert.equal((await download(last, user.cookie)).statusCode, 200);
  });

  // ─── İndirme ────────────────────────────────────────────────

  test("indirme: sahibin oturumu + token → sözleşmeye uygun paket; yalnız kendi verisi, sır ve başkasının kimliği yok; audit", async () => {
    const { user, other, poll, othersPoll } = await richUser();
    const { id, token } = await readyAndDelivered(user);

    const res = await download(token, user.cookie);
    assert.equal(res.statusCode, 200, res.body);
    const pkg = DataExportPackage.parse(res.json().data);
    assert.equal(pkg.profile.id, user.id);
    assert.equal(pkg.profile.email, user.email);
    const c = pkg.collections as Record<string, any[]>;
    assert.deepEqual(c.polls!.map((p) => p.title), ["KVKK paket anketi"]);
    assert.deepEqual(c.polls![0].options.map((o: any) => o.label), ["Evet", "Hayır"]);
    assert.deepEqual(c.comments!.map((x) => x.body), ["Kullanıcının kendi yorumu"]);
    assert.deepEqual(c.votes!.map((v) => [v.pollId, v.poll.title, v.option.label]), [[othersPoll.id, "Başkasının anketi", "Seçenek B"]]);
    assert.deepEqual(c.sanctions!.map((s) => s.reason), ["Uyarı gerekçesi"]);
    assert.deepEqual(c.reportsFiled!.map((r) => r.details), ["kendi raporum"]);
    assert.ok(c.sessions!.length >= 1);

    const text = JSON.stringify(pkg);
    for (const secret of ["passwordHash", "password_hash", "tokenHash", "token_hash", "RAPORLAYAN-NOTU", "BASKASININ-YORUMU", "createdById", "liftedById", "reporterId", "actorId", other.id]) {
      assert.equal(text.includes(secret), false, `pakette olmamalı: ${secret}`);
    }
    assert.ok(poll.id);

    const row = await rowOf(id);
    assert.equal(row.downloadCount, 1);
    const [entry, ...rest] = await auditOf(user.id, "download");
    assert.equal(rest.length, 0);
    assert.equal(entry!.actorId, user.id);
    assert.equal(entry!.reason, null);
    assert.deepEqual(entry!.after, { exportId: id, downloadNumber: 1 });
    assert.equal(JSON.stringify(entry).includes(token), false);
  });

  test("indirme kimlik doğrulaması: misafir 401; başkasının oturumu ve yanlış token aynı 400'ü alır (varlık sızmaz); sayaç artmaz", async () => {
    const { user } = await richUser();
    const stranger = await signUp();
    const { id, token } = await readyAndDelivered(user);
    assertError(await download(token), 401, "UNAUTHENTICATED");
    const wrongSession = await download(token, stranger.cookie);
    assertError(wrongSession, 400, "TOKEN_INVALID_OR_EXPIRED");
    const wrongToken = await download("x".repeat(43), user.cookie);
    assertError(wrongToken, 400, "TOKEN_INVALID_OR_EXPIRED");
    assert.equal(wrongSession.json().error.message, wrongToken.json().error.message);
    assertError(await send("POST", "/me/data-export/download", { token: "kisa" }, user.cookie), 400, "VALIDATION_ERROR");
    assert.equal((await rowOf(id)).downloadCount, 0);
    assert.equal((await auditOf(user.id, "download")).length, 0);
  });

  test("indirme hakkı: teslim başına en çok 3; dördüncüsü 400; yeni teslim hakkı sıfırlar", async () => {
    const { user } = await richUser();
    const { id, token } = await readyAndDelivered(user);
    for (let i = 0; i < MAX_DOWNLOADS; i++) assert.equal((await download(token, user.cookie)).statusCode, 200, `indirme ${i + 1}`);
    assertError(await download(token, user.cookie), 400, "TOKEN_INVALID_OR_EXPIRED");
    assert.equal((await rowOf(id)).downloadCount, MAX_DOWNLOADS);
    assert.equal((await auditOf(user.id, "download")).length, MAX_DOWNLOADS);

    h.clock.advance(DELIVER_COOLDOWN_MS + 1000);
    assert.equal((await deliver(user.id, id)).statusCode, 202);
    const fresh = tokenFrom(mailsTo(user.email).at(-1));
    assert.equal((await download(fresh, user.cookie)).statusCode, 200);
  });

  test("eşzamanlı indirme: yedi paralel istek tam olarak 3 başarı verir; sayaç ve audit 3'ü aşmaz", async () => {
    const { user } = await richUser();
    const { id, token } = await readyAndDelivered(user);
    const results = await Promise.all(Array.from({ length: 7 }, () => download(token, user.cookie)));
    assert.equal(results.filter((r) => r.statusCode === 200).length, MAX_DOWNLOADS);
    assert.equal(results.filter((r) => r.statusCode === 400).length, 7 - MAX_DOWNLOADS);
    assert.equal((await rowOf(id)).downloadCount, MAX_DOWNLOADS);
    assert.equal((await auditOf(user.id, "download")).length, MAX_DOWNLOADS);
  });

  test("bağlantı 24 saat sonra geçersiz; paket hâlâ durur, yeniden teslim yeni bağlantı verir", async () => {
    const { user } = await richUser();
    const { id, token } = await readyAndDelivered(user);
    h.clock.advance(LINK_TTL_MS + MINUTE);
    assertError(await download(token, user.cookie), 400, "TOKEN_INVALID_OR_EXPIRED");
    assert.equal((await rowOf(id)).status, "READY");
    assert.equal((await deliver(user.id, id)).statusCode, 202);
    assert.equal((await download(tokenFrom(mailsTo(user.email).at(-1)), user.cookie)).statusCode, 200);
  });

  test("bozuk veya başka talebin nesnesi çözülemez: indirme 500 verir, sayaç düşmez, kısmi veri dönmez", async () => {
    const { user } = await richUser();
    const { id, token } = await readyAndDelivered(user);
    const row = await rowOf(id);
    // Nesneyi başka bir talebin kimliğiyle şifrele (AAD uyuşmaz) ve satırdaki anahtarla aç.
    h.storage.blobs.set(row.objectKey!, encryptPackage(Buffer.from("{}"), Buffer.from(row.encKey!), randomUUID()));
    const res = await download(token, user.cookie);
    assertError(res, 500, "INTERNAL_ERROR");
    assert.equal((await rowOf(id)).downloadCount, 0);
    // Nesne tamamen yoksa da aynı.
    h.storage.blobs.delete(row.objectKey!);
    assertError(await download(token, user.cookie), 500, "INTERNAL_ERROR");
    assert.equal((await auditOf(user.id, "download")).length, 0);
  });

  // ─── Süre dolumu ────────────────────────────────────────────

  test("süre dolumu: 7 gün sonra nesne, anahtar ve token silinir (EXPIRED); indirme 400, teslim 409 expired; yeni talep açılabilir", async () => {
    const { user } = await richUser();
    const { id, token } = await readyAndDelivered(user);
    const objectKey = (await rowOf(id)).objectKey!;
    assert.ok(h.storage.blobs.has(objectKey));

    h.clock.advance(PACKAGE_TTL_MS + MINUTE);
    // Süre geçti ama worker henüz süpürmedi: indirme zaten reddedilir, talep hâlâ açık sayılır ve teslim 409 verir.
    assertError(await download(token, user.cookie), 400, "TOKEN_INVALID_OR_EXPIRED");
    assertError(await deliver(user.id, id), 409, "CONFLICT", "expired");

    const result = await runWorker();
    assert.equal(result.expired >= 1, true);
    const row = await rowOf(id);
    assert.equal(row.status, "EXPIRED");
    assert.deepEqual([row.objectKey, row.encKey, row.tokenHash, row.tokenExpiresAt], [null, null, null, null]);
    assert.equal(h.storage.blobs.has(objectKey), false);
    assertError(await deliver(user.id, id), 409, "CONFLICT", "expired");

    const next = await create(user.id);
    assert.equal(next.statusCode, 202);
    assert.notEqual(next.json().data.id, id);
  });
});

// ─── Şifreleme biçimi (veritabanı gerekmez) ───────────────────

test("şifreleme: worker biçimi API ile çözülür; yanlış anahtar, yanlış talep kimliği ve değiştirilmiş nesne reddedilir", async () => {
  const { gzipSync } = await import("node:zlib");
  const key = newPackageKey();
  const id = randomUUID();
  const payload = { schemaVersion: 1, note: "çözülebilir" };
  const blob = encryptPackage(gzipSync(Buffer.from(JSON.stringify(payload))), key, id);
  assert.deepEqual(decryptPackage(blob, key, id), payload);
  assert.throws(() => decryptPackage(blob, newPackageKey(), id));
  assert.throws(() => decryptPackage(blob, key, randomUUID()));
  const tampered = Buffer.from(blob);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptPackage(tampered, key, id));
  assert.throws(() => decryptPackage(Buffer.from("KVX1kisa"), key, id));
  assert.throws(() => decryptPackage(Buffer.concat([Buffer.from("XXXX"), blob.subarray(4)]), key, id));
  // Aynı veri iki kez şifrelenince farklı çıktı verir (rastgele IV).
  assert.notDeepEqual(encryptPackage(Buffer.from("a"), key, id), encryptPackage(Buffer.from("a"), key, id));
});

// ─── Route birimi: e-posta hatası (veritabanı gerekmez) ───────

test("e-posta servisi hata verirse sent=false döner; yanıt token içermez, store'a yalnız özet gider", async () => {
  const handlers = new Map<string, any>();
  let input: any;
  registerDataExportRoutes(((id: string, handler: any) => handlers.set(id, handler)) as any, {
    store: {
      deliver: async (value: any) => {
        input = value;
        return { kind: "issued", email: "kullanici@example.test", linkExpiresAt: new Date("2026-10-12T10:00:00Z") };
      },
    } as any,
    storage: { readPrivate: async () => null },
    mailer: {
      send: async () => {
        throw new Error("smtp down");
      },
    },
    now: () => new Date("2026-10-11T10:00:00Z"),
    tokenPepper: "pepper",
    webUrl: "https://web.test",
  });
  const res = await handlers.get("admin.users.dataExports.deliver")({
    params: { id: "u", exportId: "e" },
    body: { reason: REASON },
    viewer: { id: "admin" },
    request: { id: "req", log: { error() {} } },
  });
  assert.equal(res.status, 202);
  assert.deepEqual(res.body.data, { sent: false, linkExpiresAt: "2026-10-12T10:00:00.000Z" });
  assert.match(input.tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(input.token, undefined);
});

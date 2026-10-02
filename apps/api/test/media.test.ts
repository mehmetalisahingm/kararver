/**
 * KV-16 (#18) görsel yükleme API senaryoları. Endpoint testleri gerçek PostgreSQL gerektirir
 * (TEST_DATABASE_URL; CI'da tanımlı). Storage ve kuyruk sahtedir (test/support/fake-storage.ts);
 * pg-boss'un tekrar kuyruğa almayı engellediği ayrıca gerçek pg-boss ile doğrulanır.
 * Cevap gövdeleri router tarafından sözleşme şemasıyla (MediaView) doğrulanır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, MediaView } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { loadConfig } from "../src/config.ts";
import { startPgBossMediaQueue } from "../src/modules/media/queue.ts";
import { createS3MediaStorage } from "../src/modules/media/storage.ts";
import { createHarness, PEPPER, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

const baseEnv = {
  APP_ENV: "test",
  WEB_URL: WEB_ORIGIN,
  API_URL: "http://localhost:4000",
  SESSION_COOKIE_SECURE: "false",
  AUTH_TOKEN_PEPPER: PEPPER,
  MAIL_FROM: "KararVer <no-reply@localhost>",
  MEDIA_PUBLIC_BASE_URL: "http://cdn.test/media",
};
const s3Env = {
  S3_ENDPOINT: "http://localhost:8333",
  S3_FORCE_PATH_STYLE: "true",
  S3_ACCESS_KEY_ID: "kararver-local",
  S3_SECRET_ACCESS_KEY: "kararver-local-only-not-a-secret",
  S3_BUCKET_PRIVATE: "kararver-uploads-private",
  S3_BUCKET_PUBLIC: "kararver-media-public",
};

describe("medya yapılandırması", () => {
  test("S3 değişkenleri yoksa medya kapalı; hepsi varsa storage ayarı okunur", () => {
    assert.equal(loadConfig(baseEnv).storage, null);
    const storage = loadConfig({ ...baseEnv, ...s3Env }).storage;
    assert.deepEqual(storage, {
      endpoint: "http://localhost:8333",
      region: "us-east-1",
      forcePathStyle: true,
      accessKeyId: "kararver-local",
      secretAccessKey: "kararver-local-only-not-a-secret",
      privateBucket: "kararver-uploads-private",
      publicBucket: "kararver-media-public",
    });
  });

  test("yarım S3 ayarı hata verir ve değeri değil değişken adını yazar", () => {
    assert.throws(
      () => loadConfig({ ...baseEnv, ...s3Env, S3_SECRET_ACCESS_KEY: undefined }),
      (err: Error) => err.message.includes("S3_SECRET_ACCESS_KEY") && !err.message.includes("kararver-local-only"),
    );
  });

  test("S3 presigned PUT boyutu ve türü imzaya dahil eder, 10 dk geçerlidir (ağ gerekmez)", async () => {
    const storage = createS3MediaStorage(loadConfig({ ...baseEnv, ...s3Env }).storage!);
    const now = new Date("2026-10-01T09:00:00.000Z");
    const u = await storage.presignUpload("uploads/abc/original", { contentType: "image/png", sizeBytes: 1234 }, now);
    const url = new URL(u.url);
    assert.equal(url.pathname, "/kararver-uploads-private/uploads/abc/original");
    assert.equal(url.searchParams.get("X-Amz-Expires"), "600");
    assert.deepEqual(url.searchParams.get("X-Amz-SignedHeaders")!.split(";").sort(), ["content-length", "content-type", "host"]);
    assert.deepEqual(u.headers, { "Content-Type": "image/png" });
    assert.equal(u.expiresAt.toISOString(), "2026-10-01T09:10:00.000Z");

    const read = new URL((await storage.presignPrivateRead("processed/abc.webp", now)).url);
    assert.equal(read.searchParams.get("X-Amz-Expires"), "300");
  });

  test("staging'de S3 zorunlu", () => {
    const staging = { ...baseEnv, APP_ENV: "staging", SESSION_COOKIE_SECURE: "true", MAIL_TRANSPORT: "smtp", SMTP_URL: "smtp://u:p@smtp.test:587" };
    assert.throws(() => loadConfig(staging), /S3_ENDPOINT/);
    assert.ok(loadConfig({ ...staging, ...s3Env }).storage);
  });
});

describe("görsel yükleme (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "POST", url: string, body: unknown, cookie?: string, key?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  const get = (url: string, cookie?: string) => h.app.inject({ method: "GET", url: `/v1${url}`, headers: cookie ? { cookie } : {} });

  function assertError(res: { statusCode: number; json(): any }, status: number, code: string) {
    assert.equal(res.statusCode, status, JSON.stringify(res.json()));
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp(options: { verify?: boolean } = {}) {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `medya_${id}@example.test`, username: `medya_${id}`, displayName: "Yükleyen", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    if (options.verify !== false) {
      assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    }
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  const upload = { purpose: "POLL", mimeType: "image/jpeg", sizeBytes: 1_500_000 };

  async function createUpload(cookie: string, body: Record<string, unknown> = upload, key?: string) {
    const res = await send("POST", "/media/uploads", body, cookie, key);
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data as { mediaId: string; upload: { method: string; url: string; headers: Record<string, string>; expiresAt: string } };
  }

  async function originalKey(mediaId: string) {
    return (await db.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } })).originalObjectKey;
  }

  /** İstemcinin presigned URL'e PUT'u. */
  async function putFile(mediaId: string, sizeBytes = upload.sizeBytes, contentType = upload.mimeType) {
    h.storage.put(await originalKey(mediaId), sizeBytes, contentType);
  }

  // ─── Yükleme URL'i ──────────────────────────────────────────

  test("doğrulanmış kullanıcı private bucket için 10 dk'lık imzalı PUT alır; kayıt PENDING açılır", async () => {
    const user = await signUp();
    const { mediaId, upload: u } = await createUpload(user.cookie);

    assert.equal(u.method, "PUT");
    assert.deepEqual(u.headers, { "Content-Type": "image/jpeg" });
    assert.equal(new Date(u.expiresAt).getTime() - h.clock.now.getTime(), 10 * 60 * 1000);

    const row = await db.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } });
    assert.equal(row.uploaderId, user.id);
    assert.equal(row.purpose, "POLL");
    assert.equal(row.status, "PENDING");
    assert.match(row.originalObjectKey, /^uploads\/[0-9a-f-]{36}\/original$/);
    assert.ok(u.url.includes(row.originalObjectKey));
    assert.equal(row.publicObjectKey, null);
  });

  test("girişsiz 401, e-postası doğrulanmamış 403", async () => {
    assertError(await send("POST", "/media/uploads", upload), 401, "UNAUTHENTICATED");
    const unverified = await signUp({ verify: false });
    assertError(await send("POST", "/media/uploads", upload, unverified.cookie), 403, "EMAIL_NOT_VERIFIED");
  });

  test("sözleşme dışı tür 400, ayarda kapalı tür 415, sınır üstü boyut 413, yükleme kapalıyken 503", async () => {
    const user = await signUp();
    assertError(await send("POST", "/media/uploads", { ...upload, mimeType: "image/gif" }, user.cookie), 400, "VALIDATION_ERROR");

    h.mediaSettings.allowedTypes = ["image/webp"];
    try {
      assertError(await send("POST", "/media/uploads", upload, user.cookie), 415, "MEDIA_TYPE_NOT_ALLOWED");
    } finally {
      h.mediaSettings.allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    }

    const tooBig = await send("POST", "/media/uploads", { ...upload, sizeBytes: h.mediaSettings.maxBytes + 1 }, user.cookie);
    assertError(tooBig, 413, "MEDIA_TOO_LARGE");
    assert.equal(tooBig.json().error.details[0].maxBytes, h.mediaSettings.maxBytes);

    h.mediaSettings.uploadsEnabled = false;
    try {
      assertError(await send("POST", "/media/uploads", upload, user.cookie), 503, "FEATURE_DISABLED");
    } finally {
      h.mediaSettings.uploadsEnabled = true;
    }
  });

  test("Idempotency-Key: aynı istek aynı görseli döner, farklı gövde 409, işlenmeye başlamışsa 409 CONFLICT", async () => {
    const user = await signUp();
    const key = `media-${randomUUID()}`;
    const first = await createUpload(user.cookie, upload, key);
    const again = await createUpload(user.cookie, upload, key);
    assert.equal(again.mediaId, first.mediaId);
    assert.equal(await db.mediaAsset.count({ where: { uploaderId: user.id } }), 1);

    assertError(await send("POST", "/media/uploads", { ...upload, sizeBytes: 10 }, user.cookie, key), 409, "IDEMPOTENCY_KEY_REUSED");

    await db.mediaAsset.update({ where: { id: first.mediaId }, data: { processedObjectKey: `processed/${first.mediaId}.webp` } });
    assertError(await send("POST", "/media/uploads", upload, user.cookie, key), 409, "CONFLICT");
  });

  // ─── Tamamlama ──────────────────────────────────────────────

  test("dosya yüklenmeden tamamlama 400 not_uploaded; yüklendikten sonra 202 ve kuyruğa alınır", async () => {
    const user = await signUp();
    const { mediaId } = await createUpload(user.cookie);

    const early = await send("POST", `/media/${mediaId}/complete`, undefined, user.cookie);
    assertError(early, 400, "VALIDATION_ERROR");
    assert.equal(early.json().error.details[0].code, "not_uploaded");
    assert.ok(!h.queue.enqueued.includes(mediaId));

    await putFile(mediaId);
    const done = await send("POST", `/media/${mediaId}/complete`, undefined, user.cookie);
    assert.equal(done.statusCode, 202, done.body);
    const view = MediaView.parse(done.json().data);
    assert.deepEqual({ status: view.status, url: view.url, preview: view.preview }, { status: "PENDING", url: null, preview: null });
    assert.ok(h.queue.enqueued.includes(mediaId));
  });

  test("storage imzayı uygulamazsa boyut ve tür tamamlamada yakalanır ve görsel reddedilir", async () => {
    const user = await signUp();
    const big = await createUpload(user.cookie);
    await putFile(big.mediaId, h.mediaSettings.maxBytes + 1);
    assertError(await send("POST", `/media/${big.mediaId}/complete`, undefined, user.cookie), 413, "MEDIA_TOO_LARGE");

    const html = await createUpload(user.cookie);
    await putFile(html.mediaId, 100, "text/html");
    assertError(await send("POST", `/media/${html.mediaId}/complete`, undefined, user.cookie), 415, "MEDIA_TYPE_NOT_ALLOWED");

    const rows = await db.mediaAsset.findMany({ where: { id: { in: [big.mediaId, html.mediaId] } }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(
      rows.map((r) => [r.status, r.processingError]),
      [
        ["REJECTED", "TOO_LARGE"],
        ["REJECTED", "TYPE_NOT_ALLOWED"],
      ],
    );
    assert.ok(!h.queue.enqueued.includes(big.mediaId) && !h.queue.enqueued.includes(html.mediaId));
  });

  test("işlenmiş görselde tamamlama tekrar kuyruğa almaz, güncel durumu döner", async () => {
    const user = await signUp();
    const { mediaId } = await createUpload(user.cookie);
    await putFile(mediaId);
    await db.mediaAsset.update({
      where: { id: mediaId },
      data: { status: "QUARANTINED", processedObjectKey: `processed/${mediaId}.webp`, riskLevel: "HIGH", riskScore: 0.9 },
    });
    const before = h.queue.enqueued.length;
    const res = await send("POST", `/media/${mediaId}/complete`, undefined, user.cookie);
    assert.equal(res.statusCode, 202);
    assert.equal(res.json().data.status, "QUARANTINED");
    assert.equal(h.queue.enqueued.length, before);
  });

  // ─── Durum ve erişim ────────────────────────────────────────

  test("başkasının görseli 403, olmayan görsel 404, girişsiz 401", async () => {
    const owner = await signUp();
    const other = await signUp();
    const { mediaId } = await createUpload(owner.cookie);
    assertError(await get(`/media/${mediaId}`, other.cookie), 403, "FORBIDDEN");
    assertError(await send("POST", `/media/${mediaId}/complete`, undefined, other.cookie), 403, "FORBIDDEN");
    assertError(await get(`/media/${randomUUID()}`, owner.cookie), 404, "NOT_FOUND");
    assertError(await get(`/media/${mediaId}`), 401, "UNAUTHENTICATED");
  });

  test("public URL sadece APPROVED'da; incelemedeki görsel sadece işlenmiş kopyanın kısa ömürlü önizlemesini alır", async () => {
    const user = await signUp();
    const { mediaId } = await createUpload(user.cookie);
    const processed = `processed/${mediaId}.webp`;
    const read = async () => MediaView.parse((await get(`/media/${mediaId}`, user.cookie)).json().data);

    let view = await read();
    assert.deepEqual([view.url, view.preview], [null, null]);

    await db.mediaAsset.update({ where: { id: mediaId }, data: { status: "QUARANTINED", processedObjectKey: processed, width: 1200, height: 800 } });
    view = await read();
    assert.equal(view.url, null);
    assert.ok(view.preview!.url.includes(processed), "önizleme işlenmiş kopyadan");
    assert.ok(!view.preview!.url.includes("original"), "orijinal hiçbir zaman URL almaz");
    assert.equal(new Date(view.preview!.expiresAt).getTime() - h.clock.now.getTime(), 5 * 60 * 1000);
    assert.deepEqual([view.width, view.height], [1200, 800]);

    await db.mediaAsset.update({ where: { id: mediaId }, data: { status: "APPROVED", publicObjectKey: `m/${mediaId}.webp` } });
    view = await read();
    assert.equal(view.url, `http://cdn.test/media/m/${mediaId}.webp`);
    assert.equal(view.preview, null);

    await db.mediaAsset.update({ where: { id: mediaId }, data: { status: "REJECTED", publicObjectKey: null } });
    view = await read();
    assert.deepEqual([view.status, view.url, view.preview], ["REJECTED", null, null]);
  });

  test("gerçek pg-boss: aynı görsel iki kez kuyruğa alınsa da tek iş bekler", async () => {
    const schema = `pgboss_media_test_${randomUUID().slice(0, 8)}`;
    const queue = await startPgBossMediaQueue(process.env.TEST_DATABASE_URL!, (err) => assert.fail(err), schema);
    try {
      const mediaId = randomUUID();
      await queue.enqueueProcessing(mediaId);
      await queue.enqueueProcessing(mediaId);
      await queue.enqueueProcessing(randomUUID());
      const rows = await db.$queryRawUnsafe<{ key: string; n: number }[]>(
        `SELECT singleton_key AS key, count(*)::int AS n FROM "${schema}".job WHERE name = 'media.process' GROUP BY singleton_key`,
      );
      assert.equal(rows.length, 2);
      assert.equal(rows.find((r) => r.key === mediaId)?.n, 1);
    } finally {
      await queue.stop();
      await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    }
  });
});

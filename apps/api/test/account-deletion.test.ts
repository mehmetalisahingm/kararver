/**
 * #181 kullanıcının kendi hesabını silmesi (KV-33 §12): varsayılan kapalı bayrak, yeniden kimlik doğrulama (parola, MFA),
 * yazılı teyit, e-posta bağlantısıyla açık onay, iptal (kendi ve bağlantıyla), engeller, süre, sıklık sınırı, idempotency,
 * iptal/onay ve engel yarışları, bildirimler ve audit'te kişisel veri olmaması. Gerçek PostgreSQL gerektirir.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, SelfDeletionPreview } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { COOLDOWN_MS, HOURLY_LIMIT, LINK_TTL_MS } from "../src/modules/account-deletion/routes.ts";
import { tombstoneOf } from "../src/modules/account-erasure/store.ts";
import { decodeBase32, hotp } from "../src/modules/security/totp.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string; username: string; email: string; password: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };
const PASSWORD = "guclu-bir-sifre-1";

describe("kendi hesabını silme (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let boss: User;
  let categoryId: string;
  const communityIds: string[] = [];

  before(async () => {
    h = await createHarness(backend!, { realSettings: true });
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `selfdel-${randomUUID().slice(0, 8)}`, name: "Kendi silme testi" } })).id;
    boss = await signUp();
    await db.userRole.create({ data: { userId: boss.id, role: "SUPER_ADMIN" } });
    await setFlag(true);
  });
  after(async () => {
    if (db) {
      await db.accountDeletionRequest.updateMany({ where: { status: "OPEN" }, data: { status: "CANCELLED", failure: "test_cleanup", finishedAt: new Date() } });
      await db.accountErasure.updateMany({ where: { storageCleanedAt: null, user: { username: { startsWith: "silinmis_" } } }, data: { storageCleanedAt: new Date() } });
      await db.community.updateMany({ where: { id: { in: communityIds } }, data: { ownerId: null } });
      await db.communityMembership.deleteMany({ where: { communityId: { in: communityIds } } });
      await db.community.deleteMany({ where: { id: { in: communityIds } } });
    }
    await setFlag(false).catch(() => undefined);
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: unknown, cookie?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: { origin: WEB_ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      payload: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as Promise<Res>;
  }
  function assertError(res: Res, status: number, code: string, detail?: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
    if (detail) assert.equal(res.json().error.details[0]?.code, detail, res.body);
  }
  const fresh = () => `sd_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  async function signUp(): Promise<User> {
    const id = fresh();
    const account = { email: `${id}@example.test`, username: id, displayName: `Ad ${id}`, password: PASSWORD };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    return login(account.email, account.password, id);
  }
  async function login(email: string, password: string, username = ""): Promise<User> {
    const res = await send("POST", "/auth/login", { email, password });
    assert.equal(res.statusCode, 200, res.body);
    return { cookie: sessionCookie(res.headers["set-cookie"] as string), id: res.json().data.id, username, email, password };
  }
  async function setFlag(on: boolean) {
    const current = (await h.settings!.list()).find((e) => e.key === "account.selfDeletionEnabled")!;
    if (current.value === on) return;
    const outcome = await h.settings!.update({ key: "account.selfDeletionEnabled", value: on, version: current.version, reason: "Kendi silme testi için bayrak", actorId: boss.id, requestId: randomUUID() });
    assert.equal(outcome.kind, "updated", JSON.stringify(outcome));
    h.settings!.invalidate();
  }

  const preview = (u: User) => send("GET", "/me/deletion", undefined, u.cookie);
  const request = (u: User, over: Record<string, unknown> = {}) => send("POST", "/me/deletion", { password: PASSWORD, confirmUsername: u.username, ...over }, u.cookie);
  const cancel = (u: User) => send("DELETE", "/me/deletion", undefined, u.cookie);
  const confirm = (token: string) => send("POST", "/auth/deletion/confirm", { token });
  const cancelLink = (token: string) => send("POST", "/auth/deletion/cancel", { token });
  const me = (u: User) => send("GET", "/me", undefined, u.cookie);
  const mailsTo = (email: string) => h.mails.filter((m) => m.to === email);
  const rows = (userId: string) => db.accountDeletionRequest.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const audits = (userId: string, action: string, operation?: string) =>
    db.auditLog.findMany({ where: { action, targetType: "USER", targetId: userId, ...(operation ? { operation } : {}) }, orderBy: { createdAt: "asc" } });
  const userRow = (id: string) => db.user.findUniqueOrThrow({ where: { id } });
  const slug = () => `sd${randomUUID().replaceAll("-", "").slice(0, 8)}`;

  /** Talep açar ve e-postadaki token'ı döner. */
  async function open(u: User) {
    const before = mailsTo(u.email).length;
    const res = await request(u);
    assert.equal(res.statusCode, 202, res.body);
    assert.equal(res.json().data.status, "CONFIRMATION_SENT");
    const mails = mailsTo(u.email);
    assert.equal(mails.length, before + 1);
    return { token: tokenFrom(mails.at(-1)), mail: mails.at(-1)! };
  }
  /** İçerikli hesap: anket, yorum, oy, sahip olunan topluluk. */
  async function rich() {
    const u = await signUp();
    const other = await signUp();
    const poll = await db.poll.create({
      data: {
        authorId: u.id, categoryId, publicId: randomUUID().replaceAll("-", "").slice(0, 12), slug: "kendi-silme", title: "Kendi silme anketi",
        closesAt: new Date("2031-01-01T00:00:00Z"), options: { create: [{ position: 0, label: "Evet" }, { position: 1, label: "Hayır" }] },
      },
      select: { id: true },
    });
    const comment = await db.comment.create({ data: { pollId: poll.id, authorId: u.id, body: "Kendi silme yorumu" } });
    const community = await db.community.create({ data: { slug: slug(), name: "Kendi silme topluluğu", createdById: other.id, memberCount: 1 } });
    communityIds.push(community.id);
    await db.communityMembership.create({ data: { communityId: community.id, userId: u.id } });
    await db.community.update({ where: { id: community.id }, data: { ownerId: u.id } });
    return { u, other, poll, comment, community };
  }
  async function enableMfa(u: User) {
    const setup = await send("POST", "/me/mfa/setup", { password: u.password }, u.cookie);
    assert.equal(setup.statusCode, 200, setup.body);
    const secret = setup.json().data.secret as string;
    const counter = () => Math.floor(h.clock.now.getTime() / 30000);
    assert.equal((await send("POST", "/me/mfa/confirm", { code: hotp(decodeBase32(secret), counter()) }, u.cookie)).statusCode, 200);
    return async () => {
      h.clock.advance(30000);
      const res = await send("POST", "/me/mfa/step-up", { code: hotp(decodeBase32(secret), counter()) }, u.cookie);
      assert.equal(res.statusCode, 200, res.body);
    };
  }

  // ─── Bayrak ve kimlik ───────────────────────────────────────

  test("bayrak varsayılan kapalı: talep 503 FEATURE_DISABLED ve iz bırakmaz; önizleme enabled=false canRequest=false; iptal ve geçersiz bağlantı çalışır", async () => {
    await setFlag(false);
    try {
      const u = await signUp();
      assertError(await request(u), 503, "FEATURE_DISABLED");
      assert.equal((await rows(u.id)).length, 0);
      const pv = SelfDeletionPreview.parse((await preview(u)).json().data);
      assert.equal(pv.enabled, false);
      assert.equal(pv.canRequest, false);
      assert.deepEqual((await cancel(u)).json().data, { cancelled: false });
      assertError(await confirm("x".repeat(43)), 400, "TOKEN_INVALID_OR_EXPIRED");
    } finally {
      await setFlag(true);
    }
  });

  test("misafir 401; başkasının hesabına dokunulmaz (uçlar yalnız kendi oturumuna bağlı)", async () => {
    assertError(await send("GET", "/me/deletion"), 401, "UNAUTHENTICATED");
    assertError(await send("POST", "/me/deletion", { password: PASSWORD, confirmUsername: "x" }), 401, "UNAUTHENTICATED");
    assertError(await send("DELETE", "/me/deletion"), 401, "UNAUTHENTICATED");
    const a = await signUp();
    const b = await signUp();
    const flow = await open(a);
    assert.deepEqual((await cancel(b)).json().data, { cancelled: false }, "başkasının talebi iptal edilmez");
    assert.equal((await rows(a.id)).at(-1)!.status, "OPEN");
    assert.equal(flow.token.length > 20, true);
  });

  test("yeniden kimlik doğrulama: yanlış parola 401, eksik alan 400, yanlış kullanıcı adı 409 confirmation_mismatch; hiçbirinde talep, e-posta veya silme yok", async () => {
    const u = await signUp();
    const mails = h.mails.length;
    assertError(await request(u, { password: "yanlis-parola-123" }), 401, "INVALID_CREDENTIALS");
    assertError(await send("POST", "/me/deletion", { confirmUsername: u.username }, u.cookie), 400, "VALIDATION_ERROR");
    assertError(await send("POST", "/me/deletion", { password: PASSWORD }, u.cookie), 400, "VALIDATION_ERROR");
    assertError(await request(u, { confirmUsername: "baska_biri" }), 409, "CONFLICT", "confirmation_mismatch");
    assertError(await request(u, { confirmUsername: u.email }), 409, "CONFLICT", "confirmation_mismatch");
    assert.equal((await rows(u.id)).length, 0);
    assert.equal(h.mails.length, mails);
    assert.equal((await userRow(u.id)).deletedAt, null);
    // Büyük/küçük harf ve baştaki @ önemsiz.
    assert.equal((await request(u, { confirmUsername: ` @${u.username.toUpperCase()} ` })).statusCode, 202);
  });

  // ─── Önizleme ───────────────────────────────────────────────

  test("önizleme salt okunur: sayılar doğru, yasal saklamanın gerekçesi sızmaz; talep açıkken request alanı dolu", async () => {
    const { u } = await rich();
    const auditCount = await db.auditLog.count();
    const res = await preview(u);
    const pv = SelfDeletionPreview.parse(res.json().data);
    assert.equal(pv.username, u.username);
    assert.equal(pv.enabled, true);
    assert.equal(pv.canRequest, true);
    assert.deepEqual(pv.blockers, []);
    assert.equal(pv.mfaRequired, false);
    assert.equal(pv.request, null);
    assert.equal(pv.willRemove.polls, 1);
    assert.equal(pv.willRemove.comments, 1);
    assert.equal(pv.willRemove.ownedCommunities, 1);
    assert.equal(await db.auditLog.count(), auditCount, "önizleme audit yazmaz");

    await db.userLegalHold.create({ data: { userId: u.id, reason: "GIZLI-HUKUKI-GEREKCE", placedById: boss.id } });
    const held = await preview(u);
    assert.equal(held.body.includes("GIZLI-HUKUKI-GEREKCE"), false, "gerekçe kullanıcıya gösterilmez");
    const hv = SelfDeletionPreview.parse(held.json().data);
    assert.deepEqual(hv.blockers, ["legal_hold"]);
    assert.equal(hv.canRequest, false);
    await db.userLegalHold.updateMany({ where: { userId: u.id }, data: { releasedAt: new Date(), releasedById: boss.id, releasedReason: "test kapanış" } });
  });

  // ─── Engeller ───────────────────────────────────────────────

  test("engeller: rolü olan, aktif yaptırımlı, yasal saklamalı ve veri paketi süren hesap talep açamaz (409 + kod); iz ve e-posta yok", async () => {
    const withRole = await signUp();
    await db.userRole.create({ data: { userId: withRole.id, role: "MODERATOR", grantedById: boss.id } });
    assertError(await request(withRole), 409, "CONFLICT", "has_role");

    const sanctioned = await signUp();
    const startsAt = new Date(h.clock.now.getTime() - 3600_000);
    await db.sanction.create({ data: { userId: sanctioned.id, type: "RESTRICT_COMMENTS", reason: "test: yaptırım", createdById: boss.id, startsAt, createdAt: startsAt } });
    assertError(await request(sanctioned), 409, "CONFLICT", "active_sanction");

    const held = await signUp();
    await db.userLegalHold.create({ data: { userId: held.id, reason: "test saklama", placedById: boss.id } });
    assertError(await request(held), 409, "CONFLICT", "legal_hold");

    const exporting = await signUp();
    const pending = await db.dataExport.create({ data: { userId: exporting.id, requestedById: boss.id, status: "PENDING" }, select: { id: true } });
    assertError(await request(exporting), 409, "CONFLICT", "export_in_progress");
    await db.dataExport.update({ where: { id: pending.id }, data: { status: "FAILED", failure: "test_cleanup" } });

    for (const u of [withRole, sanctioned, held, exporting]) {
      assert.equal((await rows(u.id)).length, 0);
      assert.equal((await userRow(u.id)).deletedAt, null);
      assert.equal(mailsTo(u.email).filter((m) => /silme talebini/.test(m.subject)).length, 0, "engelli hesaba onay e-postası gitmez");
    }
  });

  // ─── Tam akış ───────────────────────────────────────────────

  test("talep hesabı SİLMEZ: onay e-postası gider, hesap ve oturumlar yerinde; bağlantıyı onaylayınca kalıcı silinir ve bildirimler gider", async () => {
    const { u, other, poll, comment, community } = await rich();
    const second = await login(u.email, PASSWORD);
    const flow = await open(u);
    assert.match(flow.mail.text, /action=confirm/);
    assert.match(flow.mail.text, /action=cancel/);
    assert.match(flow.mail.text, /geri alınamaz/i);
    assert.equal((await userRow(u.id)).deletedAt, null, "talep silmez");
    assert.equal((await me(u)).statusCode, 200);
    assert.equal((await me(second)).statusCode, 200);
    assert.equal((await rows(u.id)).filter((r) => r.status === "OPEN").length, 1);

    const live = (await rows(u.id)).find((r) => r.status === "OPEN")!;
    assert.ok(live);

    const done = await confirm(flow.token);
    assert.equal(done.statusCode, 200, done.body);
    assert.deepEqual(done.json().data, { status: "deleted" });

    const row = await userRow(u.id);
    assert.notEqual(row.deletedAt, null);
    assert.equal(row.username, tombstoneOf(u.id).username);
    assert.equal(row.email, tombstoneOf(u.id).email);
    assert.equal(await db.session.count({ where: { userId: u.id } }), 0);
    assert.equal((await me(u)).statusCode, 401);
    assert.equal((await me(second)).statusCode, 401);
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: poll.id } })).status, "REMOVED");
    assert.equal((await db.comment.findUniqueOrThrow({ where: { id: comment.id } })).status, "REMOVED");
    assert.equal((await db.community.findUniqueOrThrow({ where: { id: community.id } })).ownerId, null);
    assert.equal((await userRow(other.id)).email, other.email, "başkasının verisine dokunulmaz");

    // Kalıcı kayıt, talep ve bildirimler.
    const erasure = await db.accountErasure.findUniqueOrThrow({ where: { userId: u.id } });
    assert.equal(erasure.requestedById, u.id);
    assert.equal((await rows(u.id)).find((r) => r.id === live.id)!.status, "COMPLETED");
    assert.match(mailsTo(u.email).at(-1)!.subject, /silindi/);
    assert.equal(await db.user.count({ where: { OR: [{ email: u.email }, { username: u.username }] } }), 0);
    assert.equal((await audits(u.id, "account.deletion.confirm", "apply")).length, 1);
    assert.equal((await audits(u.id, "account.deletion.manage", "request")).length >= 1, true);
    assert.equal((await audits(u.id, "user.anonymize")).length, 0, "yönetici işlemi olarak kaydedilmez");
  });

  test("idempotent: tekrar tıklama 200 unchanged, yeni e-posta veya audit yok; beş paralel onaydan biri siler", async () => {
    const u = await signUp();
    const flow = await open(u);
    const results = await Promise.all(Array.from({ length: 5 }, () => confirm(flow.token)));
    assert.deepEqual(results.map((r) => r.statusCode), [200, 200, 200, 200, 200], results.map((r) => r.body).join("|"));
    assert.deepEqual(results.map((r) => r.json().data.status).sort(), ["deleted", "unchanged", "unchanged", "unchanged", "unchanged"]);
    assert.equal((await audits(u.id, "account.deletion.confirm", "apply")).length, 1);
    assert.equal(await db.accountErasure.count({ where: { userId: u.id } }), 1);
    const mails = h.mails.length;
    assert.deepEqual((await confirm(flow.token)).json().data, { status: "unchanged" });
    assert.equal(h.mails.length, mails);
  });

  // ─── İptal ──────────────────────────────────────────────────

  test("kendi iptali: talep kapanır (idempotent), bağlantı artık silmez; yenisi öncekini 'replaced' diye iptal eder", async () => {
    const u = await signUp();
    const first = await open(u);
    assert.deepEqual((await cancel(u)).json().data, { cancelled: true });
    assert.deepEqual((await cancel(u)).json().data, { cancelled: false });
    assertError(await confirm(first.token), 400, "TOKEN_INVALID_OR_EXPIRED");
    assert.equal((await userRow(u.id)).deletedAt, null);
    assert.equal((await audits(u.id, "account.deletion.manage", "cancel")).length, 1);

    h.clock.advance(COOLDOWN_MS + 1000);
    const a = await open(u);
    h.clock.advance(COOLDOWN_MS + 1000);
    const b = await open(u);
    assert.equal((await rows(u.id)).filter((r) => r.status === "OPEN").length, 1);
    assert.equal((await rows(u.id)).find((r) => r.failure === "replaced")?.status, "CANCELLED");
    assertError(await confirm(a.token), 400, "TOKEN_INVALID_OR_EXPIRED");
    assert.deepEqual((await confirm(b.token)).json().data, { status: "deleted" });
  });

  test("'bu ben değilim' bağlantısı: talep iptal, bütün oturumlar kapanır, bekleyen bağlantılar geçersiz, hesap silinmez; tekrarı idempotent; silinmişse 409", async () => {
    const u = await signUp();
    const second = await login(u.email, PASSWORD);
    await db.authToken.create({ data: { userId: u.id, purpose: "PASSWORD_RESET", tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"), expiresAt: new Date(h.clock.now.getTime() + 3600_000) } });
    const flow = await open(u);
    assert.deepEqual((await cancelLink(flow.token)).json().data, { cancelled: true });
    assert.equal((await userRow(u.id)).deletedAt, null);
    assert.equal((await me(u)).statusCode, 401);
    assert.equal((await me(second)).statusCode, 401);
    assert.equal(await db.authToken.count({ where: { userId: u.id, usedAt: null } }), 0);
    assert.match(mailsTo(u.email).at(-1)!.subject, /iptal/);
    assertError(await confirm(flow.token), 400, "TOKEN_INVALID_OR_EXPIRED");
    const mails = h.mails.length;
    assert.deepEqual((await cancelLink(flow.token)).json().data, { cancelled: true });
    assert.equal(h.mails.length, mails, "tekrarda yeni bildirim yok");
    assert.equal((await audits(u.id, "account.deletion.confirm", "deny")).length, 1);

    const gone = await signUp();
    const goneFlow = await open(gone);
    assert.equal((await confirm(goneFlow.token)).statusCode, 200);
    assertError(await cancelLink(goneFlow.token), 409, "CONFLICT", "already_deleted");
  });

  test("süre: 24 saat sonra bağlantı 400 ve talep EXPIRED; sonraki talep açılabilir", async () => {
    const u = await signUp();
    const flow = await open(u);
    h.clock.advance(LINK_TTL_MS + 1000);
    assertError(await confirm(flow.token), 400, "TOKEN_INVALID_OR_EXPIRED");
    assert.equal((await rows(u.id)).at(-1)!.status, "EXPIRED");
    assert.equal((await userRow(u.id)).deletedAt, null);
    const next = await open(u);
    assert.deepEqual((await confirm(next.token)).json().data, { status: "deleted" });
  });

  test("sıklık sınırı: ardışık talepler arası 60 sn, saatte en çok 3; aşılınca 429 ve iz yok", async () => {
    const u = await signUp();
    await open(u);
    assertError(await request(u), 429, "RATE_LIMITED");
    for (let i = 1; i < HOURLY_LIMIT; i++) {
      h.clock.advance(COOLDOWN_MS + 1000);
      await open(u);
    }
    h.clock.advance(COOLDOWN_MS + 1000);
    assertError(await request(u), 429, "RATE_LIMITED");
    assert.equal((await rows(u.id)).length, HOURLY_LIMIT);
  });

  // ─── Yarış ve engel ─────────────────────────────────────────

  test("talep ile onay arasında engel doğarsa onay 409 + kod, talep FAILED, hiçbir şey silinmez (yasal saklama, yaptırım, rol)", async () => {
    const hold = await signUp();
    const holdFlow = await open(hold);
    await db.userLegalHold.create({ data: { userId: hold.id, reason: "sonradan saklama", placedById: boss.id } });
    assertError(await confirm(holdFlow.token), 409, "CONFLICT", "legal_hold");
    assert.equal((await rows(hold.id)).at(-1)!.status, "FAILED");
    assert.equal((await rows(hold.id)).at(-1)!.failure, "blocked:legal_hold");
    assert.equal((await userRow(hold.id)).deletedAt, null);
    assert.equal((await me(hold)).statusCode, 200);

    const sanctioned = await signUp();
    const flow = await open(sanctioned);
    const startsAt = new Date(h.clock.now.getTime() - 3600_000);
    await db.sanction.create({ data: { userId: sanctioned.id, type: "SUSPEND", reason: "test: askı", createdById: boss.id, startsAt, createdAt: startsAt, endsAt: new Date(h.clock.now.getTime() + 86_400_000) } });
    assertError(await confirm(flow.token), 409, "CONFLICT", "active_sanction");
    assert.equal((await userRow(sanctioned.id)).deletedAt, null);
  });

  test("yarış: iptal ile onay aynı anda — ya silinir ya iptal olur, ikisi birden olmaz; iptal edilmiş talep silmez", async () => {
    for (let round = 0; round < 4; round++) {
      const u = await signUp();
      const flow = await open(u);
      const [c, x] = await Promise.all([confirm(flow.token), cancelLink(flow.token)]);
      const deleted = (await userRow(u.id)).deletedAt !== null;
      if (deleted) {
        assert.equal(c.statusCode, 200, c.body);
        assertError(x, 409, "CONFLICT", "already_deleted");
        assert.equal((await rows(u.id)).at(-1)!.status, "COMPLETED");
      } else {
        assertError(c, 400, "TOKEN_INVALID_OR_EXPIRED");
        assert.equal(x.statusCode, 200, x.body);
        assert.equal((await rows(u.id)).at(-1)!.status, "CANCELLED");
        assert.equal(await db.accountErasure.count({ where: { userId: u.id } }), 0);
      }
    }
  });

  // ─── MFA ────────────────────────────────────────────────────

  test("MFA açıksa: önizleme mfaRequired, taze step-up olmadan 409 mfa_required (iz yok); step-up tek kullanımlık", async () => {
    const u = await signUp();
    const stepUp = await enableMfa(u);
    assert.equal(SelfDeletionPreview.parse((await preview(u)).json().data).mfaRequired, true);
    assertError(await request(u), 409, "CONFLICT", "mfa_required");
    assert.equal((await rows(u.id)).length, 0);

    await stepUp();
    const flow = await open(u);
    h.clock.advance(COOLDOWN_MS + 1000);
    assertError(await request(u), 409, "CONFLICT", "mfa_required");
    await stepUp();
    const again = await open(u);
    assertError(await confirm(flow.token), 400, "TOKEN_INVALID_OR_EXPIRED");
    assert.deepEqual((await confirm(again.token)).json().data, { status: "deleted" });
  });

  // ─── Gizlilik ───────────────────────────────────────────────

  test("audit ve talep kayıtlarında e-posta, kullanıcı adı ve token yok; token yalnız özet olarak saklanır", async () => {
    const u = await signUp();
    const flow = await open(u);
    await confirm(flow.token);
    const all = await db.auditLog.findMany({ where: { targetId: u.id, action: { in: ["account.deletion.manage", "account.deletion.confirm"] } } });
    assert.ok(all.length >= 2);
    const text = JSON.stringify(all.map((a) => [a.before, a.after, a.reason]));
    for (const secret of [u.email, u.username, flow.token]) assert.equal(text.includes(secret), false, "audit'te gizli veri yok");
    const row = (await rows(u.id)).at(-1)!;
    assert.equal(JSON.stringify(row).includes(flow.token), false);
    assert.equal(row.tokenHash.length, 64);
  });
});

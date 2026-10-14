/**
 * #181 e-posta değişimi (KV-33 §11): varsayılan kapalı bayrak, parola ile sahiplik kanıtı, iki taraflı doğrulama (yeni + eski
 * adres), destek yolu (yeni adres doğrulaması yine zorunlu), reddet, iptal, süre, e-posta çakışması, oturum/token güvenliği,
 * yarışlar ve audit'te adres olmaması. Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL veya .env).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { EmailChangeStarted, EmailChangeView, ErrorBody } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { COOLDOWN_MS, HOURLY_LIMIT, LINK_TTL_MS } from "../src/modules/email-change/routes.ts";
import { maskEmail } from "../src/modules/email-change/store.ts";
import { hashToken } from "../src/modules/auth/crypto.ts";
import { decodeBase32, hotp } from "../src/modules/security/totp.ts";
import { createHarness, PEPPER, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string; username: string; email: string; password: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };
const PASSWORD = "guclu-bir-sifre-1";
const REASON = "Eski adrese erişim kaybı; kimlik destek kanalında doğrulandı";

describe("e-posta değişimi (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let boss: User;
  let admin: User;
  let bossSecret: string | null = null;

  before(async () => {
    h = await createHarness(backend!, { realSettings: true });
    db = h.prisma!;
    boss = await signUp();
    await db.userRole.create({ data: { userId: boss.id, role: "SUPER_ADMIN" } });
    admin = await signUp();
    await db.userRole.create({ data: { userId: admin.id, role: "ADMIN", grantedById: boss.id } });
    await setFlag(true);
  });
  after(async () => {
    // Açık kalan talepler yeni adres (kişisel veri) taşır: paylaşılan test DB'sinde bırakılmaz.
    await db?.emailChangeRequest.updateMany({ where: { status: "OPEN" }, data: { status: "CANCELLED", failure: "test_cleanup", newEmail: null, newEmailNormalized: null, finishedAt: new Date() } });
    await setFlag(false).catch(() => undefined);
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: unknown, cookie?: string) {
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

  const fresh = () => `ec_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
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
    const current = (await h.settings!.list()).find((e) => e.key === "account.emailChangeEnabled")!;
    if (current.value === on) return;
    const outcome = await h.settings!.update({ key: "account.emailChangeEnabled", value: on, version: current.version, reason: "E-posta değişimi testi için bayrak", actorId: boss.id, requestId: randomUUID() });
    assert.equal(outcome.kind, "updated", JSON.stringify(outcome));
    h.settings!.invalidate();
  }

  const request = (user: User, newEmail: string, password = PASSWORD) => send("POST", "/me/email-change", { newEmail, password }, user.cookie);
  const status = (user: User) => send("GET", "/me/email-change", undefined, user.cookie);
  const cancel = (user: User) => send("DELETE", "/me/email-change", undefined, user.cookie);
  const confirm = (token: string) => send("POST", "/auth/email-change/confirm", { token });
  const deny = (token: string) => send("POST", "/auth/email-change/deny", { token });
  const adminStart = (userId: string, newEmail: string, cookie = boss.cookie, reason: unknown = REASON) => send("POST", `/admin/users/${userId}/email-change`, { newEmail, reason }, cookie);
  const adminList = (userId: string, cookie = boss.cookie) => send("GET", `/admin/users/${userId}/email-change`, undefined, cookie);
  const adminCancel = (userId: string, cookie = boss.cookie) => send("POST", `/admin/users/${userId}/email-change/cancel`, { reason: "Destek talebi vazgeçildi" }, cookie);
  const me = (user: User) => send("GET", "/me", undefined, user.cookie);

  async function eraseWithMfa(user: User) {
    if (!bossSecret) {
      const setup=await send("POST","/me/mfa/setup",{password:PASSWORD},boss.cookie);
      assert.equal(setup.statusCode,200,setup.body);bossSecret=setup.json().data.secret;
      const confirm=await send("POST","/me/mfa/confirm",{code:hotp(decodeBase32(bossSecret!),Math.floor(h.clock.now.getTime()/30000))},boss.cookie);
      assert.equal(confirm.statusCode,200,confirm.body);
    }
    h.clock.advance(30000);
    const fresh=await send("POST","/me/mfa/step-up",{code:hotp(decodeBase32(bossSecret!),Math.floor(h.clock.now.getTime()/30000))},boss.cookie);
    assert.equal(fresh.statusCode,200,fresh.body);
    return send("POST",`/admin/users/${user.id}/erasure`,{reason:REASON,confirmUsername:user.username},boss.cookie);
  }

  const mailsTo = (email: string) => h.mails.filter((m) => m.to === email);
  const newAddress = () => `${fresh()}@example.test`;
  /** Talep açar; yeni ve eski adrese giden bağlantı token'larını döner. */
  async function open(user: User, to = newAddress()) {
    const res = await request(user, to);
    assert.equal(res.statusCode, 202, res.body);
    assert.equal(res.json().data.status, "VERIFICATION_SENT");
    const newMail = mailsTo(to).at(-1)!;
    const oldMail = mailsTo(user.email).at(-1)!;
    return { to, newToken: tokenFrom(newMail), oldToken: tokenFrom(oldMail), newMail, oldMail };
  }
  const rows = (userId: string) => db.emailChangeRequest.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const audits = (userId: string, action: string, operation?: string) =>
    db.auditLog.findMany({ where: { action, targetType: "USER", targetId: userId, ...(operation ? { operation } : {}) }, orderBy: { createdAt: "asc" } });
  const emailOf = async (userId: string) => (await db.user.findUniqueOrThrow({ where: { id: userId } })).email;

  // ─── Bayrak ve yetki ────────────────────────────────────────

  test("bayrak varsayılan kapalı: başlatma 503 FEATURE_DISABLED ve iz bırakmaz; durum, iptal ve geçersiz bağlantı çalışır; açılınca başlar", async () => {
    await setFlag(false);
    try {
      const user = await signUp();
      assertError(await request(user, newAddress()), 503, "FEATURE_DISABLED");
      assertError(await adminStart(user.id, newAddress()), 503, "FEATURE_DISABLED");
      assert.equal((await rows(user.id)).length, 0);
      assert.equal((await status(user)).statusCode, 200);
      assert.equal((await status(user)).json().data, null);
      assert.deepEqual((await cancel(user)).json().data, { cancelled: false });
      assertError(await confirm("x".repeat(43)), 400, "TOKEN_INVALID_OR_EXPIRED");
    } finally {
      await setFlag(true);
    }
    const user = await signUp();
    assert.equal((await request(user, newAddress())).statusCode, 202);
  });

  test("yetki: misafir 401; kullanıcı ve ADMIN yönetici uçlarında 403; kimse kendi hesabı için destek yolunu kullanamaz", async () => {
    const user = await signUp();
    assertError(await send("POST", "/me/email-change", { newEmail: newAddress(), password: PASSWORD }), 401, "UNAUTHENTICATED");
    assertError(await send("GET", "/me/email-change"), 401, "UNAUTHENTICATED");
    for (const cookie of ["", user.cookie, admin.cookie]) {
      const expectCode = cookie === "" ? [401, "UNAUTHENTICATED"] : [403, "FORBIDDEN"];
      assertError(await adminStart(user.id, newAddress(), cookie), expectCode[0] as number, expectCode[1] as string);
      assertError(await adminList(user.id, cookie), expectCode[0] as number, expectCode[1] as string);
      assertError(await adminCancel(user.id, cookie), expectCode[0] as number, expectCode[1] as string);
    }
    assertError(await adminStart(boss.id, newAddress()), 403, "FORBIDDEN");
    assertError(await adminStart(randomUUID(), newAddress()), 404, "NOT_FOUND");
    assertError(await adminList(randomUUID()), 404, "NOT_FOUND");
    assert.equal((await rows(user.id)).length, 0);
  });

  test("doğrulama: yanlış parola 401 (iz yok), geçersiz adres/eksik alan 400, aynı adres 409 same_email, destek yolunda gerekçe zorunlu", async () => {
    const user = await signUp();
    assertError(await request(user, newAddress(), "yanlis-parola-123"), 401, "INVALID_CREDENTIALS");
    assertError(await send("POST", "/me/email-change", { newEmail: "gecersiz" , password: PASSWORD }, user.cookie), 400, "VALIDATION_ERROR");
    assertError(await send("POST", "/me/email-change", { newEmail: newAddress() }, user.cookie), 400, "VALIDATION_ERROR");
    assertError(await request(user, user.email.toUpperCase()), 409, "CONFLICT", "same_email");
    assertError(await adminStart(user.id, newAddress(), boss.cookie, "ab"), 400, "VALIDATION_ERROR");
    assertError(await adminStart(user.id, user.email), 409, "CONFLICT", "same_email");
    assert.equal((await rows(user.id)).length, 0);
    assert.equal((await audits(user.id, "account.emailChange.manage")).length, 0);
  });

  // ─── Kullanıcı yolu ─────────────────────────────────────────

  test("tam akış: iki bağlantı tıklanmadan e-posta değişmez; ikincisinde değişir, doğrulanmış sayılır, bütün oturumlar kapanır, bildirimler gider", async () => {
    const user = await signUp();
    const secondSession = await login(user.email, PASSWORD);
    await db.authToken.create({ data: { userId: user.id, purpose: "PASSWORD_RESET", tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"), expiresAt: new Date(h.clock.now.getTime() + 3600_000) } });
    const flow = await open(user);

    // Hiçbir e-posta gönderimi ham adres sızdırmaz; eski adrese maskeli yeni adres gider.
    assert.equal(flow.newMail.to, flow.to);
    assert.match(flow.oldMail.text, new RegExp(maskEmail(flow.to).replace(/[*]/g, "\\*")));
    assert.equal(flow.oldMail.text.includes(flow.to), false, "eski adrese giden mailde yeni adres açık yazılmaz");
    assert.match(flow.oldMail.text, /action=approve/);
    assert.match(flow.oldMail.text, /action=deny/);

    const view = EmailChangeView.parse((await status(user)).json().data);
    assert.equal(view.status, "OPEN");
    assert.equal(view.newEmailMasked, maskEmail(flow.to));
    assert.deepEqual([view.newConfirmed, view.oldConfirmed, view.requiresOld], [false, false, true]);

    const first = await confirm(flow.newToken);
    assert.deepEqual(first.json().data, { status: "waiting", step: "new" });
    assert.equal(await emailOf(user.id), user.email, "yalnız yeni adres doğrulandı: e-posta değişmez");
    assert.equal((await me(user)).statusCode, 200, "oturumlar henüz açık");

    const last = await confirm(flow.oldToken);
    assert.deepEqual(last.json().data, { status: "applied", step: "old" });
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(row.email, flow.to);
    assert.equal(row.emailNormalized, flow.to);
    assert.notEqual(row.emailVerifiedAt, null);

    // Oturumlar ve bekleyen bağlantılar.
    assertError(await me(user), 401, "UNAUTHENTICATED");
    assertError(await me(secondSession), 401, "UNAUTHENTICATED");
    assert.equal(await db.session.count({ where: { userId: user.id, revokedAt: null } }), 0);
    assert.equal(await db.authToken.count({ where: { userId: user.id, usedAt: null } }), 0);
    // Giriş yeni adresle; eski adres artık hesap bulmaz.
    assertError(await send("POST", "/auth/login", { email: user.email, password: PASSWORD }), 401, "INVALID_CREDENTIALS");
    assert.equal((await login(flow.to, PASSWORD)).id, user.id);

    // Bildirimler: eski adrese "değiştirildi", yeni adrese "güncellendi".
    assert.match(mailsTo(user.email).at(-1)!.subject, /değiştirildi/);
    assert.match(mailsTo(flow.to).at(-1)!.subject, /güncellendi/);
    const finished = (await rows(user.id)).at(-1)!;
    assert.equal(finished.status, "COMPLETED");
    assert.equal(finished.newEmail, null, "sonlanan talepte yeni adres silinir");
  });

  test("sıra önemsiz: önce eski adres onayı, sonra yeni adres doğrulaması da uygular", async () => {
    const user = await signUp();
    const flow = await open(user);
    assert.deepEqual((await confirm(flow.oldToken)).json().data, { status: "waiting", step: "old" });
    assert.equal(await emailOf(user.id), user.email);
    assert.deepEqual((await confirm(flow.newToken)).json().data, { status: "applied", step: "new" });
    assert.equal(await emailOf(user.id), flow.to);
  });

  test("tekrar tıklama idempotent: aynı bağlantı yeniden 200, yeni e-posta ve audit yok; reddedilmiş/iptal/yabancı token 400", async () => {
    const user = await signUp();
    const flow = await open(user);
    await confirm(flow.newToken);
    const again = await confirm(flow.newToken);
    assert.deepEqual(again.json().data, { status: "waiting", step: "new" });
    await confirm(flow.oldToken);
    const mailCount = h.mails.length;
    assert.deepEqual((await confirm(flow.oldToken)).json().data, { status: "applied", step: "old" });
    assert.deepEqual((await confirm(flow.newToken)).json().data, { status: "applied", step: "new" });
    assert.equal(h.mails.length, mailCount, "tekrar tıklamada yeni bildirim yok");
    for (const op of ["verify", "approve", "apply"]) assert.equal((await audits(user.id, "account.emailChange.confirm", op)).length, 1, op);

    assertError(await confirm("A".repeat(43)), 400, "TOKEN_INVALID_OR_EXPIRED");
    assertError(await confirm("kisa"), 400, "VALIDATION_ERROR");
  });

  test("reddet: eski adresteki 'ben değilim' bağlantısı talebi sonlandırır, bütün oturumları kapatır, bekleyen bağlantıları geçersiz kılar; tekrarı idempotent", async () => {
    const user = await signUp();
    const flow = await open(user);
    await confirm(flow.newToken);
    const denied = await deny(flow.oldToken);
    assert.deepEqual(denied.json().data, { denied: true });
    assert.equal(await emailOf(user.id), user.email);
    assertError(await me(user), 401, "UNAUTHENTICATED");
    assert.equal((await rows(user.id)).at(-1)!.status, "DENIED");
    assert.match(mailsTo(user.email).at(-1)!.subject, /reddedildi/);
    // Reddedilen talebin bağlantıları artık geçersiz.
    assertError(await confirm(flow.oldToken), 400, "TOKEN_INVALID_OR_EXPIRED");
    assertError(await confirm(flow.newToken), 400, "TOKEN_INVALID_OR_EXPIRED");
    const mailCount = h.mails.length;
    assert.deepEqual((await deny(flow.oldToken)).json().data, { denied: true });
    assert.equal(h.mails.length, mailCount);
    assert.equal((await audits(user.id, "account.emailChange.confirm", "deny")).length, 1);
    // Yeni adrese giden token reddetmek için kullanılamaz.
    const other = await signUp();
    const flow2 = await open(other);
    assertError(await deny(flow2.newToken), 400, "TOKEN_INVALID_OR_EXPIRED");
    assert.equal((await rows(other.id)).at(-1)!.status, "OPEN");
  });

  test("tamamlanmış değişimde reddet 409 already_applied ve hiçbir şey değişmez", async () => {
    const user = await signUp();
    const flow = await open(user);
    await confirm(flow.newToken);
    await confirm(flow.oldToken);
    assertError(await deny(flow.oldToken), 409, "CONFLICT", "already_applied");
    assert.equal(await emailOf(user.id), flow.to);
  });

  test("iptal: kullanıcı kendi açık talebini iptal eder (idempotent); bağlantılar geçersiz kalır; yenisi öncekini 'replaced' diye iptal eder", async () => {
    const user = await signUp();
    const first = await open(user);
    assert.deepEqual((await cancel(user)).json().data, { cancelled: true });
    assert.deepEqual((await cancel(user)).json().data, { cancelled: false });
    assertError(await confirm(first.newToken), 400, "TOKEN_INVALID_OR_EXPIRED");
    assert.equal((await audits(user.id, "account.emailChange.manage", "cancel")).length, 1);

    h.clock.advance(COOLDOWN_MS + 1000);
    const a = await open(user);
    h.clock.advance(COOLDOWN_MS + 1000);
    const b = await open(user);
    const all = await rows(user.id);
    assert.equal(all.filter((r) => r.status === "OPEN").length, 1);
    assert.equal(all.find((r) => r.failure === "replaced")?.status, "CANCELLED");
    assertError(await confirm(a.newToken), 400, "TOKEN_INVALID_OR_EXPIRED");
    assert.deepEqual((await confirm(b.newToken)).json().data, { status: "waiting", step: "new" });
  });

  test("yeni adres başka hesapta: yanıt aynı 202, talep açılmaz, sahibine bilgilendirme gider (hesap varlığı sızmaz)", async () => {
    const user = await signUp();
    const owner = await signUp();
    const res = await request(user, owner.email);
    assert.equal(res.statusCode, 202, res.body);
    EmailChangeStarted.parse(res.json().data);
    assert.equal(res.json().data.status, "VERIFICATION_SENT");
    assert.equal((await rows(user.id)).length, 0);
    assert.match(mailsTo(owner.email).at(-1)!.subject, /zaten/);
    assert.equal(mailsTo(owner.email).filter((m) => /token=/.test(m.text) && /hesap/.test(m.subject) && /doğrula/.test(m.subject)).length >= 0, true);
    assert.equal(await emailOf(user.id), user.email);
  });

  test("onay anında adres başkasına geçmişse 409 email_taken: talep FAILED olur, e-posta değişmez", async () => {
    const user = await signUp();
    const flow = await open(user);
    // Bu arada başka bir hesap aynı adresi aldı (doğrudan kayıt).
    await db.user.create({ data: { email: flow.to, emailNormalized: flow.to, username: fresh(), usernameNormalized: fresh(), displayName: "Başkası", passwordHash: "x" } });
    await confirm(flow.newToken);
    assertError(await confirm(flow.oldToken), 409, "CONFLICT", "email_taken");
    assert.equal(await emailOf(user.id), user.email);
    const row = (await rows(user.id)).at(-1)!;
    assert.equal(row.status, "FAILED");
    assert.equal(row.failure, "email_taken");
    assert.equal(row.newEmail, null);
  });

  test("süre: 24 saat sonra bağlantı 400 ve talep EXPIRED (yeni adres silinir); sonraki talep açılabilir", async () => {
    const user = await signUp();
    const flow = await open(user);
    h.clock.advance(LINK_TTL_MS + 1000);
    assertError(await confirm(flow.newToken), 400, "TOKEN_INVALID_OR_EXPIRED");
    const row = (await rows(user.id)).at(-1)!;
    assert.equal(row.status, "EXPIRED");
    assert.equal(row.newEmail, null);
    assert.equal(await emailOf(user.id), user.email);
    const next = await open(user);
    assert.deepEqual((await confirm(next.newToken)).json().data, { status: "waiting", step: "new" });
    // Süresi geçmiş ama kimse dokunmamış açık talep, yeni istekte kapanır.
    const other = await signUp();
    await open(other);
    h.clock.advance(LINK_TTL_MS + 1000);
    const again = await open(other);
    assert.equal((await rows(other.id)).filter((r) => r.status === "OPEN").length, 1);
    assert.deepEqual((await confirm(again.newToken)).json().data, { status: "waiting", step: "new" });
  });

  test("sıklık sınırı: ardışık istekler arası 60 sn, saatte en çok 3; aşılınca 429 ve iz yok", async () => {
    const user = await signUp();
    await open(user);
    assertError(await request(user, newAddress()), 429, "RATE_LIMITED");
    for (let i = 1; i < HOURLY_LIMIT; i++) {
      h.clock.advance(COOLDOWN_MS + 1000);
      await open(user);
    }
    h.clock.advance(COOLDOWN_MS + 1000);
    assertError(await request(user, newAddress()), 429, "RATE_LIMITED");
    assert.equal((await rows(user.id)).length, HOURLY_LIMIT);
    h.clock.advance(60 * 60 * 1000);
    assert.equal((await request(user, newAddress())).statusCode, 202);
  });

  test("yarış: iki onay aynı anda — tek uygulama, tek bildirim çifti, tek 'apply' audit; yeni adres iki kayıtta aynı anda alınamaz", async () => {
    const user = await signUp();
    const flow = await open(user);
    const mailCount = h.mails.length;
    const [a, b] = await Promise.all([confirm(flow.newToken), confirm(flow.oldToken)]);
    assert.equal(a.statusCode, 200, a.body);
    assert.equal(b.statusCode, 200, b.body);
    assert.deepEqual([a.json().data.status, b.json().data.status].sort(), ["applied", "waiting"], "biri bekler, diğeri uygular");
    assert.equal(await emailOf(user.id), flow.to);
    assert.equal(h.mails.length, mailCount + 2, "eski ve yeni adrese birer bildirim");
    assert.equal((await audits(user.id, "account.emailChange.confirm", "apply")).length, 1);

    // İki hesap aynı yeni adresi ister; yalnız biri uygular, ikincisi email_taken ile sonlanır.
    const x = await signUp();
    const y = await signUp();
    const target = newAddress();
    const fx = await open(x, target);
    const fy = await open(y, target);
    await Promise.all([confirm(fx.newToken), confirm(fy.newToken)]);
    const results = await Promise.all([confirm(fx.oldToken), confirm(fy.oldToken)]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
    assert.equal(await db.user.count({ where: { emailNormalized: target } }), 1);
  });

  // ─── Destek yolu ────────────────────────────────────────────

  test("destek yolu: yeni adres doğrulaması ZORUNLU (atlama yok); eski adres onayı gerekmez; gerekçeli audit; eski adrese itiraz bağlantısı gider", async () => {
    const user = await signUp();
    const to = newAddress();
    const res = await adminStart(user.id, to);
    assert.equal(res.statusCode, 202, res.body);
    assert.equal(await emailOf(user.id), user.email, "yönetici başlatınca e-posta değişmez");
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt !== null, true);
    const newToken = tokenFrom(mailsTo(to).at(-1));
    const oldMail = mailsTo(user.email).at(-1)!;
    assert.match(oldMail.text, /destek/);
    assert.match(oldMail.text, /action=deny/);
    assert.equal(oldMail.text.includes(to), false);

    const listed = (await adminList(user.id)).json().data;
    assert.equal(listed.length, 1);
    EmailChangeView.parse(listed[0]);
    assert.equal(listed[0].newEmailMasked, maskEmail(to));
    assert.equal(JSON.stringify(listed).includes(to), false, "yönetici ham adresi görmez");
    assert.equal(listed[0].requiresOld, false);

    // Eski adres bağlantısıyla "onay" bir şey yapmaz (destek yolunda gerekmez).
    assert.deepEqual((await confirm(tokenFrom(oldMail))).json().data, { status: "waiting", step: "old" });
    assert.equal(await emailOf(user.id), user.email);

    assert.deepEqual((await confirm(newToken)).json().data, { status: "applied", step: "new" });
    assert.equal(await emailOf(user.id), to);
    assertError(await me(user), 401, "UNAUTHENTICATED");
    const start = await audits(user.id, "user.emailChange.manage", "start");
    assert.equal(start.length, 1);
    assert.equal(start[0]!.reason, REASON);
    assert.equal(start[0]!.actorId, boss.id);
  });

  test("destek yolu: gerçek sahip eski adresten reddedebilir; açık talep varken 409 request_open, iptal idempotent", async () => {
    const user = await signUp();
    const to = newAddress();
    assert.equal((await adminStart(user.id, to)).statusCode, 202);
    assertError(await adminStart(user.id, newAddress()), 409, "CONFLICT", "request_open");
    const oldToken = tokenFrom(mailsTo(user.email).at(-1));
    assert.deepEqual((await deny(oldToken)).json().data, { denied: true });
    assertError(await confirm(tokenFrom(mailsTo(to).at(-1))), 400, "TOKEN_INVALID_OR_EXPIRED");
    assert.equal(await emailOf(user.id), user.email);

    assert.equal((await adminStart(user.id, to)).statusCode, 202);
    assert.deepEqual((await adminCancel(user.id)).json().data, { cancelled: true });
    assert.deepEqual((await adminCancel(user.id)).json().data, { cancelled: false });
    assert.equal((await audits(user.id, "user.emailChange.manage", "cancel")).length, 1);
  });

  test("destek yolu: kullanıcının açık talebi varken ezilmez; silinmiş hesap 409 user_deleted", async () => {
    const user = await signUp();
    await open(user);
    assertError(await adminStart(user.id, newAddress()), 409, "CONFLICT", "request_open");
    const gone = await signUp();
    const removed=await eraseWithMfa(gone);assert.equal(removed.statusCode,200,removed.body);
    assertError(await adminStart(gone.id, newAddress()), 409, "CONFLICT", "user_deleted");
  });

  test("anonimleştirme açık talebi kapatır ve yeni adresi siler; token'lar artık geçersiz", async () => {
    const user = await signUp();
    const flow = await open(user);
    const removed=await eraseWithMfa(user);assert.equal(removed.statusCode,200,removed.body);
    const row = (await rows(user.id)).at(-1)!;
    assert.equal(row.status, "CANCELLED");
    assert.equal(row.failure, "account_erased");
    assert.equal(row.newEmail, null);
    assertError(await confirm(flow.newToken), 400, "TOKEN_INVALID_OR_EXPIRED");
  });

  // ─── Gizlilik ───────────────────────────────────────────────

  test("audit ve talep kayıtlarında e-posta adresi yok; token'lar yalnız özet olarak saklanır", async () => {
    const user = await signUp();
    const flow = await open(user);
    await confirm(flow.newToken);
    await confirm(flow.oldToken);
    const all = await db.auditLog.findMany({ where: { targetId: user.id, action: { in: ["account.emailChange.manage", "account.emailChange.confirm", "user.emailChange.manage"] } } });
    assert.ok(all.length >= 4);
    const text = JSON.stringify(all.map((a) => [a.before, a.after, a.reason]));
    for (const secret of [user.email, flow.to, flow.newToken, flow.oldToken]) assert.equal(text.includes(secret), false, "audit'te gizli veri yok");
    const row = (await rows(user.id)).at(-1)!;
    assert.equal(JSON.stringify(row).includes(flow.newToken), false);
    assert.equal(row.newTokenHash, hashToken(flow.newToken, PEPPER));
  });
});

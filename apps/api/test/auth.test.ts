/**
 * KV-09 (#11) auth ve /me senaryoları.
 * Her senaryo bellek içi store ile koşar; TEST_DATABASE_URL tanımlıysa (CI) aynı senaryolar gerçek PostgreSQL ile de koşar.
 * Cevap gövdeleri test ortamında router tarafından sözleşme şemasıyla doğrulanır; uymayan cevap 500 olur.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, Me } from "@kararver/contracts";
import {
  createHarness,
  memoryBackend,
  PEPPER,
  prismaBackend,
  sessionCookie,
  tokenFrom,
  WEB_ORIGIN,
  type BackendFactory,
  type Harness,
} from "./support/harness.ts";

const HOUR = 60 * 60 * 1000;
const backends = [memoryBackend, prismaBackend()].filter((b): b is BackendFactory => b !== null);

for (const backend of backends) {
  describe(`auth (${backend.name})`, () => {
    let h: Harness;
    before(async () => {
      h = await createHarness(backend);
    });
    after(async () => {
      await h.close();
    });

    function uniq() {
      const id = randomUUID().replaceAll("-", "").slice(0, 10);
      return { email: `kisi_${id}@example.test`, username: `kisi_${id}`, displayName: "Test Kişi", password: "guclu-bir-sifre-1" };
    }

    async function post(url: string, body?: unknown, cookie?: string, extraHeaders: Record<string, string> = {}) {
      return h.app.inject({
        method: "POST",
        url: `/v1${url}`,
        headers: { origin: WEB_ORIGIN, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...extraHeaders },
        payload: body === undefined ? undefined : JSON.stringify(body),
      });
    }

    async function getMe(cookie?: string) {
      return h.app.inject({ method: "GET", url: "/v1/me", headers: cookie ? { cookie } : {} });
    }

    function assertError(res: { statusCode: number; json(): any }, status: number, code: string) {
      assert.equal(res.statusCode, status, JSON.stringify(res.json()));
      ErrorBody.parse(res.json());
      assert.equal(res.json().error.code, code);
    }

    /** Kayıt + doğrulama + giriş; oturum cookie'si ve kullanıcı id'si döner. */
    async function signUp(options: { verify?: boolean } = {}) {
      const account = uniq();
      const mailCount = h.mails.length;
      assert.equal((await post("/auth/register", account)).statusCode, 202);
      const verifyToken = tokenFrom(h.mails[mailCount]);
      if (options.verify !== false) assert.equal((await post("/auth/email/verify", { token: verifyToken })).statusCode, 200);
      const login = await post("/auth/login", { email: account.email, password: account.password });
      assert.equal(login.statusCode, 200, login.body);
      return { account, cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string, verifyToken };
    }

    // ─── Kayıt ──────────────────────────────────────────────────

    test("kayıt 202 döner ve 32 byte token içeren doğrulama bağlantısı gönderir", async () => {
      const account = uniq();
      const before = h.mails.length;
      const res = await post("/auth/register", account);
      assert.equal(res.statusCode, 202);
      assert.deepEqual(res.json(), { data: { status: "VERIFICATION_SENT" } });
      assert.equal(res.headers["cache-control"], "private, no-store");
      const mail = h.mails[before]!;
      assert.equal(mail.to, account.email);
      assert.match(mail.text, new RegExp(`^${WEB_ORIGIN}/dogrula#token=`, "m"));
      assert.equal(tokenFrom(mail).length, 43, "32 byte base64url");
    });

    test("kayıtlı e-posta (büyük/küçük harf farkı dahil) aynı 202'yi alır, yeni hesap açılmaz", async () => {
      const { account } = await signUp();
      const before = h.mails.length;
      const res = await post("/auth/register", { ...uniq(), email: account.email.toUpperCase() });
      assert.equal(res.statusCode, 202);
      assert.deepEqual(res.json(), { data: { status: "VERIFICATION_SENT" } });
      assert.equal(h.mails.length, before + 1);
      assert.match(h.mails[before]!.subject, /zaten bir hesabın var/);
      assert.doesNotMatch(h.mails[before]!.text, /#token=/);
    });

    test("alınmış kullanıcı adı 409 USERNAME_TAKEN", async () => {
      const { account } = await signUp();
      const res = await post("/auth/register", { ...uniq(), username: account.username });
      assertError(res, 409, "USERNAME_TAKEN");
      assert.deepEqual(res.json().error.details, [{ field: "username", code: "taken" }]);
    });

    test("geçersiz gövde 400 VALIDATION_ERROR ve alan detayı", async () => {
      const short = await post("/auth/register", { ...uniq(), password: "kisa" });
      assertError(short, 400, "VALIDATION_ERROR");
      assert.equal(short.json().error.details[0].field, "password");
      assertError(await post("/auth/register", { ...uniq(), role: "ADMIN" }), 400, "VALIDATION_ERROR");
      assertError(await post("/auth/register", { ...uniq(), username: "Büyük Harf" }), 400, "VALIDATION_ERROR");
      const broken = await h.app.inject({ method: "POST", url: "/v1/auth/register", headers: { "content-type": "application/json" }, payload: "{bozuk" });
      assertError(broken, 400, "VALIDATION_ERROR");
    });

    test("kayıt kapalıyken 503 FEATURE_DISABLED", async () => {
      h.registrationEnabled.value = false;
      try {
        assertError(await post("/auth/register", uniq()), 503, "FEATURE_DISABLED");
      } finally {
        h.registrationEnabled.value = true;
      }
    });

    // ─── Giriş / oturum ─────────────────────────────────────────

    test("giriş: yanlış şifre ve bilinmeyen e-posta aynı 401'i alır", async () => {
      const { account } = await signUp();
      const wrong = await post("/auth/login", { email: account.email, password: "yanlis-sifre-123" });
      const unknown = await post("/auth/login", { email: "yok@example.test", password: "yanlis-sifre-123" });
      assertError(wrong, 401, "INVALID_CREDENTIALS");
      assertError(unknown, 401, "INVALID_CREDENTIALS");
      assert.equal(wrong.json().error.message, unknown.json().error.message);
      assert.equal(wrong.headers["set-cookie"], undefined);
    });

    test("giriş httpOnly/SameSite=Lax cookie ayarlar ve Me döner; parola hash'i sızmaz", async () => {
      const account = uniq();
      await post("/auth/register", account);
      const res = await post("/auth/login", { email: account.email.toUpperCase(), password: account.password });
      assert.equal(res.statusCode, 200);
      const cookie = String(res.headers["set-cookie"]);
      assert.match(cookie, /^kv_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
      const me = Me.parse(res.json().data);
      assert.equal(me.emailVerified, false);
      assert.deepEqual(me.roles, ["USER"]);
      assert.doesNotMatch(res.body, /argon2|passwordHash/);
    });

    test("/me: oturum yoksa 401, varsa kendi hesabı; iki kullanıcı birbirinin e-postasını görmez", async () => {
      assertError(await getMe(), 401, "UNAUTHENTICATED");
      assertError(await getMe("kv_session=uydurma-token"), 401, "UNAUTHENTICATED");
      const a = await signUp();
      const b = await signUp();
      const meA = await getMe(a.cookie);
      const meB = await getMe(b.cookie);
      assert.equal(meA.json().data.email, a.account.email);
      assert.equal(meB.json().data.email, b.account.email);
      assert.doesNotMatch(meA.body, new RegExp(b.account.email));
      assert.equal(meA.headers["cache-control"], "private, no-store");
    });

    test("oturum süresi dolunca 401 ve cookie temizlenir", async () => {
      const { cookie } = await signUp();
      h.clock.advance(31 * 24 * HOUR);
      try {
        const res = await getMe(cookie);
        assertError(res, 401, "UNAUTHENTICATED");
        assert.match(String(res.headers["set-cookie"]), /Max-Age=0/);
      } finally {
        h.clock.advance(-31 * 24 * HOUR);
      }
    });

    test("çıkış oturumu iptal eder; eski cookie artık geçmez", async () => {
      const { cookie, id } = await signUp();
      const res = await post("/auth/logout", undefined, cookie);
      assert.equal(res.statusCode, 204);
      assert.equal(res.body, "");
      assert.match(String(res.headers["set-cookie"]), /^kv_session=; .*Max-Age=0/);
      assertError(await getMe(cookie), 401, "UNAUTHENTICATED");
      assert.equal(await h.activeSessions(id), 0);
      assertError(await post("/auth/logout"), 401, "UNAUTHENTICATED");
    });

    test("BANNED/SUSPENDED: doğru şifreyle giriş 403, açık oturum 403 ACCOUNT_RESTRICTED", async () => {
      const { account, cookie, id } = await signUp();
      await h.setStatus(id, "SUSPENDED");
      const login = await post("/auth/login", { email: account.email, password: account.password });
      assertError(login, 403, "ACCOUNT_RESTRICTED");
      assert.deepEqual(login.json().error.details, [{ code: "login" }]);
      assertError(await getMe(cookie), 403, "ACCOUNT_RESTRICTED");
      // Yanlış şifrede hesap durumu açığa çıkmaz.
      assertError(await post("/auth/login", { email: account.email, password: "yanlis-sifre-123" }), 401, "INVALID_CREDENTIALS");
      await h.setStatus(id, "RESTRICTED");
      assert.equal((await getMe(cookie)).statusCode, 200, "RESTRICTED işlem bazlı kısıtlanır, oturum açık kalır");
    });

    // ─── E-posta doğrulama ──────────────────────────────────────

    test("doğrulama token'ı tek kullanımlık", async () => {
      const { cookie, verifyToken } = await signUp();
      assert.equal((await getMe(cookie)).json().data.emailVerified, true);
      assertError(await post("/auth/email/verify", { token: verifyToken }), 400, "TOKEN_INVALID_OR_EXPIRED");
      assertError(await post("/auth/email/verify", { token: "x".repeat(43) }), 400, "TOKEN_INVALID_OR_EXPIRED");
    });

    test("doğrulama token'ı 24 saat sonra geçersiz; yeniden gönderim eskisini iptal eder", async () => {
      const { cookie, verifyToken } = await signUp({ verify: false });
      h.clock.advance(25 * HOUR);
      try {
        assertError(await post("/auth/email/verify", { token: verifyToken }), 400, "TOKEN_INVALID_OR_EXPIRED");
      } finally {
        h.clock.advance(-25 * HOUR);
      }
      const first = h.mails.length;
      assert.equal((await post("/auth/email/resend", undefined, cookie)).statusCode, 202);
      assert.equal((await post("/auth/email/resend", undefined, cookie)).statusCode, 202);
      const older = tokenFrom(h.mails[first]);
      const newest = tokenFrom(h.mails[first + 1]);
      assertError(await post("/auth/email/verify", { token: older }), 400, "TOKEN_INVALID_OR_EXPIRED");
      assert.equal((await post("/auth/email/verify", { token: newest })).statusCode, 200);
      assert.equal((await getMe(cookie)).json().data.emailVerified, true);

      const afterVerify = h.mails.length;
      assert.equal((await post("/auth/email/resend", undefined, cookie)).statusCode, 202);
      assert.equal(h.mails.length, afterVerify, "doğrulanmış hesaba tekrar mail gitmez");
    });

    test("aynı doğrulama token'ıyla paralel istekten sadece biri başarılı", async () => {
      const { verifyToken } = await signUp({ verify: false });
      const results = await Promise.all([1, 2, 3].map(() => post("/auth/email/verify", { token: verifyToken })));
      assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 400, 400]);
    });

    // ─── Şifre sıfırlama ───────────────────────────────────────

    test("şifremi unuttum: hesap olsun olmasın 202; sadece hesap varsa mail", async () => {
      const before = h.mails.length;
      const unknown = await post("/auth/password/forgot", { email: "yok@example.test" });
      assert.equal(unknown.statusCode, 202);
      assert.equal(h.mails.length, before);
      const { account } = await signUp();
      const known = await post("/auth/password/forgot", { email: account.email });
      assert.equal(known.statusCode, 202);
      assert.equal(known.body, unknown.body);
      assert.match(h.mails.at(-1)!.text, new RegExp(`^${WEB_ORIGIN}/sifre-yenile#token=`, "m"));
    });

    test("sıfırlama: yeni şifre geçer, eski geçmez, bütün oturumlar kapanır, token tek kullanımlık", async () => {
      const { account, cookie, id } = await signUp();
      const second = sessionCookie((await post("/auth/login", { email: account.email, password: account.password })).headers["set-cookie"]);
      assert.equal(await h.activeSessions(id), 2);

      await post("/auth/password/forgot", { email: account.email });
      const token = tokenFrom(h.mails.at(-1));
      const reset = await post("/auth/password/reset", { token, password: "yepyeni-sifre-42" });
      assert.equal(reset.statusCode, 204);
      assert.equal(await h.activeSessions(id), 0);
      assertError(await getMe(cookie), 401, "UNAUTHENTICATED");
      assertError(await getMe(second), 401, "UNAUTHENTICATED");

      assertError(await post("/auth/password/reset", { token, password: "baska-sifre-4242" }), 400, "TOKEN_INVALID_OR_EXPIRED");
      assertError(await post("/auth/login", { email: account.email, password: account.password }), 401, "INVALID_CREDENTIALS");
      assert.equal((await post("/auth/login", { email: account.email, password: "yepyeni-sifre-42" })).statusCode, 200);
    });

    test("sıfırlama token'ı 1 saat sonra ve yenisi istenince geçersiz", async () => {
      const { account } = await signUp();
      await post("/auth/password/forgot", { email: account.email });
      const first = tokenFrom(h.mails.at(-1));
      await post("/auth/password/forgot", { email: account.email });
      const second = tokenFrom(h.mails.at(-1));
      assertError(await post("/auth/password/reset", { token: first, password: "yepyeni-sifre-42" }), 400, "TOKEN_INVALID_OR_EXPIRED");
      h.clock.advance(61 * 60 * 1000);
      try {
        assertError(await post("/auth/password/reset", { token: second, password: "yepyeni-sifre-42" }), 400, "TOKEN_INVALID_OR_EXPIRED");
      } finally {
        h.clock.advance(-61 * 60 * 1000);
      }
    });

    test("doğrulama token'ı şifre sıfırlamada, sıfırlama token'ı doğrulamada kullanılamaz", async () => {
      const { account, verifyToken } = await signUp({ verify: false });
      assertError(await post("/auth/password/reset", { token: verifyToken, password: "yepyeni-sifre-42" }), 400, "TOKEN_INVALID_OR_EXPIRED");
      await post("/auth/password/forgot", { email: account.email });
      assertError(await post("/auth/email/verify", { token: tokenFrom(h.mails.at(-1)) }), 400, "TOKEN_INVALID_OR_EXPIRED");
    });

    // ─── Profil ─────────────────────────────────────────────────

    test("PATCH /me görünen ad ve biyografiyi günceller; boş gövde 400", async () => {
      const { cookie } = await signUp();
      const patch = (body: unknown) =>
        h.app.inject({ method: "PATCH", url: "/v1/me", headers: { origin: WEB_ORIGIN, cookie, "content-type": "application/json" }, payload: JSON.stringify(body) });
      const res = await patch({ displayName: "  Yeni Ad  ", bio: "Araba meraklısı" });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().data.displayName, "Yeni Ad");
      assert.equal(res.json().data.bio, "Araba meraklısı");
      assert.equal((await patch({ bio: null })).json().data.bio, null);
      assertError(await patch({}), 400, "VALIDATION_ERROR");
      assertError(await patch({ email: "yeni@example.test" }), 400, "VALIDATION_ERROR");
    });

    test("avatar: başkasının veya AVATAR olmayan görsel 409; bekleyen görsel URL'siz, onaylı görsel URL'li", async () => {
      const owner = await signUp();
      const other = await signUp();
      const patch = (avatarMediaId: string | null) =>
        h.app.inject({
          method: "PATCH",
          url: "/v1/me",
          headers: { origin: WEB_ORIGIN, cookie: owner.cookie, "content-type": "application/json" },
          payload: JSON.stringify({ avatarMediaId }),
        });

      const foreign = await h.addMedia(other.id, { purpose: "AVATAR", status: "APPROVED" });
      assertError(await patch(foreign.id), 409, "MEDIA_NOT_USABLE");
      const pollImage = await h.addMedia(owner.id, { purpose: "POLL", status: "APPROVED" });
      assertError(await patch(pollImage.id), 409, "MEDIA_NOT_USABLE");
      const rejected = await h.addMedia(owner.id, { purpose: "AVATAR", status: "REJECTED" });
      assertError(await patch(rejected.id), 409, "MEDIA_NOT_USABLE");

      const pending = await h.addMedia(owner.id, { purpose: "AVATAR", status: "PENDING" });
      assert.equal((await patch(pending.id)).json().data.avatarUrl, null);
      const approved = await h.addMedia(owner.id, { purpose: "AVATAR", status: "APPROVED" });
      assert.equal((await patch(approved.id)).json().data.avatarUrl, `http://cdn.test/media/${approved.publicKey}`);
      assert.equal((await patch(null)).json().data.avatarUrl, null);
    });

    // ─── HTTP güvenliği ve format ───────────────────────────────

    test("CSRF: izinsiz Origin veya cross-site mutation 403; izinli Origin CORS başlıklarını alır", async () => {
      const { cookie } = await signUp();
      const evil = await post("/auth/logout", undefined, cookie, { origin: "https://kotu.example" });
      assertError(evil, 403, "FORBIDDEN");
      const crossSite = await h.app.inject({ method: "POST", url: "/v1/auth/logout", headers: { cookie, "sec-fetch-site": "cross-site" } });
      assertError(crossSite, 403, "FORBIDDEN");
      assert.equal((await getMe(cookie)).statusCode, 200, "reddedilen istek oturumu kapatmadı");

      const preflight = await h.app.inject({
        method: "OPTIONS",
        url: "/v1/auth/login",
        headers: { origin: WEB_ORIGIN, "access-control-request-method": "POST" },
      });
      assert.equal(preflight.statusCode, 204);
      assert.equal(preflight.headers["access-control-allow-origin"], WEB_ORIGIN);
      assert.equal(preflight.headers["access-control-allow-credentials"], "true");
      const badPreflight = await h.app.inject({
        method: "OPTIONS",
        url: "/v1/auth/login",
        headers: { origin: "https://kotu.example", "access-control-request-method": "POST" },
      });
      assert.equal(badPreflight.statusCode, 403);
      assert.equal(badPreflight.headers["access-control-allow-origin"], undefined);
    });

    test("X-Request-Id: gelen değer korunur, yoksa üretilir; hata gövdesindeki requestId ile aynı", async () => {
      const given = await h.app.inject({ method: "GET", url: "/v1/me", headers: { "x-request-id": "istek-12345678" } });
      assert.equal(given.headers["x-request-id"], "istek-12345678");
      assert.equal(given.json().requestId, "istek-12345678");
      const generated = await h.app.inject({ method: "GET", url: "/v1/yok" });
      assertError(generated, 404, "NOT_FOUND");
      assert.equal(generated.json().requestId, generated.headers["x-request-id"]);
    });

    test("loglarda parola, oturum veya doğrulama token'ı yok", async () => {
      h.logs.length = 0;
      const { account, cookie, verifyToken } = await signUp();
      await post("/auth/password/forgot", { email: account.email });
      await getMe(cookie);
      const all = h.logs.join("\n");
      assert.ok(h.logs.length > 0, "istek logları yakalanmalı");
      for (const secret of [account.password, cookie.split("=")[1]!, verifyToken, tokenFrom(h.mails.at(-1)), PEPPER]) {
        assert.equal(all.includes(secret), false);
      }
    });
  });
}

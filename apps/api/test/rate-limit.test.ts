/**
 * KV-19 (#21) hız sınırı. Değerler: DEFAULT_RATE_LIMIT_SETTINGS (contracts `limits.*` önerileri). Her test kendi
 * IP'sini kullanır (inject remoteAddress): sayaçlar aynı test veritabanını paylaşan diğer testlerden etkilenmez.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, headers, PollDetail } from "@kararver/contracts";
import { loadConfig } from "../src/config.ts";
import { DEFAULT_RATE_LIMIT_SETTINGS, LOGIN_WINDOW_MS, MINUTE } from "../src/modules/rate-limit/policy.ts";
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

const backends = [memoryBackend, prismaBackend()].filter((b): b is BackendFactory => b !== null);
const postgres = prismaBackend();

type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };
type User = { id: string; email: string; password: string; cookie: string };

/**
 * Her senaryoya rastgele ayrı IP. Harness saati sabit olduğundan önceki koşuların sayaçları aynı pencerede kalır;
 * sürece bağlı (pid) IP, Windows pid'i yeniden kullanınca eski sayaca denk gelebiliyordu.
 */
const freshIp = () => {
  const b = randomBytes(3);
  return `10.${b[0]}.${b[1]}.${b[2]}`;
};

function client(h: Harness, ip: string) {
  const send = (method: "POST" | "PUT" | "GET", url: string, body?: unknown, cookie?: string) =>
    h.app.inject({
      method,
      url: `/v1${url}`,
      remoteAddress: ip,
      headers: {
        origin: WEB_ORIGIN,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
        // Yazma uç noktalarının bir kısmı Idempotency-Key ister; diğerleri başlığı yok sayar.
        ...(method === "POST" ? { "idempotency-key": `rl-${randomUUID()}` } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    }) as Promise<Res>;
  return {
    send,
    login: (email: string, password: string) => send("POST", "/auth/login", { email, password }),
    async signUp(): Promise<User> {
      const id = randomUUID().replaceAll("-", "").slice(0, 10);
      const account = { email: `rl_${id}@example.test`, username: `rl_${id}`, displayName: "Hız", password: "guclu-bir-sifre-1" };
      const mailCount = h.mails.length;
      assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
      assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
      const res = await send("POST", "/auth/login", { email: account.email, password: account.password });
      assert.equal(res.statusCode, 200, res.body);
      return { id: res.json().data.id, email: account.email, password: account.password, cookie: sessionCookie(res.headers["set-cookie"] as string) };
    },
  };
}

function assertLimited(res: Res, maxRetry: number) {
  assert.equal(res.statusCode, 429, res.body);
  ErrorBody.parse(res.json());
  assert.equal(res.json().error.code, "RATE_LIMITED");
  const retry = Number(res.headers[headers.retryAfter.toLowerCase()]);
  assert.ok(Number.isInteger(retry) && retry >= 1 && retry <= maxRetry, `Retry-After ${retry} (≤ ${maxRetry})`);
  assert.equal(res.json().error.details[0].message, String(retry));
  return retry;
}

for (const factory of backends) {
  describe(`hız sınırı: auth (${factory.name})`, () => {
    let h: Harness;
    before(async () => {
      h = await createHarness(factory);
    });
    after(async () => {
      await h?.close();
    });
    const strict = () => Object.assign(h.rateLimitSettings, DEFAULT_RATE_LIMIT_SETTINGS);
    const relaxed = () => {
      for (const k of Object.keys(h.rateLimitSettings)) (h.rateLimitSettings as Record<string, number>)[k] = 1_000_000;
    };

    test("giriş: e-posta başına 5 başarısız deneme; 6. deneme doğru parolayla da 429; pencere bitince açılır", async () => {
      const c = client(h, freshIp());
      const u = await c.signUp();
      strict();
      try {
        for (let i = 0; i < 5; i++) assert.equal((await c.login(u.email, "yanlis-sifre-123")).statusCode, 401);
        const retry = assertLimited(await c.login(u.email, u.password), LOGIN_WINDOW_MS / 1000);
        // Büyük/küçük harf farkı aynı hesaptır; başka IP'den de aynı e-posta kilitli.
        assertLimited(await client(h, freshIp()).login(u.email.toUpperCase(), u.password), LOGIN_WINDOW_MS / 1000);
        h.clock.advance(retry * 1000);
        assert.equal((await c.login(u.email, u.password)).statusCode, 200);
      } finally {
        relaxed();
      }
    });

    test("giriş: başarılı giriş e-posta sayacını sıfırlar; var olmayan hesap da sayılır", async () => {
      const c = client(h, freshIp());
      const u = await c.signUp();
      strict();
      try {
        for (let i = 0; i < 4; i++) assert.equal((await c.login(u.email, "yanlis-sifre-123")).statusCode, 401);
        assert.equal((await c.login(u.email, u.password)).statusCode, 200);
        for (let i = 0; i < 4; i++) assert.equal((await c.login(u.email, "yanlis-sifre-123")).statusCode, 401, "sayaç sıfırlandı");
        const ghost = `yok_${randomUUID()}@example.test`;
        for (let i = 0; i < 5; i++) assert.equal((await c.login(ghost, "yanlis-sifre-123")).statusCode, 401);
        assertLimited(await c.login(ghost, "yanlis-sifre-123"), LOGIN_WINDOW_MS / 1000);
      } finally {
        relaxed();
      }
    });

    test("giriş: IP başına 20 başarısız deneme; aynı IP'den yeni e-posta da 429, başka IP etkilenmez", async () => {
      const ip = freshIp();
      const c = client(h, ip);
      const victim = await client(h, freshIp()).signUp();
      strict();
      try {
        for (let i = 0; i < 20; i++) assert.equal((await c.login(`tahmin_${i}_${randomUUID()}@example.test`, "x-yanlis-123")).statusCode, 401);
        assertLimited(await c.login(victim.email, victim.password), LOGIN_WINDOW_MS / 1000);
        assert.equal((await client(h, freshIp()).login(victim.email, victim.password)).statusCode, 200);
      } finally {
        relaxed();
      }
    });

    test("kayıt IP başına saatte 5; şifre sıfırlama e-posta başına saatte 3, IP başına 10", async () => {
      strict();
      try {
        const reg = client(h, freshIp());
        for (let i = 0; i < 5; i++) {
          const id = randomUUID().slice(0, 8);
          const r = await reg.send("POST", "/auth/register", { email: `r${id}@example.test`, username: `r_${id}`, displayName: "R", password: "guclu-bir-sifre-1" });
          assert.equal(r.statusCode, 202, r.body);
        }
        assertLimited(
          await reg.send("POST", "/auth/register", { email: "son@example.test", username: "son_kayit", displayName: "R", password: "guclu-bir-sifre-1" }),
          3600,
        );

        const fp = client(h, freshIp());
        const email = `kurban_${randomUUID().slice(0, 8)}@example.test`;
        for (let i = 0; i < 3; i++) assert.equal((await fp.send("POST", "/auth/password/forgot", { email })).statusCode, 202);
        assertLimited(await fp.send("POST", "/auth/password/forgot", { email: email.toUpperCase() }), 3600);
        // IP sınırı: farklı e-postalarla 10'a kadar (yukarıdaki 4 dahil).
        for (let i = 0; i < 6; i++) assert.equal((await fp.send("POST", "/auth/password/forgot", { email: `b${i}_${email}` })).statusCode, 202);
        assertLimited(await fp.send("POST", "/auth/password/forgot", { email: `son_${email}` }), 3600);
      } finally {
        relaxed();
      }
    });

    test("okuma uç noktaları sınırlanmaz (arama hariç); loglar e-posta, IP ve kullanıcı kimliği içermez", async () => {
      const ip = freshIp();
      const c = client(h, ip);
      const u = await c.signUp();
      strict();
      h.rateLimitSettings.searchesPerMinute = 2;
      try {
        for (let i = 0; i < 70; i++) assert.equal((await c.send("GET", "/me", undefined, u.cookie)).statusCode, 200);
        for (let i = 0; i < 5; i++) await c.login(u.email, "yanlis-sifre-123");
        assertLimited(await c.login(u.email, u.password), LOGIN_WINDOW_MS / 1000);
        const logs = h.logs.join("\n");
        assert.match(logs, /giriş denemesi sınırı/);
        assert.match(logs, /"rules":\["login\.email"\]/);
        for (const secret of [u.email, ip, u.id, u.password]) assert.ok(!logs.includes(`"rateLimit":{"endpoint":"auth.login","rules":["login.email"],"keys":["${secret}`), secret);
        const limitLines = h.logs.filter((l) => l.includes('"rateLimit"'));
        assert.ok(limitLines.length > 0);
        for (const line of limitLines) for (const secret of [u.email, ip, u.id]) assert.ok(!line.includes(secret), `logda ${secret}`);
      } finally {
        relaxed();
      }
    });
  });
}

describe("hız sınırı: içerik ve çoklu süreç (postgres)", { skip: postgres ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let h2: Harness;
  let categoryId: string;
  before(async () => {
    h = await createHarness(postgres!);
    h2 = await createHarness(postgres!);
    categoryId = (await h.prisma!.category.create({ data: { slug: `rl-${randomUUID().slice(0, 8)}`, name: "Hız" } })).id;
  });
  after(async () => {
    await h?.close();
    await h2?.close();
  });
  const strict = () => {
    Object.assign(h.rateLimitSettings, DEFAULT_RATE_LIMIT_SETTINGS);
    Object.assign(h2.rateLimitSettings, DEFAULT_RATE_LIMIT_SETTINGS);
  };
  const relaxed = () => {
    for (const s of [h.rateLimitSettings, h2.rateLimitSettings]) for (const k of Object.keys(s)) (s as Record<string, number>)[k] = 1_000_000;
  };
  /** Hesabı "normal" yap: açılışı uygulama saatinden 30 gün önceye çek (yeni hesap = ilk 7 gün). */
  const age = (u: User) => h.prisma!.user.update({ where: { id: u.id }, data: { createdAt: new Date(h.clock.now.getTime() - 30 * 24 * 3600_000) } });

  async function poll(c: ReturnType<typeof client>, owner: User) {
    const res = await c.send("POST", "/polls", {
      kind: "POLL",
      title: `Hız sınırı ${randomUUID().slice(0, 8)}`,
      categoryId,
      durationHours: 48,
      resultsVisibility: "ALWAYS",
      options: [{ label: "A" }, { label: "B" }],
    }, owner.cookie);
    assert.equal(res.statusCode, 201, res.body);
    return PollDetail.parse(res.json().data);
  }

  test("yorum burst: normal hesap dakikada 6, yeni hesap 3; Retry-After pencere sonuna kadar", async () => {
    const c = client(h, freshIp());
    const owner = await c.signUp();
    const p = await poll(c, owner);
    const [veteran, newbie] = [await c.signUp(), await c.signUp()];
    await age(veteran);
    strict();
    try {
      const comment = (u: User, i: number) => c.send("POST", `/polls/${p.id}/comments`, { body: `Yorum ${i}` }, u.cookie);
      for (let i = 0; i < 6; i++) assert.equal((await comment(veteran, i)).statusCode, 201);
      assertLimited(await comment(veteran, 7), 60);
      for (let i = 0; i < 3; i++) assert.equal((await comment(newbie, i)).statusCode, 201);
      assertLimited(await comment(newbie, 4), 60);
      // Bir sonraki dakika açılır.
      h.clock.advance(MINUTE);
      assert.equal((await comment(newbie, 5)).statusCode, 201);
    } finally {
      relaxed();
    }
  });

  test("yorum günlük sınır: Retry-After UTC gün sonuna kadar", async () => {
    const c = client(h, freshIp());
    const owner = await c.signUp();
    const p = await poll(c, owner);
    const u = await c.signUp();
    await age(u);
    strict();
    h.rateLimitSettings.commentsPerDay = 2;
    try {
      for (let i = 0; i < 2; i++) assert.equal((await c.send("POST", `/polls/${p.id}/comments`, { body: `G ${i}` }, u.cookie)).statusCode, 201);
      const now = h.clock.now.getTime();
      const toMidnight = Math.ceil((Math.floor(now / 86_400_000) * 86_400_000 + 86_400_000 - now) / 1000);
      const retry = assertLimited(await c.send("POST", `/polls/${p.id}/comments`, { body: "G 3" }, u.cookie), 86_400);
      assert.equal(retry, toMidnight);
    } finally {
      relaxed();
    }
  });

  test("oy: yeni hesap dakikada 15; genel yazma sınırı (tepki) normal hesapta ayarla düşürülebilir", async () => {
    const c = client(h, freshIp());
    const owner = await c.signUp();
    const polls = [];
    for (let i = 0; i < 16; i++) polls.push(await poll(c, owner));
    const newbie = await c.signUp();
    strict();
    try {
      for (let i = 0; i < 15; i++) {
        const r = await c.send("PUT", `/polls/${polls[i]!.id}/vote`, { optionId: polls[i]!.options[0]!.id }, newbie.cookie);
        assert.equal(r.statusCode, 201, r.body);
      }
      assertLimited(await c.send("PUT", `/polls/${polls[15]!.id}/vote`, { optionId: polls[15]!.options[0]!.id }, newbie.cookie), 60);

      const veteran = await (async () => {
        relaxed();
        const v = await c.signUp();
        await age(v);
        strict();
        return v;
      })();
      h.rateLimitSettings.writesPerMinute = 2;
      for (let i = 0; i < 2; i++) {
        const b = await c.send("PUT", `/polls/${polls[i]!.id}/reaction`, { value: "LIKE" }, veteran.cookie);
        assert.ok(b.statusCode < 300, `${b.statusCode} ${b.body}`);
      }
      assertLimited(await c.send("PUT", `/polls/${polls[2]!.id}/reaction`, { value: "LIKE" }, veteran.cookie), 60);
    } finally {
      relaxed();
    }
  });

  test("çoklu süreç: iki API örneği aynı veritabanında; 40 eşzamanlı aramadan tam limit kadarı geçer", async () => {
    const ip = freshIp();
    strict();
    h.rateLimitSettings.searchesPerMinute = 10;
    h2.rateLimitSettings.searchesPerMinute = 10;
    // İki örnek aynı dakikada olsun.
    h2.clock.now = new Date(h.clock.now);
    try {
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, i) => client(i % 2 === 0 ? h : h2, ip).send("GET", "/search?q=araba")),
      );
      const ok = results.filter((r) => r.statusCode === 200).length;
      const limited = results.filter((r) => r.statusCode === 429).length;
      assert.deepEqual([ok, limited], [10, 30], results.find((r) => r.statusCode !== 200 && r.statusCode !== 429)?.body);
    } finally {
      relaxed();
    }
  });
});

describe("hız sınırı: yapılandırma", () => {
  const base = {
    APP_ENV: "staging",
    WEB_URL: WEB_ORIGIN,
    API_URL: "http://localhost:4000",
    SESSION_COOKIE_SECURE: "true",
    AUTH_TOKEN_PEPPER: PEPPER,
    MAIL_FROM: "KararVer <no-reply@kararver.test>",
    MAIL_TRANSPORT: "smtp",
    SMTP_URL: "smtp://u:p@smtp.test:587",
    MEDIA_PUBLIC_BASE_URL: "http://cdn.test/media",
    S3_ENDPOINT: "http://s3.test",
    S3_ACCESS_KEY_ID: "k",
    S3_SECRET_ACCESS_KEY: "s",
    S3_BUCKET_PRIVATE: "priv",
    S3_BUCKET_PUBLIC: "pub",
  };
  test("staging/production'da kapatılamaz; local'de kapatılabilir (yük testi)", () => {
    assert.equal(loadConfig(base).rateLimitEnabled, true);
    assert.throws(() => loadConfig({ ...base, RATE_LIMIT_ENABLED: "false" }), /RATE_LIMIT_ENABLED/);
    assert.equal(loadConfig({ ...base, APP_ENV: "local", SESSION_COOKIE_SECURE: "false", RATE_LIMIT_ENABLED: "false" }).rateLimitEnabled, false);
  });

  test("DEFAULT_RATE_LIMIT_SETTINGS anahtarları contracts limits.* ile birebir ve aralıkta", async () => {
    const { settingsRegistry, settingKeys } = await import("@kararver/contracts");
    const keys = settingKeys.filter((k: string) => k.startsWith("limits.")).map((k: string) => k.slice("limits.".length)).sort();
    assert.deepEqual(keys, Object.keys(DEFAULT_RATE_LIMIT_SETTINGS).sort());
    for (const [k, v] of Object.entries(DEFAULT_RATE_LIMIT_SETTINGS)) {
      const d = (settingsRegistry as unknown as Record<string, { min: number; max: number; default: { value: number } }>)[`limits.${k}`]!;
      assert.ok(v >= d.min && v <= d.max, k);
      assert.equal(d.default.value, v, `${k}: API değeri contracts varsayılanıyla aynı`);
    }
  });
});

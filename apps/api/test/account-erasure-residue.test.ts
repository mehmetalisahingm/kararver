/**
 * #372 bağımsız denetim — hesap anonimleştirmesinden sonra kalan izler (#181/#321).
 * Değişmez kural: silinen hesabın kimliği olay kuyruğunda (domain_events) kalmaz ve kalan "anonim" oy kaydı
 * zaman damgasıyla kişiye geri bağlanamaz. Not: main'de oy ucu henüz vote.* olayı yazmıyor (votes/routes.ts:
 * "outbox ile gelir"); o geldiğinde aynı kural oy seçimini (optionId) de kapsamalı. `todo` işaretliler bugün AÇIK (#372 ikinci rapor); kapandıkça işaret kaldırılır.
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL veya .env). Veriler sentetiktir.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { decodeBase32, hotp } from "../src/modules/security/totp.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string; username: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };
const REASON = "KVKK silme talebi; kimlik destek kanalında doğrulandı";

describe("hesap anonimleştirmesinden sonra kalan izler (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let boss: User;
  let bossSecret: string;
  let categoryId: string;
  let gateQueue: Promise<void> = Promise.resolve();

  const send = (method: "GET" | "POST" | "PUT", url: string, body?: unknown, cookie?: string) =>
    h.app.inject({
      method,
      url: `/v1${url}`,
      headers: { origin: WEB_ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      payload: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as Promise<Res>;

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `rs_${id}@example.test`, username: `rs_${id}`, displayName: `Ad ${id}`, password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id, username: account.username };
  }

  /** SUPER_ADMIN taze step-up'ı tek tek alır (silme onu tüketir). */
  async function erase(user: User): Promise<Res> {
    gateQueue = gateQueue.then(async () => {
      const status = await send("GET", "/me/mfa", undefined, boss.cookie);
      if (!status.json().data.stepUpExpiresAt) {
        h.clock.advance(30000);
        const gate = await send("POST", "/me/mfa/step-up", { code: hotp(decodeBase32(bossSecret), Math.floor(h.clock.now.getTime() / 30000)) }, boss.cookie);
        assert.equal(gate.statusCode, 200, gate.body);
      }
    });
    await gateQueue;
    return send("POST", `/admin/users/${user.id}/erasure`, { reason: REASON, confirmUsername: user.username }, boss.cookie);
  }

  async function poll(authorId: string) {
    return db.poll.create({
      data: {
        authorId, categoryId, publicId: randomUUID().replaceAll("-", "").slice(0, 12), slug: "kalan-iz",
        title: "Kalan iz testi", closesAt: new Date("2031-01-01T00:00:00Z"),
        options: { create: [{ position: 0, label: "Evet" }, { position: 1, label: "Hayır" }] },
      },
      select: { id: true, options: { orderBy: { position: "asc" }, select: { id: true } } },
    });
  }

  /** Gerçek oy ucu: oy ve vote_events aynı yoldan yazılır. */
  async function vote(voter: User, pollId: string, optionId: string) {
    const res = await send("PUT", `/polls/${pollId}/vote`, { optionId }, voter.cookie);
    assert.ok([200, 201].includes(res.statusCode), res.body);
  }

  before(async () => {
    h = await createHarness(backend!, { realSettings: true });
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `rs-${randomUUID().slice(0, 8)}`, name: "Kalan iz testi" } })).id;
    boss = await signUp();
    await db.userRole.create({ data: { userId: boss.id, role: "SUPER_ADMIN" } });
    const setup = await send("POST", "/me/mfa/setup", { password: "guclu-bir-sifre-1" }, boss.cookie);
    assert.equal(setup.statusCode, 200, setup.body);
    bossSecret = setup.json().data.secret;
    const confirm = await send("POST", "/me/mfa/confirm", { code: hotp(decodeBase32(bossSecret), Math.floor(h.clock.now.getTime() / 30000)) }, boss.cookie);
    assert.equal(confirm.statusCode, 200, confirm.body);
  });
  after(async () => { await h?.close(); });

  /** Gerçek yorum ucu: comment.created olayı yorum sahibini actor_id olarak yazar. */
  async function comment(author: User, pollId: string) {
    const res = await send("POST", `/polls/${pollId}/comments`, { body: "Bu konuda düşüncem farklı." }, author.cookie);
    assert.equal(res.statusCode, 201, res.body);
  }

  test("kontrol: yorum ucu, yazanın kimliğiyle bir olay yazar (aşağıdaki test boş geçmesin)", async () => {
    const author = await signUp();
    const commenter = await signUp();
    const p = await poll(author.id);
    await comment(commenter, p.id);
    assert.ok(await db.domainEvent.count({ where: { actorId: commenter.id, type: "comment.created" } }) >= 1, "comment.created yazılmadı; kurgu geçersiz");
  });

  test("silmeden sonra domain_events'te kişinin kimliği kalmaz (actor_id, natural_key)", { todo: "AÇIK (#372 §3): hesap silme domain_events'e dokunmuyor" }, async () => {
    const author = await signUp();
    const commenter = await signUp();
    const p = await poll(author.id);
    await comment(commenter, p.id);
    assert.equal((await erase(commenter)).statusCode, 200);
    assert.equal(await db.domainEvent.count({ where: { actorId: commenter.id } }), 0, "actor_id silinen hesabı gösteriyor");
    assert.equal(await db.domainEvent.count({ where: { naturalKey: { contains: commenter.id } } }), 0, "natural_key silinen hesabın kimliğini taşıyor");
  });

  test("teslim edilemeyen (dispatch_error) olaylar da silmede temizlenir; saklama dışında süresiz kalmaz", { todo: "AÇIK (#372 §3): dispatch_error'lı olaylar cleanup'ta hiç silinmiyor, silme de dokunmuyor" }, async () => {
    const voter = await signUp();
    const id = randomUUID();
    await db.domainEvent.create({
      data: {
        id, type: "comment.created", version: 1, occurredAt: new Date(), actorId: voter.id, subjectType: "COMMENT", subjectId: randomUUID(),
        // CHECK domain_events_dispatch_error_check: hatalı olay da dispatch denemesi görmüş olmalı.
        payload: { pollId: randomUUID() }, dispatchedAt: new Date(), dispatchError: "test: parse_failed",
      },
    });
    assert.equal((await erase(voter)).statusCode, 200);
    const left = await db.domainEvent.findUnique({ where: { id } });
    assert.ok(left === null || left.actorId === null, "teslim edilemeyen olay silinen hesabın kimliğini taşıyor");
  });

  test("tek oy veren kişi: kalan anonim kayıt oy zamanıyla kişiye geri bağlanamaz (k-anonimlik)", { todo: "AÇIK (#372 §2): ms created_at + tam history her oyu tekil kayıt yapıyor" }, async () => {
    const author = await signUp();
    const voter = await signUp();
    const p = await poll(author.id);
    await vote(voter, p.id, p.options[0]!.id);
    // Saldırgan bilgisi: anket sahibi, kişinin oy verdiği anı biliyor.
    const known = (await db.vote.findFirstOrThrow({ where: { userId: voter.id, pollId: p.id } })).createdAt;
    assert.equal((await erase(voter)).statusCode, 200);
    const groups = await db.anonymousVoteGroup.findMany({ where: { pollId: p.id } });
    const linkable = groups.filter((g) => g.createdAt.getTime() === known.getTime() && g.multiplicity < 5);
    assert.equal(linkable.length, 0, "oy anı tam olarak saklanıyor ve grup 5'ten küçük: seçim kişiye bağlanabilir");
    assert.equal(JSON.stringify(groups.map((g) => g.history)).includes(known.toISOString()), false, "history oy anını taşıyor");
  });

  test("yarış: yasal saklama ile silme aynı anda — ya saklama silmeyi engeller ya silinmiş hesaba saklama reddedilir", async () => {
    const user = await signUp();
    const [hold, gone] = await Promise.all([
      send("PUT", `/admin/users/${user.id}/legal-hold`, { reason: "Devam eden hukuki süreç nedeniyle saklama" }, boss.cookie),
      erase(user),
    ]);
    const erased = (await db.user.findUniqueOrThrow({ where: { id: user.id } })).deletedAt !== null;
    const openHolds = await db.userLegalHold.count({ where: { userId: user.id, releasedAt: null } });
    assert.ok(
      (erased && openHolds === 0 && hold.statusCode === 409) || (!erased && openHolds === 1 && gone.statusCode === 409),
      `tutarsız: silindi=${erased}, açık saklama=${openHolds}, saklama=${hold.statusCode}, silme=${gone.statusCode}`,
    );
  });
});

/**
 * KV-21 PR-2 (#23) olay outbox'ı: writeEvent ve ilk üretici (admin-users: sanction.applied, sanction.lifted, role.changed).
 * Gerçek PostgreSQL gerektirir. Olay mutation ile aynı transaction'da yazılır: işlem commit olursa olay vardır, reddedilir
 * veya geri alınırsa yoktur. Dağıtım worker'dadır (apps/worker/test/events.test.ts); burada satırın contracts parseEvent'ten
 * geçtiği doğrulanır (iki tarafın ortak sözleşmesi tablo + parseEvent). Test DB'si sıfırlanmaz: sorgular testin yeni
 * kullanıcısına göre yapılır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createEvent, ErrorBody, newEventId, parseEvent, type DomainEvent } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { writeEvent } from "../src/modules/events/write.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string };
type Res = { statusCode: number; body: string; json(): any };

describe("olay outbox'ı: writeEvent ve admin-users olayları (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let root: User;
  let admin: User;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    root = await signUp();
    await db.userRole.create({ data: { userId: root.id, role: "SUPER_ADMIN" } });
    admin = await signUp();
    await db.userRole.create({ data: { userId: admin.id, role: "ADMIN", grantedById: root.id } });
  });
  after(async () => {
    await h?.close();
  });

  function send(method: "POST" | "PUT", url: string, body: unknown, cookie?: string, key?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: { origin: WEB_ORIGIN, "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(key ? { "idempotency-key": key } : {}) },
      payload: JSON.stringify(body),
    }) as unknown as Promise<Res>;
  }

  function assertError(res: Res, status: number, code: string, detail?: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
    if (detail) assert.equal(res.json().error.details[0]?.code, detail, res.body);
  }

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `ev_${id}@example.test`, username: `ev_${id}`, displayName: "Olay", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await h.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
      payload: JSON.stringify({ email: account.email, password: account.password }),
    });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id };
  }

  const apply = (userId: string, body: Record<string, unknown>, cookie = admin.cookie, key?: string) =>
    send("POST", `/admin/users/${userId}/sanctions`, { reason: "Tekrarlayan spam", ...body }, cookie, key);
  const lift = (userId: string, sanctionId: string, cookie = admin.cookie) =>
    send("POST", `/admin/users/${userId}/sanctions/${sanctionId}/lift`, { reason: "İtiraz kabul edildi" }, cookie);
  const role = (userId: string, r: string, cookie = root.cookie) => send("PUT", `/admin/users/${userId}/role`, { role: r, reason: "Ekip görevi değişti" }, cookie);

  /** Kullanıcı konulu olaylar, yazılış sırasıyla; her satır contracts parseEvent'ten geçer (worker dağıtıcısı da böyle okur). */
  async function events(userId: string) {
    const rows = await db.domainEvent.findMany({ where: { subjectType: "USER", subjectId: userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return rows.map((r) => {
      const event = parseEvent({
        version: r.version,
        id: r.id,
        type: r.type,
        occurredAt: r.occurredAt.toISOString(),
        actorId: r.actorId,
        subject: { type: r.subjectType, id: r.subjectId },
        payload: r.payload,
      });
      assert.equal(r.dispatchedAt, null, "API dağıtmaz");
      // UUIDv7'nin zaman bitleri olayın zamanıdır (producer newEventId(now)).
      assert.equal(parseInt(r.id.replaceAll("-", "").slice(0, 12), 16), r.occurredAt.getTime());
      return { ...event, naturalKey: r.naturalKey };
    });
  }

  test("sanction.applied: aktör yönetici, konu kullanıcı, payload {sanctionId, type, endsAt}; zaman yaptırımla aynı; doğal anahtar", async () => {
    const user = await signUp();
    const warning = await apply(user.id, { type: "WARNING" });
    assert.equal(warning.statusCode, 201, warning.body);
    const endsAt = new Date(h.clock.now.getTime() + 24 * 60 * 60_000).toISOString();
    const suspend = await apply(user.id, { type: "SUSPEND", endsAt });
    assert.equal(suspend.statusCode, 201, suspend.body);

    // Harness saati donuk: iki yaptırımın zamanı aynı olabilir, eşleme tipe göre.
    const sanctionOf = (type: "WARNING" | "SUSPEND") => db.sanction.findFirstOrThrow({ where: { userId: user.id, type }, select: { id: true, createdAt: true } });
    const w = await sanctionOf("WARNING");
    const s = await sanctionOf("SUSPEND");
    const list = await events(user.id);
    assert.deepEqual(
      list.map((e) => [e.type, e.actorId, e.subject, e.payload, e.naturalKey, e.occurredAt]),
      [
        ["sanction.applied", admin.id, { type: "USER", id: user.id }, { sanctionId: w.id, type: "WARNING", endsAt: null }, `sanction.applied:${w.id}`, w.createdAt.toISOString()],
        ["sanction.applied", admin.id, { type: "USER", id: user.id }, { sanctionId: s.id, type: "SUSPEND", endsAt }, `sanction.applied:${s.id}`, s.createdAt.toISOString()],
      ],
    );
  });

  test("sanction.lifted: kaldırma olayı; zaten kaldırılmış (409) ikinci olay üretmez", async () => {
    const user = await signUp();
    const sanctionId = (await apply(user.id, { type: "RESTRICT_COMMENTS", endsAt: null })).json().data.id;
    assert.equal((await lift(user.id, sanctionId)).statusCode, 200);
    assertError(await lift(user.id, sanctionId), 409, "CONFLICT", "already_lifted");
    const list = await events(user.id);
    assert.deepEqual(
      list.map((e) => [e.type, e.actorId, e.payload, e.naturalKey]),
      [
        ["sanction.applied", admin.id, { sanctionId, type: "RESTRICT_COMMENTS", endsAt: null }, `sanction.applied:${sanctionId}`],
        ["sanction.lifted", admin.id, { sanctionId, type: "RESTRICT_COMMENTS" }, `sanction.lifted:${sanctionId}`],
      ],
    );
  });

  test("role.changed: yalnız rol değiştiğinde; aynı rol olay üretmez; roller API gösterimiyle (tek elemanlı, USER dahil)", async () => {
    const user = await signUp();
    assert.equal((await role(user.id, "MODERATOR")).statusCode, 200);
    assert.equal((await role(user.id, "MODERATOR")).statusCode, 200);
    assert.equal((await role(user.id, "ADMIN")).statusCode, 200);
    assert.equal((await role(user.id, "USER")).statusCode, 200);
    const list = await events(user.id);
    assert.deepEqual(
      list.map((e) => [e.type, e.actorId, e.payload, e.naturalKey]),
      [
        ["role.changed", root.id, { previousRoles: ["USER"], roles: ["MODERATOR"] }, null],
        ["role.changed", root.id, { previousRoles: ["MODERATOR"], roles: ["ADMIN"] }, null],
        ["role.changed", root.id, { previousRoles: ["ADMIN"], roles: ["USER"] }, null],
      ],
    );
  });

  test("reddedilen işlem olay yazmaz: aynı tipte aktif yaptırım 409, yetkisiz 403, kendi rolü 409", async () => {
    const user = await signUp();
    assert.equal((await apply(user.id, { type: "RESTRICT_POSTING", endsAt: null })).statusCode, 201);
    assertError(await apply(user.id, { type: "RESTRICT_POSTING", endsAt: null }), 409, "CONFLICT", "already_active");
    assertError(await apply(root.id, { type: "WARNING" }), 403, "FORBIDDEN");
    assertError(await role(user.id, "MODERATOR", admin.cookie), 403, "FORBIDDEN");
    assertError(await role(root.id, "ADMIN"), 409, "CONFLICT");
    assert.equal((await events(user.id)).length, 1);
    assert.equal((await events(root.id)).length, 0);
  });

  test("Idempotency-Key tekrarı mutation'ı yeniden çalıştırmaz: tek olay", async () => {
    const user = await signUp();
    const key = `kv21-${randomUUID()}`;
    const first = await apply(user.id, { type: "WARNING" }, admin.cookie, key);
    const again = await apply(user.id, { type: "WARNING" }, admin.cookie, key);
    assert.equal(again.json().data.id, first.json().data.id);
    assert.equal((await events(user.id)).length, 1);
  });

  // ─── writeEvent ─────────────────────────────────────────────

  const sanctionEvent = (userId: string, sanctionId = randomUUID()): DomainEvent =>
    createEvent({
      id: newEventId(),
      type: "sanction.applied",
      occurredAt: new Date().toISOString(),
      actorId: admin.id,
      subject: { type: "USER", id: userId },
      payload: { sanctionId, type: "WARNING", endsAt: null },
    });

  test("writeEvent: transaction geri alınırsa olay yok", async () => {
    const userId = randomUUID();
    await assert.rejects(
      db.$transaction(async (tx) => {
        assert.deepEqual(await writeEvent(tx, sanctionEvent(userId)), { written: true });
        throw new Error("geri al");
      }),
      /geri al/,
    );
    assert.equal(await db.domainEvent.count({ where: { subjectId: userId } }), 0);
  });

  test("writeEvent: aynı doğal anahtar ikinci kez yazılmaz (written: false, tek satır); ayrı kimlikle de", async () => {
    const userId = randomUUID();
    const sanctionId = randomUUID();
    const first = sanctionEvent(userId, sanctionId);
    assert.deepEqual(await db.$transaction((tx) => writeEvent(tx, first)), { written: true });
    assert.deepEqual(await db.$transaction((tx) => writeEvent(tx, sanctionEvent(userId, sanctionId))), { written: false });
    assert.deepEqual(await db.$transaction((tx) => writeEvent(tx, first)), { written: false });
    const rows = await db.domainEvent.findMany({ where: { subjectId: userId }, select: { id: true } });
    assert.deepEqual(rows, [{ id: first.id }]);
  });

  test("writeEvent: elle kurulmuş geçersiz olay yazılmadan reddedilir (TypeError) ve transaction geri alınır", async () => {
    const userId = randomUUID();
    const bad = { ...sanctionEvent(userId), payload: { sanctionId: randomUUID(), type: "WARNING", endsAt: null, reason: "serbest metin" } } as unknown as DomainEvent;
    await assert.rejects(db.$transaction((tx) => writeEvent(tx, bad)), TypeError);
    const v4 = { ...sanctionEvent(userId), id: randomUUID() } as DomainEvent;
    await assert.rejects(db.$transaction((tx) => writeEvent(tx, v4)), /UUIDv7/);
    assert.equal(await db.domainEvent.count({ where: { subjectId: userId } }), 0);
  });
});

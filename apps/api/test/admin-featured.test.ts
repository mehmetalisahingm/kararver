import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { Announcement, FeaturedPlacement } from "@kararver/contracts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";
import { rbacSeeds } from "./support/rbac-probe.ts";

const backend = prismaBackend();

describe("KV-42 öne çıkarma ve duyurular (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let admin: { cookie: string; id: string };
  let pollId = "";
  let categoryId = "";

  function send(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, cookie?: string, key?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function signUp() {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `kv42_${id}@example.test`, username: `kv42_${id}`, displayName: "KV42", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  const at = (minutes: number) => new Date(h.clock.now.getTime() + minutes * 60_000).toISOString();

  before(async () => {
    h = await createHarness(backend!);
    categoryId = (await h.prisma!.category.create({
      data: { slug: `kv42-${randomUUID().slice(0, 8)}`, name: "KV-42 Test" },
    })).id;
    const root = await signUp();
    const seeds = rbacSeeds(h);
    await seeds.setRole(root.id, "SUPER_ADMIN", null);
    admin = await signUp();
    await seeds.setRole(admin.id, "ADMIN", root.id);

    const author = await signUp();
    const poll = await send(
      "POST",
      "/polls",
      {
        kind: "POLL",
        title: `KV-42 test anketi ${randomUUID()}`,
        categoryId,
        durationHours: 24,
        resultsVisibility: "ALWAYS",
        options: [{ label: "A" }, { label: "B" }],
      },
      author.cookie,
      `test-${randomUUID()}`,
    );
    assert.equal(poll.statusCode, 201, poll.body);
    pollId = poll.json().data.id;
  });

  after(async () => {
    await h?.close();
  });

  test("öne çıkarma: admin oluşturur, doğal tekrar tek kayıt üretir ve audit yazılır", async () => {
    const body = {
      pollId,
      surface: "HOME_SPOTLIGHT",
      scopeId: null,
      priority: 50,
      badge: "Editör seçimi",
      startsAt: at(-5),
      endsAt: at(120),
      reason: "Ana sayfa editör seçimi",
    };

    const first = await send("POST", "/admin/featured", body, admin.cookie);
    const second = await send("POST", "/admin/featured", body, admin.cookie);
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(second.statusCode, 201, second.body);
    const a = FeaturedPlacement.parse(first.json().data);
    const b = FeaturedPlacement.parse(second.json().data);
    assert.equal(a.id, b.id);
    assert.equal(await h.prisma!.featuredPlacement.count({ where: { pollId, surface: "HOME_SPOTLIGHT" } }), 1);
    assert.equal(await h.prisma!.auditLog.count({ where: { action: "featured.manage", targetId: a.id } }), 1);
    assert.equal(await h.prisma!.domainEvent.count({
      where: { naturalKey: `featured.applied:${a.id}`, type: "featured.applied" },
    }), 1);
    assert.equal(await h.prisma!.domainEvent.count({
      where: { type: "community.featured", subjectId: pollId },
    }), 0);

    const publicList = await send("GET", "/featured?surface=HOME_SPOTLIGHT");
    assert.equal(publicList.statusCode, 200, publicList.body);
    assert.equal(publicList.json().data.length, 1);
    assert.equal(publicList.json().data[0].placementId, a.id);
    assert.equal(publicList.json().data[0].poll.id, pollId);
    assert.equal(publicList.json().data[0].badge, "Editör seçimi");
  });

  test("öne çıkarma: scope ve zaman kuralları ile bulunmayan içerik reddedilir", async () => {
    const base = { pollId, priority: 0, badge: null, startsAt: at(10), endsAt: at(20), reason: "test gerekçesi" };

    const missingScope = await send("POST", "/admin/featured", { ...base, surface: "CATEGORY", scopeId: null }, admin.cookie);
    assert.equal(missingScope.statusCode, 400, missingScope.body);

    const badTime = await send("POST", "/admin/featured", { ...base, surface: "FEED_TOP", scopeId: null, startsAt: at(20), endsAt: at(10) }, admin.cookie);
    assert.equal(badTime.statusCode, 400, badTime.body);

    const missingPoll = await send("POST", "/admin/featured", { ...base, pollId: randomUUID(), surface: "FEED_TOP", scopeId: null }, admin.cookie);
    assert.equal(missingPoll.statusCode, 409, missingPoll.body);
  });

  test("toplulukta öne çıkarma owner bildirimi için tek outbox olayı üretir", async () => {
    const communityId = randomUUID();
    const body = {
      pollId,
      surface: "COMMUNITY",
      scopeId: communityId,
      priority: 30,
      badge: "Topluluk seçimi",
      startsAt: at(-1),
      endsAt: at(60),
      reason: "Toplulukta öne çıkarma",
    };
    const first = await send("POST", "/admin/featured", body, admin.cookie);
    const replay = await send("POST", "/admin/featured", body, admin.cookie);
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(replay.statusCode, 201, replay.body);
    const placement = FeaturedPlacement.parse(first.json().data);
    assert.equal(FeaturedPlacement.parse(replay.json().data).id, placement.id);

    const communityEvents = await h.prisma!.domainEvent.findMany({
      where: { naturalKey: `community.featured:${placement.id}` },
    });
    assert.equal(communityEvents.length, 1);
    assert.equal(communityEvents[0]!.type, "community.featured");
    assert.equal(communityEvents[0]!.subjectId, pollId);
    assert.equal((communityEvents[0]!.payload as Record<string, unknown>).communityId, communityId);
    assert.equal(await h.prisma!.domainEvent.count({
      where: { naturalKey: `featured.applied:${placement.id}` },
    }), 1);

    const update = await send("PATCH", `/admin/featured/${placement.id}`, {
      badge: "Yeni etiket",
      reason: "Etiket düzenleme",
    }, admin.cookie);
    assert.equal(update.statusCode, 200, update.body);
    assert.equal(await h.prisma!.domainEvent.count({
      where: { naturalKey: `community.featured:${placement.id}` },
    }), 1);
  });

  test("duyurular: hedef grup, zaman penceresi ve public aktif liste doğru", async () => {
    const create = async (title: string, audience: "ALL" | "AUTHENTICATED", startsAt: string, endsAt: string | null) => {
      const res = await send("POST", "/admin/announcements", {
        title,
        body: `${title} içeriği`,
        level: "INFO",
        audience,
        startsAt,
        endsAt,
        reason: "Planlı ürün duyurusu",
      }, admin.cookie, `ann-${randomUUID()}`);
      assert.equal(res.statusCode, 201, res.body);
      return Announcement.parse(res.json().data);
    };

    const publicActive = await create("Herkese açık", "ALL", at(-30), at(60));
    const memberActive = await create("Üyelere özel", "AUTHENTICATED", at(-20), at(60));
    await create("Henüz başlamadı", "ALL", at(60), at(120));
    await create("Süresi bitti", "ALL", at(-120), at(-1));

    const guest = await send("GET", "/announcements/active");
    assert.equal(guest.statusCode, 200, guest.body);
    const guestItems = (guest.json().data as unknown[]).map((x) => Announcement.parse(x));
    assert.deepEqual(guestItems.map((x) => x.id), [publicActive.id]);

    const signed = await signUp();
    const member = await send("GET", "/announcements/active", undefined, signed.cookie);
    assert.equal(member.statusCode, 200, member.body);
    const memberIds = (member.json().data as unknown[]).map((x) => Announcement.parse(x).id);
    assert.ok(memberIds.includes(publicActive.id));
    assert.ok(memberIds.includes(memberActive.id));
    assert.equal(memberIds.length, 2);
  });

  test("geleceğe planlanan topluluk yerleşimi erken bildirmez; tarih aktif edilince bir kez üretir", async () => {
    const response = await send("POST", "/admin/featured", {
      pollId, surface: "COMMUNITY", scopeId: randomUUID(), priority: 0, badge: "Planlı",
      startsAt: at(15), endsAt: at(90), reason: "Planlı topluluk yayın",
    }, admin.cookie);
    assert.equal(response.statusCode, 201, response.body);
    const id = FeaturedPlacement.parse(response.json().data).id;
    assert.equal(await h.prisma!.domainEvent.count({ where: { naturalKey: `community.featured:${id}` } }), 0);
    assert.equal(await h.prisma!.domainEvent.count({ where: { naturalKey: `featured.applied:${id}` } }), 0);

    const active = await send("PATCH", `/admin/featured/${id}`, {
      startsAt: at(-2), reason: "Tarihi öne al",
    }, admin.cookie);
    assert.equal(active.statusCode, 200, active.body);
    assert.equal(await h.prisma!.domainEvent.count({ where: { naturalKey: `community.featured:${id}` } }), 1);
    assert.equal(await h.prisma!.domainEvent.count({ where: { naturalKey: `featured.applied:${id}` } }), 1);

    const replay = await send("PATCH", `/admin/featured/${id}`, {
      badge: "Planlı, güncel", reason: "Etiket güncelle",
    }, admin.cookie);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(await h.prisma!.domainEvent.count({ where: { naturalKey: `community.featured:${id}` } }), 1);
  });

  test("duyuru aktivasyonu zamanı gelmeden olay üretmez; canlıya çekilince tek yayın olayı", async () => {
    const response = await send("POST", "/admin/announcements", {
      title: "İleri tarihli duyuru", body: "Üyelere bilgi",
      level: "WARNING", audience: "AUTHENTICATED", startsAt: at(25), endsAt: at(75),
      reason: "Planlı bildirim",
    }, admin.cookie);
    assert.equal(response.statusCode, 201, response.body);
    const id = Announcement.parse(response.json().data).id;
    assert.equal(await h.prisma!.domainEvent.count({ where: { naturalKey: `announcement.published:${id}` } }), 0);
    const activate = await send("PATCH", `/admin/announcements/${id}`, {
      startsAt: at(-1), reason: "Şimdi yayınla",
    }, admin.cookie);
    assert.equal(activate.statusCode, 200, activate.body);
    const events = await h.prisma!.domainEvent.findMany({ where: { naturalKey: `announcement.published:${id}` } });
    assert.equal(events.length, 1);
    assert.equal((events[0]!.payload as { audience: string }).audience, "AUTHENTICATED");
    const edit = await send("PATCH", `/admin/announcements/${id}`, {
      title: "Güncel duyuru", reason: "Yazım düzeltmesi",
    }, admin.cookie);
    assert.equal(edit.statusCode, 200, edit.body);
    assert.equal(await h.prisma!.domainEvent.count({ where: { naturalKey: `announcement.published:${id}` } }), 1);
  });

  test("duyuru/öne çıkarma endpointleri yetkisiz kullanıcıya kapalı", async () => {
    const user = await signUp();
    assert.equal((await send("GET", "/admin/featured", undefined, user.cookie)).statusCode, 403);
    assert.equal((await send("GET", "/admin/announcements", undefined, user.cookie)).statusCode, 403);
  });
});

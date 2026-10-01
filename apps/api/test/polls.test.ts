/**
 * KV-10 (#12) anket CRUD senaryoları. Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL; CI'da tanımlı):
 * içerik kilidi DB trigger'ı, idempotency unique index'i ve transaction davranışı bellek içinde taklit edilmez.
 * Cevap gövdeleri router tarafından sözleşme şemasıyla (PollDetail) doğrulanır; uymayan cevap 500 olur.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, PollDetail } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createPrismaPollStore } from "../src/modules/polls/prisma-store.ts";
import { mapDbError } from "../src/modules/polls/routes.ts";
import { PollReferenceError } from "../src/modules/polls/store.ts";
import { slugify } from "../src/modules/polls/slug.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const HOUR = 60 * 60 * 1000;
const backend = prismaBackend();

test("slug Türkçe karakterleri sadeleştirir ve kısaltır", () => {
  assert.equal(slugify("Bu araba bu fiyata alınır mı?"), "bu-araba-bu-fiyata-alinir-mi");
  assert.equal(slugify("İŞÇİ ĞÜÖ çöp"), "isci-guo-cop");
  assert.equal(slugify("???"), "karar");
  assert.ok(slugify("uzun ".repeat(40)).length <= 80);
});

test("DB trigger hatası sözleşme koduna eşlenir", () => {
  const err = new Error("ERROR: KV_POLL_CONTENT_LOCKED: ilk geçerli oydan sonra ...");
  assert.equal(mapDbError(err), "POLL_CONTENT_LOCKED");
  assert.equal(mapDbError(new Error("başka bir hata")), null);
});

describe("anketler (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let inactiveCategoryId: string;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    const suffix = randomUUID().slice(0, 8);
    categoryId = (await db.category.create({ data: { slug: `otomobil-${suffix}`, name: "Otomobil" } })).id;
    inactiveCategoryId = (await db.category.create({ data: { slug: `eski-${suffix}`, name: "Eski", isActive: false } })).id;
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function headersFor(cookie?: string, key?: string, json = true) {
    return {
      origin: WEB_ORIGIN,
      ...(json ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    };
  }

  function send(method: "POST" | "PATCH" | "DELETE", url: string, body: unknown, cookie?: string, key?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: headersFor(cookie, key, body !== undefined),
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function get(url: string, cookie?: string) {
    return h.app.inject({ method: "GET", url: `/v1${url}`, headers: cookie ? { cookie } : {} });
  }

  function assertError(res: { statusCode: number; json(): any }, status: number, code: string) {
    assert.equal(res.statusCode, status, JSON.stringify(res.json()));
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp(options: { verify?: boolean } = {}) {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `anket_${id}@example.test`, username: `anket_${id}`, displayName: "Anketçi", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    if (options.verify !== false) {
      assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    }
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  const key = () => `test-${randomUUID()}`;
  let titleSeq = 0;

  function pollBody(overrides: Record<string, unknown> = {}) {
    return {
      kind: "POLL",
      // Aynı başlık kuralı (KV-20): her çağrı benzersiz başlık üretir.
      title: `Bu araba bu fiyata alınır mı? ${++titleSeq}`,
      description: "2019 model, 85 bin km. Sağ çamurluk boyalı.",
      categoryId,
      durationHours: 72,
      resultsVisibility: "AFTER_VOTE",
      options: [{ label: "Alınır" }, { label: "Alınmaz" }],
      ...overrides,
    };
  }

  async function createPoll(cookie: string, overrides: Record<string, unknown> = {}) {
    const res = await send("POST", "/polls", pollBody(overrides), cookie, key());
    assert.equal(res.statusCode, 201, res.body);
    return PollDetail.parse(res.json().data);
  }

  /** KV-11 gelene kadar oy doğrudan DB'ye yazılır; sayaçlar aynı transaction'da (DATA_MODEL §5.3). */
  async function castVote(pollId: string, optionId: string, userId: string) {
    await db.$transaction([
      db.vote.create({ data: { pollId, optionId, userId } }),
      db.pollOption.update({ where: { id: optionId }, data: { voteCount: { increment: 1 } } }),
      db.poll.update({ where: { id: pollId }, data: { voteCount: { increment: 1 } } }),
    ]);
  }

  // ─── Oluşturma ──────────────────────────────────────────────

  test("anket oluşturma 201; sahip sonucu görür ama oy veremez", async () => {
    const owner = await signUp();
    const res = await send("POST", "/polls", pollBody({ title: "Bu araba bu fiyata alınır mı?", tagSlugs: ["ikinci-el"], price: { amount: "1250000.00", currency: "TRY" } }), owner.cookie, key());
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(res.headers["cache-control"], "private, no-store");
    const poll = PollDetail.parse(res.json().data);
    assert.equal(poll.kind, "POLL");
    assert.equal(poll.slug, "bu-araba-bu-fiyata-alinir-mi");
    assert.equal(poll.canonicalPath, `/karar/${poll.slug}-${poll.publicId}`);
    assert.deepEqual(poll.options.map((o) => [o.label, o.position]), [["Alınır", 0], ["Alınmaz", 1]]);
    assert.deepEqual(poll.tags, ["ikinci-el"]);
    assert.deepEqual(poll.price, { amount: "1250000.00", currency: "TRY" });
    assert.equal(poll.contentLocked, false);
    assert.equal(new Date(poll.closesAt!).getTime() - new Date(poll.opensAt).getTime(), 72 * HOUR);
    // AFTER_VOTE olsa da sahip sonucu görür (1.2.0 kararı); oy veremez.
    assert.deepEqual(poll.results, { visible: true, total: 0, options: poll.options.map((o) => ({ id: o.id, votes: 0, percent: 0 })) });
    assert.equal(poll.viewer?.isAuthor, true);
    assert.equal(poll.viewer?.canVote, false);
    assert.equal(poll.viewer?.voteBlockedReason, "OWN_POLL");
  });

  test("Idempotency-Key zorunlu; biçimi doğrulanır", async () => {
    const owner = await signUp();
    assertError(await send("POST", "/polls", pollBody(), owner.cookie), 400, "IDEMPOTENCY_KEY_REQUIRED");
    assertError(await send("POST", "/polls", pollBody(), owner.cookie, "kisa"), 400, "VALIDATION_ERROR");
  });

  test("aynı anahtar + aynı gövde aynı anketi döner; farklı gövde 409", async () => {
    const owner = await signUp();
    const k = key();
    const body = pollBody();
    const first = await send("POST", "/polls", body, owner.cookie, k);
    const again = await send("POST", "/polls", body, owner.cookie, k);
    assert.equal(first.statusCode, 201);
    assert.equal(again.statusCode, 201);
    assert.equal(again.json().data.id, first.json().data.id);
    assertError(await send("POST", "/polls", pollBody({ title: "Başka bir soru soruyorum burada" }), owner.cookie, k), 409, "IDEMPOTENCY_KEY_REUSED");
    assert.equal(await db.poll.count({ where: { authorId: owner.id } }), 1);
  });

  test("aynı anahtarla 5 eşzamanlı istek tek anket üretir", async () => {
    const owner = await signUp();
    const k = key();
    const body = pollBody();
    const results = await Promise.all(Array.from({ length: 5 }, () => send("POST", "/polls", body, owner.cookie, k)));
    assert.deepEqual(results.map((r) => r.statusCode), [201, 201, 201, 201, 201], results.map((r) => r.body).join("\n"));
    assert.equal(new Set(results.map((r) => r.json().data.id)).size, 1);
    assert.equal(await db.poll.count({ where: { authorId: owner.id } }), 1);
  });

  test("farklı kullanıcı aynı anahtarı kullanabilir (kapsam kullanıcı başına)", async () => {
    const a = await signUp();
    const b = await signUp();
    const k = key();
    const body = pollBody();
    const first = await send("POST", "/polls", body, a.cookie, k);
    const second = await send("POST", "/polls", body, b.cookie, k);
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);
    assert.notEqual(first.json().data.id, second.json().data.id);
  });

  test("misafir 401, e-postası doğrulanmamış hesap 403", async () => {
    assertError(await send("POST", "/polls", pollBody(), undefined, key()), 401, "UNAUTHENTICATED");
    const unverified = await signUp({ verify: false });
    assertError(await send("POST", "/polls", pollBody(), unverified.cookie, key()), 403, "EMAIL_NOT_VERIFIED");
  });

  test("süre sistem ayarının sınırları içinde olmalı", async () => {
    const owner = await signUp();
    h.pollSettings.maxDurationHours = 48;
    try {
      const res = await send("POST", "/polls", pollBody({ durationHours: 72 }), owner.cookie, key());
      assertError(res, 400, "VALIDATION_ERROR");
      assert.equal(res.json().error.details[0].field, "durationHours");
      assert.equal((await send("POST", "/polls", pollBody({ durationHours: 48 }), owner.cookie, key())).statusCode, 201);
    } finally {
      h.pollSettings.maxDurationHours = 720;
    }
    assert.equal((await send("POST", "/polls", pollBody({ durationHours: 1 }), owner.cookie, key())).statusCode, 201);
    assert.equal((await send("POST", "/polls", pollBody({ durationHours: 720 }), owner.cookie, key())).statusCode, 201);
    assertError(await send("POST", "/polls", pollBody({ durationHours: 721 }), owner.cookie, key()), 400, "VALIDATION_ERROR");
  });

  test("şema kuralları: 2–6 seçenek, farklı etiketler, bilinmeyen alan yok", async () => {
    const owner = await signUp();
    for (const body of [
      pollBody({ options: [{ label: "Tek" }] }),
      pollBody({ options: Array.from({ length: 7 }, (_, i) => ({ label: `S${i}` })) }),
      pollBody({ options: [{ label: "Evet" }, { label: "EVET" }] }),
      pollBody({ authorId: owner.id }),
      pollBody({ title: "kısa" }),
    ]) {
      assertError(await send("POST", "/polls", body, owner.cookie, key()), 400, "VALIDATION_ERROR");
    }
  });

  test("pasif kategori 400; tartışma gönderisi açılır (#66, ayrıntısı discussions.test.ts)", async () => {
    const owner = await signUp();
    const inactive = await send("POST", "/polls", pollBody({ categoryId: inactiveCategoryId }), owner.cookie, key());
    assertError(inactive, 400, "VALIDATION_ERROR");
    assert.equal(inactive.json().error.details[0].field, "categoryId");
    const discussion = await send("POST", "/polls", { kind: "DISCUSSION", title: "Bu bütçeyle hangi arabayı almalıyım?", categoryId }, owner.cookie, key());
    assert.equal(discussion.statusCode, 201, discussion.body);
    assert.equal(discussion.json().data.kind, "DISCUSSION");
  });

  test("görseller: sadece kendi POLL görselin; APPROVED olan görünür, bekleyen görünmez", async () => {
    const owner = await signUp();
    const other = await signUp();
    const approved = await h.addMedia(owner.id, { purpose: "POLL", status: "APPROVED" });
    const pending = await h.addMedia(owner.id, { purpose: "POLL", status: "PENDING" });
    const rejected = await h.addMedia(owner.id, { purpose: "POLL", status: "REJECTED" });
    const avatar = await h.addMedia(owner.id, { purpose: "AVATAR", status: "APPROVED" });
    const foreign = await h.addMedia(other.id, { purpose: "POLL", status: "APPROVED" });

    for (const mediaIds of [[rejected.id], [avatar.id], [foreign.id]]) {
      assertError(await send("POST", "/polls", pollBody({ mediaIds }), owner.cookie, key()), 409, "MEDIA_NOT_USABLE");
    }
    const poll = await createPoll(owner.cookie, { mediaIds: [pending.id, approved.id] });
    assert.deepEqual(poll.media.map((m) => m.id), [approved.id]);
    assert.equal(poll.coverImage?.url, `http://cdn.test/media/${approved.publicKey}`);
  });

  test("topluluk: üye olmayan 403, bilinmeyen topluluk 400, üye paylaşabilir", async () => {
    const owner = await signUp();
    const slug = `topluluk-${randomUUID().slice(0, 8)}`;
    const community = await db.community.create({ data: { slug, name: "Test Topluluğu", createdById: owner.id }, select: { id: true } });
    assertError(await send("POST", "/polls", pollBody({ communityId: community.id }), owner.cookie, key()), 403, "FORBIDDEN");
    assertError(await send("POST", "/polls", pollBody({ communityId: randomUUID() }), owner.cookie, key()), 400, "VALIDATION_ERROR");
    await db.communityMembership.create({ data: { communityId: community.id, userId: owner.id } });
    const poll = await createPoll(owner.cookie, { communityId: community.id });
    assert.deepEqual(poll.community, { id: community.id, slug, name: "Test Topluluğu" });
  });

  // ─── Okuma ve gizli sonuç ───────────────────────────────────

  test("misafir AFTER_VOTE sonucunu görmez; ALWAYS'ı görür; viewer null", async () => {
    const owner = await signUp();
    const hidden = await createPoll(owner.cookie);
    const open = await createPoll(owner.cookie, { resultsVisibility: "ALWAYS" });
    const guestHidden = PollDetail.parse((await get(`/polls/${hidden.id}`)).json().data);
    assert.deepEqual(guestHidden.results, { visible: false });
    assert.equal(guestHidden.viewer, null);
    const guestOpen = PollDetail.parse((await get(`/polls/${open.id}`)).json().data);
    assert.equal(guestOpen.results?.visible, true);
  });

  test("oy veren izleyici sonucu görür; oy vermemiş doğrulanmış izleyici oy verebilir", async () => {
    const owner = await signUp();
    const voter = await signUp();
    const watcher = await signUp();
    const unverified = await signUp({ verify: false });
    const poll = await createPoll(owner.cookie);
    await castVote(poll.id, poll.options[0]!.id, voter.id);

    const asVoter = PollDetail.parse((await get(`/polls/${poll.id}`, voter.cookie)).json().data);
    assert.deepEqual(asVoter.results, {
      visible: true,
      total: 1,
      options: [
        { id: poll.options[0]!.id, votes: 1, percent: 100 },
        { id: poll.options[1]!.id, votes: 0, percent: 0 },
      ],
    });
    assert.equal(asVoter.viewer?.vote, poll.options[0]!.id);
    assert.equal(asVoter.viewer?.canVote, true, "oy değiştirme açık");

    const asWatcher = PollDetail.parse((await get(`/polls/${poll.id}`, watcher.cookie)).json().data);
    assert.deepEqual(asWatcher.results, { visible: false });
    assert.equal(asWatcher.viewer?.canVote, true);

    const asUnverified = PollDetail.parse((await get(`/polls/${poll.id}`, unverified.cookie)).json().data);
    assert.equal(asUnverified.viewer?.voteBlockedReason, "EMAIL_NOT_VERIFIED");

    h.pollSettings.voteChangeAllowed = false;
    try {
      const locked = PollDetail.parse((await get(`/polls/${poll.id}`, voter.cookie)).json().data);
      assert.equal(locked.viewer?.voteBlockedReason, "VOTE_CHANGE_DISABLED");
    } finally {
      h.pollSettings.voteChangeAllowed = true;
    }
  });

  test("publicId ile lookup; bilinmeyen id ve publicId 404", async () => {
    const owner = await signUp();
    const poll = await createPoll(owner.cookie);
    const found = await get(`/polls/lookup?publicId=${poll.publicId}`);
    assert.equal(found.statusCode, 200);
    assert.equal(found.json().data.id, poll.id);
    assertError(await get(`/polls/lookup?publicId=yokboyle1`), 404, "NOT_FOUND");
    assertError(await get(`/polls/${randomUUID()}`), 404, "NOT_FOUND");
    assertError(await get(`/polls/uuid-degil`), 400, "VALIDATION_ERROR");
  });

  // ─── Düzenleme ve ilk oy kilidi ─────────────────────────────

  test("başkası düzenleyemez (403); sahip oy yokken her alanı düzenler", async () => {
    const owner = await signUp();
    const other = await signUp();
    const poll = await createPoll(owner.cookie);
    assertError(await send("PATCH", `/polls/${poll.id}`, { extraInfo: "x" }, other.cookie), 403, "FORBIDDEN");

    const res = await send(
      "PATCH",
      `/polls/${poll.id}`,
      {
        title: "Bu SUV bu fiyata alınır mı acaba?",
        description: "Güncel açıklama",
        resultsVisibility: "ALWAYS",
        options: [{ id: poll.options[1]!.id, label: "Alınmaz" }, { label: "Pazarlık yap" }, { id: poll.options[0]!.id, label: "Alınır" }],
        tagSlugs: ["suv"],
        price: null,
      },
      owner.cookie,
    );
    assert.equal(res.statusCode, 200, res.body);
    const updated = PollDetail.parse(res.json().data);
    assert.equal(updated.slug, "bu-suv-bu-fiyata-alinir-mi-acaba");
    assert.equal(updated.publicId, poll.publicId, "publicId değişmez");
    assert.deepEqual(updated.options.map((o) => [o.label, o.position]), [["Alınmaz", 0], ["Pazarlık yap", 1], ["Alınır", 2]]);
    assert.equal(updated.options[0]!.id, poll.options[1]!.id, "id'li seçenek korunur");
    assert.deepEqual(updated.tags, ["suv"]);
    assert.equal(updated.price, null);
  });

  test("başka anketin seçenek id'si ve tekrarlanan etiket reddedilir", async () => {
    const owner = await signUp();
    const a = await createPoll(owner.cookie);
    const b = await createPoll(owner.cookie);
    assertError(await send("PATCH", `/polls/${a.id}`, { options: [{ id: b.options[0]!.id, label: "X" }, { label: "Y" }] }, owner.cookie), 400, "VALIDATION_ERROR");
    assertError(await send("PATCH", `/polls/${a.id}`, { options: [{ label: "Aynı" }, { label: "aynı" }] }, owner.cookie), 400, "VALIDATION_ERROR");
  });

  test("ilk geçerli oydan sonra soru, açıklama, seçenekler ve sonuç görünürlüğü kilitli", async () => {
    const owner = await signUp();
    const voter = await signUp();
    const poll = await createPoll(owner.cookie);
    await castVote(poll.id, poll.options[0]!.id, voter.id);

    for (const patch of [
      { title: "Değiştirilmiş başlık metni burada" },
      { description: "yeni" },
      { description: null },
      { resultsVisibility: "ALWAYS" },
      { options: [{ id: poll.options[0]!.id, label: "Alınır" }, { label: "Belki" }] },
    ]) {
      const res = await send("PATCH", `/polls/${poll.id}`, patch, owner.cookie);
      assertError(res, 409, "POLL_CONTENT_LOCKED");
    }
    const ok = await send("PATCH", `/polls/${poll.id}`, { extraInfo: "Ekspertiz raporu var.", allowComments: false }, owner.cookie);
    assert.equal(ok.statusCode, 200, ok.body);
    const after = PollDetail.parse(ok.json().data);
    assert.equal(after.contentLocked, true);
    assert.equal(after.extraInfo, "Ekspertiz raporu var.");
    assert.equal(after.allowComments, false);
    assert.equal(after.title, poll.title);
  });

  test("ön kontrol atlanırsa DB trigger'ı yine reddeder (yarış durumu)", async () => {
    const owner = await signUp();
    const voter = await signUp();
    const poll = await createPoll(owner.cookie);
    await castVote(poll.id, poll.options[0]!.id, voter.id);
    await assert.rejects(db.poll.update({ where: { id: poll.id }, data: { title: "Doğrudan DB güncellemesi" } }), (err) => mapDbError(err) === "POLL_CONTENT_LOCKED");
  });

  test("moderasyon kilidi (LOCKED) düzenlemeyi 409 CONTENT_LOCKED ile engeller", async () => {
    const owner = await signUp();
    const poll = await createPoll(owner.cookie);
    await db.poll.update({ where: { id: poll.id }, data: { status: "LOCKED" } });
    assertError(await send("PATCH", `/polls/${poll.id}`, { extraInfo: "x" }, owner.cookie), 409, "CONTENT_LOCKED");
    assert.equal((await get(`/polls/${poll.id}`)).json().data.status, "LOCKED");
  });

  // ─── Kapanış, silme, ek açıklama ────────────────────────────

  test("erken kapanış: sonuç herkese açılır, oy durumu POLL_CLOSED; tekrar kapatmak 200", async () => {
    const owner = await signUp();
    const watcher = await signUp();
    const poll = await createPoll(owner.cookie);
    h.clock.advance(HOUR);
    const closed = await send("POST", `/polls/${poll.id}/close`, undefined, owner.cookie);
    assert.equal(closed.statusCode, 200, closed.body);
    const detail = PollDetail.parse(closed.json().data);
    assert.equal(detail.closed, true);
    assert.equal(detail.closedAt, h.clock.now.toISOString());

    const again = await send("POST", `/polls/${poll.id}/close`, undefined, owner.cookie);
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().data.closedAt, detail.closedAt, "ilk kapanış zamanı korunur");

    assert.equal(PollDetail.parse((await get(`/polls/${poll.id}`)).json().data).results?.visible, true, "kapanınca misafir de görür");
    const asWatcher = PollDetail.parse((await get(`/polls/${poll.id}`, watcher.cookie)).json().data);
    assert.equal(asWatcher.viewer?.voteBlockedReason, "POLL_CLOSED");
    assertError(await send("POST", `/polls/${poll.id}/close`, undefined, watcher.cookie), 403, "FORBIDDEN");
  });

  test("süresi dolan anket kapalı sayılır", async () => {
    const owner = await signUp();
    const poll = await createPoll(owner.cookie, { durationHours: 1 });
    h.clock.advance(2 * HOUR);
    const detail = PollDetail.parse((await get(`/polls/${poll.id}`)).json().data);
    assert.equal(detail.closed, true);
    assert.equal(detail.closedAt, null, "erken kapanış yok");
  });

  test("silme: soft delete, sonra 404; tekrar silmek 204; başkası silemez", async () => {
    const owner = await signUp();
    const other = await signUp();
    const poll = await createPoll(owner.cookie);
    assertError(await send("DELETE", `/polls/${poll.id}`, undefined, other.cookie), 403, "FORBIDDEN");
    assert.equal((await send("DELETE", `/polls/${poll.id}`, undefined, owner.cookie)).statusCode, 204);
    assertError(await get(`/polls/${poll.id}`), 404, "NOT_FOUND");
    assert.equal((await send("DELETE", `/polls/${poll.id}`, undefined, owner.cookie)).statusCode, 204);
    const row = await db.poll.findUniqueOrThrow({ where: { id: poll.id }, select: { status: true, deletedAt: true } });
    assert.equal(row.status, "REMOVED");
    assert.ok(row.deletedAt);
  });

  test("ek açıklama: kilitli ankette de eklenir; Idempotency-Key tekrarını tek kayıt yapar", async () => {
    const owner = await signUp();
    const voter = await signUp();
    const poll = await createPoll(owner.cookie);
    await castVote(poll.id, poll.options[0]!.id, voter.id);
    const k = key();
    const first = await send("POST", `/polls/${poll.id}/addenda`, { body: "Satıcı 1.200.000'e indi." }, owner.cookie, k);
    const again = await send("POST", `/polls/${poll.id}/addenda`, { body: "Satıcı 1.200.000'e indi." }, owner.cookie, k);
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(again.json().data.id, first.json().data.id);
    const detail = PollDetail.parse((await get(`/polls/${poll.id}`)).json().data);
    assert.deepEqual(detail.addenda.map((a) => a.body), ["Satıcı 1.200.000'e indi."]);
    assertError(await send("POST", `/polls/${poll.id}/addenda`, { body: "x" }, voter.cookie), 403, "FORBIDDEN");
  });

  // ─── Codex review düzeltmeleri (#80) ───────────────────────

  test("başarılı isteğin tekrarı, arada kategori pasife alınsa ve süre ayarı düşse de aynı anketi döner", async () => {
    const owner = await signUp();
    const slug = `gecici-${randomUUID().slice(0, 8)}`;
    const category = await db.category.create({ data: { slug, name: "Geçici" }, select: { id: true } });
    const k = key();
    const body = pollBody({ categoryId: category.id, durationHours: 72 });
    const first = await send("POST", "/polls", body, owner.cookie, k);
    assert.equal(first.statusCode, 201, first.body);

    await db.category.update({ where: { id: category.id }, data: { isActive: false } });
    h.pollSettings.maxDurationHours = 24;
    try {
      const retry = await send("POST", "/polls", body, owner.cookie, k);
      assert.equal(retry.statusCode, 201, retry.body);
      assert.equal(retry.json().data.id, first.json().data.id);
      // Yeni anahtarla aynı istek artık doğrulamaya takılır.
      assertError(await send("POST", "/polls", body, owner.cookie, key()), 400, "VALIDATION_ERROR");
    } finally {
      h.pollSettings.maxDurationHours = 720;
    }
  });

  test("ek açıklama tekrarı, anket sonradan kilitlense de aynı kaydı döner", async () => {
    const owner = await signUp();
    const poll = await createPoll(owner.cookie);
    const k = key();
    const first = await send("POST", `/polls/${poll.id}/addenda`, { body: "Ek bilgi" }, owner.cookie, k);
    assert.equal(first.statusCode, 201, first.body);
    await db.poll.update({ where: { id: poll.id }, data: { status: "LOCKED" } });
    const retry = await send("POST", `/polls/${poll.id}/addenda`, { body: "Ek bilgi" }, owner.cookie, k);
    assert.equal(retry.statusCode, 201, retry.body);
    assert.equal(retry.json().data.id, first.json().data.id);
    assertError(await send("POST", `/polls/${poll.id}/addenda`, { body: "Ek bilgi" }, owner.cookie, key()), 403, "FORBIDDEN");
  });

  test("referanslar oluşturma transaction'ında kilitlenip yeniden kontrol edilir", async () => {
    const owner = await signUp();
    const store = createPrismaPollStore(db);
    const media = await h.addMedia(owner.id, { purpose: "POLL", status: "APPROVED" });
    const newPoll = (mediaIds: string[]) => ({
      kind: "POLL" as const,
      authorId: owner.id,
      publicId: randomUUID().replaceAll("-", "").slice(0, 8),
      slug: "yaris-testi",
      title: "Yarış durumunda görsel reddedilirse ne olur?",
      description: null,
      categoryId,
      communityId: null,
      tagSlugs: [],
      mediaIds,
      priceAmount: null,
      priceCurrency: null,
      extraInfo: null,
      allowComments: true,
      resultsVisibility: "ALWAYS" as const,
      opensAt: new Date(),
      closesAt: new Date(Date.now() + HOUR),
      options: ["A", "B"],
    });
    const scope = () => ({ userId: owner.id, route: "polls.create", key: key(), requestHash: "0".repeat(64), now: new Date() });

    // Ön kontrolden sonra görseli reddeden eşzamanlı işlem: satır kilidini tutarken oluşturma başlar,
    // oluşturma kilidi bekler, commit'ten sonra güncel durumu görür ve reddeder.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const moderator = db.$transaction(async (tx) => {
      await tx.mediaAsset.update({ where: { id: media.id }, data: { status: "REJECTED", publicObjectKey: null } });
      locked();
      await gate;
    });
    await lockTaken;
    // Limitler bu testin konusu değil: izin verici değerler.
    const noLimits = { ...h.pollSettings, cooldownMinutes: 0, newAccountCooldownMinutes: 0, dailyLimit: 1000, newAccountDailyLimit: 100 };
    const creation = store.createPoll(newPoll([media.id]), scope(), noLimits);
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await moderator;
    await assert.rejects(creation, (err) => err instanceof PollReferenceError && err.field === "mediaIds");
    assert.equal(await db.poll.count({ where: { authorId: owner.id } }), 0, "anket yazılmadı");

    // Topluluktan ayrılan kullanıcı (ön kontrolden sonra) da transaction'da yakalanır.
    const community = await db.community.create({ data: { slug: `yaris-${randomUUID().slice(0, 8)}`, name: "Yarış", createdById: owner.id } });
    await assert.rejects(
      store.createPoll({ ...newPoll([]), communityId: community.id }, scope(), noLimits),
      (err) => err instanceof PollReferenceError && err.reason === "not_member",
    );
  });

  test("askıya alınmış veya banlı oturum oy verebilir görünmez", async () => {
    const owner = await signUp();
    const viewer = await signUp();
    const poll = await createPoll(owner.cookie);
    for (const status of ["SUSPENDED", "BANNED"] as const) {
      await h.setStatus(viewer.id, status);
      const res = await get(`/polls/${poll.id}`, viewer.cookie);
      assert.equal(res.statusCode, 200);
      const detail = PollDetail.parse(res.json().data);
      assert.equal(detail.viewer?.canVote, false, status);
      assert.equal(detail.viewer?.voteBlockedReason, "ACCOUNT_RESTRICTED", status);
    }
    await h.setStatus(viewer.id, "ACTIVE");
    assert.equal(PollDetail.parse((await get(`/polls/${poll.id}`, viewer.cookie)).json().data).viewer?.canVote, true);
  });

  test("anket rotaları sadece yetkili kaynaktan gelen mutation'ı kabul eder (CSRF)", async () => {
    const owner = await signUp();
    const res = await h.app.inject({
      method: "POST",
      url: "/v1/polls",
      headers: { origin: "https://kotu.example", "content-type": "application/json", cookie: owner.cookie, "idempotency-key": key() },
      payload: JSON.stringify(pollBody()),
    });
    assertError(res, 403, "FORBIDDEN");
    assert.equal(await db.poll.count({ where: { authorId: owner.id } }), 0);
  });
});

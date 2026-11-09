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
import { detectSensitiveSurvey } from "../src/modules/polls/sensitive-policy.ts";
import { PollReferenceError } from "../src/modules/polls/store.ts";
import { slugify } from "../src/modules/polls/slug.ts";
import { findExpired } from "../../worker/src/jobs/polls/expire.ts";
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

  function send(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body: unknown, cookie?: string, key?: string) {
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

  // ─── Misafir okuma, sonuç mahremiyeti ve katılım yetkisi ───

  test("misafir halka açık anketi ve izinli sonuçları okuyabilir; oy/yorum/anket yazamaz", async () => {
    const owner = await signUp();
    const voter = await signUp();
    const poll = await createPoll(owner.cookie, { resultsVisibility: "ALWAYS" });
    await castVote(poll.id, poll.options[0]!.id, voter.id);

    const detail = await get(`/polls/${poll.id}`);
    assert.equal(detail.statusCode, 200, detail.body);
    const wire = PollDetail.parse(detail.json().data);
    assert.equal(wire.viewer, null, "misafire kişiye özel oy/tercih verilmez");
    assert.equal(wire.results?.visible, true);
    assert.equal(wire.results?.visible && wire.results.total, 1);
    assert.equal(wire.canonicalPath, `/karar/${wire.slug}-${wire.publicId}`);

    const lookup = await get(`/polls/lookup?publicId=${wire.publicId}`);
    assert.equal(lookup.statusCode, 200, lookup.body);
    assert.equal(lookup.json().data.id, poll.id);

    const comments = await get(`/polls/${poll.id}/comments`);
    assert.equal(comments.statusCode, 200, comments.body);
    assert.ok(Array.isArray(comments.json().data));

    assertError(await send("PUT", `/polls/${poll.id}/vote`, { optionId: poll.options[0]!.id }), 401, "UNAUTHENTICATED");
    assertError(await send("POST", `/polls/${poll.id}/comments`, { body: "Misafir yorumu" }), 401, "UNAUTHENTICATED");
    assertError(await send("POST", "/polls", pollBody(), undefined, key()), 401, "UNAUTHENTICATED");
    assert.equal(await db.vote.count({ where: { pollId: poll.id, userId: owner.id } }), 0);
    assert.equal(await db.comment.count({ where: { pollId: poll.id } }), 0);
  });

  test("AFTER_VOTE kuralı, işletmeci ayrıca değiştirmeden misafire oy toplamlarını açmaz", async () => {
    const owner = await signUp();
    const poll = await createPoll(owner.cookie, { resultsVisibility: "AFTER_VOTE" });
    const detail = await get(`/polls/${poll.id}`);
    assert.equal(detail.statusCode, 200, detail.body);
    assert.deepEqual(PollDetail.parse(detail.json().data).results, { visible: false });
    assert.doesNotMatch(JSON.stringify(detail.json()), /"total":|\\"votes\\":/);
  });

  // ─── V1 hassas kişisel veri toplama yasağı (#285 / #290) ───

  test("API V1 kişisel siyasi/dini/sağlık anketini puan kesmeden ve satır yazmadan reddeder", async () => {
    const owner = await signUp();
    const before = await db.poll.count({ where: { authorId: owner.id } });
    const beforeCharges = await db.pointLedgerEntry.count({ where: { userId: owner.id, reason: "PUBLISH" } });
    const cases: Record<string, unknown>[] = [
      { title: "Hangi partiye oy verdin?" },
      { title: "Dinin nedir, hangi dine inanıyorsun?" },
      { title: "Sağlık durumun nasıl?" },
      { title: "Sen hangi gruptasın?", options: [{ label: "Müslüman" }, { label: "Ateist" }] },
      { description: "Hangi hastalığın var?" },
      { extraInfo: "Siyasi görüşün nedir?" },
    ];
    for (const changed of cases) {
      const response = await send("POST", "/polls", pollBody(changed), owner.cookie, key());
      assertError(response, 400, "VALIDATION_ERROR");
      assert.equal(response.json().error.details[0]?.code, "sensitive_survey_not_allowed_v1");
      assert.equal(JSON.stringify(response.json()).includes("partiye oy verdin"), false);
      assert.equal(await db.poll.count({ where: { authorId: owner.id } }), before,
        "reddedilen içerik hiçbir anket veya seçeneğe dönüşmemeli");
      assert.equal(await db.pointLedgerEntry.count({ where: { userId: owner.id, reason: "PUBLISH" } }), beforeCharges,
        "yasaklanan yayın puan düşürmemeli");
    }
  });

  test("anket güncelleme, tartışma oluşturma ve ek açıklama hassas veri toplama arka kapısı olamaz", async () => {
    const owner = await signUp();
    const poll = await createPoll(owner.cookie);
    const before = await db.poll.findUniqueOrThrow({ where: { id: poll.id }, select: { description: true, title: true } });
    const update = await send("PATCH", `/polls/${poll.id}`, { description: "Sağlık durumun nasıl?" }, owner.cookie);
    assertError(update, 400, "VALIDATION_ERROR");
    assert.deepEqual(await db.poll.findUniqueOrThrow({ where: { id: poll.id }, select: { description: true, title: true } }), before);

    const discussion = await send("POST", "/polls", {
      kind: "DISCUSSION", title: "Hangi dine mensupsun?", categoryId,
    }, owner.cookie, key());
    assertError(discussion, 400, "VALIDATION_ERROR");

    const addendum = await send("POST", `/polls/${poll.id}/addenda`, { body: "Dinin nedir?" }, owner.cookie);
    assertError(addendum, 400, "VALIDATION_ERROR");
    assert.equal(await db.pollAddendum.count({ where: { pollId: poll.id } }), 0);
  });

  test("V1 hassas veri kuralı PATCH ile parça parça aşılamaz (seçenek sonra başlık ve tersi)", async () => {
    const owner = await signUp();
    const first = await createPoll(owner.cookie, {
      title: "Hangisisin? Sana yakın olan grubu seç",
      description: "",
      options: [{ label: "Birinci seçenek" }, { label: "İkinci seçenek" }],
    });
    const existing = await db.pollOption.findMany({ where: { pollId: first.id }, orderBy: { position: "asc" }, select: { label: true } });
    const updateOptions = await send("PATCH", `/polls/${first.id}`, {
      options: [{ id: first.options[0]!.id, label: "Alevi" }, { id: first.options[1]!.id, label: "Sünni" }],
    }, owner.cookie);
    assertError(updateOptions, 400, "VALIDATION_ERROR");
    assert.equal(updateOptions.json().error.details[0]?.code, "sensitive_survey_not_allowed_v1");
    assert.deepEqual(await db.pollOption.findMany({ where: { pollId: first.id }, orderBy: { position: "asc" }, select: { label: true } }), existing,
      "reddedilen PATCH seçenekleri veritabanına yazmaz");

    const secondOwner = await signUp(); // Yayın cooldown testte farklı hesabı gerektirir.
    const second = await createPoll(secondOwner.cookie, {
      title: "Kültürel miras üzerine genel değerlendirme",
      description: "",
      options: [{ label: "Alevi" }, { label: "Sünni" }],
    });
    const updateTitle = await send("PATCH", `/polls/${second.id}`, { title: "Hangisisin? Sana yakın olan grubu seç" }, secondOwner.cookie);
    assertError(updateTitle, 400, "VALIDATION_ERROR");
    assert.equal(updateTitle.json().error.details[0]?.code, "sensitive_survey_not_allowed_v1");
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: second.id }, select: { title: true } })).title,
      "Kültürel miras üzerine genel değerlendirme", "reddedilen PATCH başlığı veritabanına yazmaz");
  });

  test("eşzamanlı başlık ve seçenek PATCH birleşimi transaction kilidinden sonra engellenir", async () => {
    const owner = await signUp();
    const poll = await createPoll(owner.cookie, {
      title: "Genel tercihlerin değerlendirilmesi",
      description: "",
      options: [{ label: "Birinci seçenek" }, { label: "İkinci seçenek" }],
    });
    const [titleUpdate, optionsUpdate] = await Promise.all([
      send("PATCH", `/polls/${poll.id}`, { title: "Hangisisin? Sana yakın olan grubu seç" }, owner.cookie),
      send("PATCH", `/polls/${poll.id}`, {
        options: [{ id: poll.options[0]!.id, label: "Alevi" }, { id: poll.options[1]!.id, label: "Sünni" }],
      }, owner.cookie),
    ]);
    assert.deepEqual([titleUpdate.statusCode, optionsUpdate.statusCode].sort((a, b) => a - b), [200, 400],
      "eşzamanlı masum PATCH'lerin ikisi birlikte hassas bir anket oluşturamamalı");
    const saved = await db.poll.findUniqueOrThrow({
      where: { id: poll.id }, select: { title: true, description: true, extraInfo: true, options: { select: { label: true } } },
    });
    assert.equal(detectSensitiveSurvey(saved), null, "commit sonrası hassas soru/seçenek birleşimi oluşmamalı");
  });

  test("genel sağlık hizmeti değerlendirmesi ve sıradan ürün anketleri otomatik olarak yasaklanmaz", async () => {
    const owner = await signUp();
    const first = await createPoll(owner.cookie, {
      title: "Sağlık Bakanlığı randevu hizmeti nasıl iyileştirilebilir?",
      options: [{ label: "Mobil uygulama" }, { label: "Web sitesi" }],
    });
    assert.ok(first.id);
    const publicView = await get(`/polls/${first.id}`);
    assert.equal(publicView.statusCode, 200);
  });


  // ─── V1 seçici yayın öncesi inceleme ────────────────────────

  test("şüpheli anket 202 UNDER_REVIEW olur; misafire 404, yetkisiz onay 403; ADMIN onayıyla süre yeniden başlar", async () => {
    const owner = await signUp();
    const reviewer = await signUp();
    await db.userRole.create({ data: { userId: reviewer.id, role: "ADMIN", grantedById: owner.id } });
    const content = pollBody({
      title: "Siyasi partilerin trafik vaatleri nasıl değerlendirilmeli?",
      description: "Şehir trafiği ve ulaşım projeleri üzerine genel değerlendirme.",
    });
    const idemKey = key();
    const first = await send("POST", "/polls", content, owner.cookie, idemKey);
    assert.equal(first.statusCode, 202, first.body);
    assert.deepEqual(Object.keys(first.json().data).sort(), ["id", "status"]);
    assert.equal(first.json().data.status, "UNDER_REVIEW");
    const pendingId: string = first.json().data.id;
    const saved = await db.poll.findUniqueOrThrow({ where: { id: pendingId }, select: { status: true, opensAt: true, closesAt: true } });
    assert.equal(saved.status, "UNDER_REVIEW");

    assertError(await get(`/polls/${pendingId}`), 404, "NOT_FOUND");
    assertError(await get(`/polls/${pendingId}`, owner.cookie), 404, "NOT_FOUND");
    const repeated = await send("POST", "/polls", content, owner.cookie, idemKey);
    assert.equal(repeated.statusCode, 202, repeated.body);
    assert.equal(repeated.json().data.id, pendingId);
    assert.equal(await db.poll.count({ where: { authorId: owner.id } }), 1);
    // Core poll harness intentionally runs with publishCostPoints=0; charge
    // accounting under real 10-point settings is independently covered by
    // points.test.ts. An identical 202 replay must never add ledger entries.
    assert.equal(await db.pointLedgerEntry.count({ where: { userId: owner.id, reason: "PUBLISH" } }), 0,
      "inceleme makbuzunun idempotent tekrarı yeni işlem yaratmaz");

    const attempts = { action: "RESTORE", reason: "Riskli olmayan genel kamu hizmeti sorusu olarak incelendi." };
    assertError(await send("POST", `/admin/polls/${pendingId}/moderation`, attempts, owner.cookie), 403, "FORBIDDEN");
    const queue = await get("/admin/polls?status=UNDER_REVIEW", reviewer.cookie);
    assert.equal(queue.statusCode, 200, queue.body);
    assert.ok(queue.json().data.some((row: { id: string }) => row.id === pendingId));

    h.clock.advance(73 * HOUR);
    // An unpublished poll must NEVER emit a poll.closed event while queued,
    // even if its original pre-review closesAt is now in the past.
    const expiredCandidates = await findExpired(db, new Date(h.clock.now.getTime() - 10 * 24 * HOUR), h.clock.now, 1000);
    assert.equal(expiredCandidates.includes(pendingId), false);
    const accepted = await send("POST", `/admin/polls/${pendingId}/moderation`, attempts, reviewer.cookie);
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().data.status, "ACTIVE");
    const published = await db.poll.findUniqueOrThrow({ where: { id: pendingId }, select: { status: true, opensAt: true, closesAt: true } });
    assert.equal(published.status, "ACTIVE");
    assert.equal(published.opensAt.getTime(), h.clock.now.getTime(), "oylama süresi moderatör onayında başlamalı");
    assert.equal(published.closesAt!.getTime() - published.opensAt.getTime(), 72 * HOUR);
    assert.equal((await get(`/polls/${pendingId}`)).statusCode, 200);
    // Idempotency receipts expire before this 73h clock jump; the
    // same-key replay was already proven above while the receipt was valid.
    h.clock.advance(-73 * HOUR);
  });

  test("ACTIVE anketin PATCH ile riskli link eklemesi 400 olur ve herkese açık içerik değişmez", async () => {
    const owner = await signUp();
    const poll = await createPoll(owner.cookie, {
      title: "Telefon batarya ömrünü nasıl buluyorsunuz?",
      description: "Şarj süresi hakkında genel yorum",
    });
    const response = await send("PATCH", `/polls/${poll.id}`,
      { description: "Daha fazla bilgi: https://example.com" }, owner.cookie);
    assertError(response, 400, "VALIDATION_ERROR");
    const stored = await db.poll.findUniqueOrThrow({
      where: { id: poll.id }, select: { description: true, status: true },
    });
    assert.equal(stored.status, "ACTIVE");
    assert.equal(stored.description, "Şarj süresi hakkında genel yorum");
  });

  test("generic RESTORE cannot publish a rejected review without audited appeal", async () => {
    const owner = await signUp();
    const reviewer = await signUp();
    await db.userRole.create({ data: { userId: reviewer.id, role: "ADMIN", grantedById: owner.id } });
    const submitted = await send("POST", "/polls", pollBody({
      title: "Siyasi partilerin ulaşım projeleri nasıl değerlendirilmeli?",
    }), owner.cookie, key());
    assert.equal(submitted.statusCode, 202, submitted.body);
    const id: string = submitted.json().data.id;
    const denied = await send("POST", `/admin/polls/${id}/moderation`,
      { action: "REMOVE", reason: "Ön incelemeden geçmedi." }, reviewer.cookie);
    assert.equal(denied.statusCode, 200, denied.body);
    const bypass = await send("POST", `/admin/polls/${id}/moderation`,
      { action: "RESTORE", reason: "Kontrolsüz yayınlama denemesi" }, reviewer.cookie);
    assert.equal(bypass.statusCode, 409, bypass.body);
    const after = await db.poll.findUniqueOrThrow({ where: { id }, select: { status: true } });
    assert.equal(after.status, "REMOVED");
  });

  test("düşük riskli sıradan anket doğrudan 201 ve ACTIVE olur", async () => {
    const owner = await signUp();
    const result = await send("POST", "/polls", pollBody({ title: "Telefon batarya ömrünü nasıl buluyorsunuz?" }), owner.cookie, key());
    assert.equal(result.statusCode, 201, result.body);
    assert.equal(PollDetail.parse(result.json().data).status, "ACTIVE");
  });


  test("sıfır yayın ücretiyle inceleme reddi, var olmayan kesintiyi 10 puan iade diye üretmez", async () => {
    const owner = await signUp();
    const reviewer = await signUp();
    await db.userRole.create({ data: { userId: reviewer.id, role: "ADMIN", grantedById: owner.id } });
    const created = await send("POST", "/polls",
      pollBody({ title: "Siyasi partilerin şehir içi ulaşım projeleri tartışması" }), owner.cookie, key());
    assert.equal(created.statusCode, 202, created.body);
    const id = created.json().data.id as string;
    assert.equal(await db.pointLedgerEntry.count({ where: { userId: owner.id, referenceId: id, reason: "PUBLISH" } }), 0);
    const decision = await send("POST", `/admin/polls/${id}/moderation`,
      { action: "REMOVE", reason: "İnceleme kararıyla yayımlanmadı." }, reviewer.cookie);
    assert.equal(decision.statusCode, 200, decision.body);
    assert.equal(await db.pointLedgerEntry.count({ where: { userId: owner.id, referenceId: id, reason: "MODERATION_REFUND" } }), 0);
  });


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

  test("görseller: yalnız sahip görsel ekler, APPROVED dahil bütün görselli anketler ön incelemeye girer", async () => {
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
    const submitted = await send("POST", "/polls", pollBody({ mediaIds: [pending.id, approved.id] }), owner.cookie, key());
    assert.equal(submitted.statusCode, 202, submitted.body);
    assert.deepEqual(Object.keys(submitted.json().data).sort(), ["id", "status"], "review receipt never carries media URLs");
    const reviewId = submitted.json().data.id as string;
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: reviewId } })).status, "UNDER_REVIEW");
    assertError(await get(`/polls/${reviewId}`), 404, "NOT_FOUND");
    // Media can contain sensitive text; it is shown publicly only after a
    // moderator approves the poll AND media approval has completed.
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

  test("yeni anket eksik sonuç görünürlüğüyle oluşturulunca ALWAYS olur, eski AFTER_VOTE tercihi değişmez", async () => {
    const privateOwner = await signUp();
    const publicOwner = await signUp();
    const oldPrivate = await createPoll(privateOwner.cookie, { resultsVisibility: "AFTER_VOTE" });
    const anonymousNewBody: Record<string, unknown> = pollBody();
    delete anonymousNewBody.resultsVisibility;

    const created = await send("POST", "/polls", anonymousNewBody, publicOwner.cookie, key());
    assert.equal(created.statusCode, 201, created.body);
    const newPoll = PollDetail.parse(created.json().data);
    assert.equal(newPoll.resultsVisibility, "ALWAYS");
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: newPoll.id } })).resultsVisibility, "ALWAYS");

    const guestNew = PollDetail.parse((await get(`/polls/${newPoll.id}`)).json().data);
    assert.equal(guestNew.viewer, null);
    assert.equal(guestNew.results?.visible, true);
    const guestExisting = PollDetail.parse((await get(`/polls/${oldPrivate.id}`)).json().data);
    assert.equal(guestExisting.resultsVisibility, "AFTER_VOTE");
    assert.deepEqual(guestExisting.results, { visible: false });
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: oldPrivate.id } })).resultsVisibility, "AFTER_VOTE");
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

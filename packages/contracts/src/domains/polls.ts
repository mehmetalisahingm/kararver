// Anket / tartışma gönderisi, oy ve tepki — sağlayıcı Faruk
// KV-10 (#12), KV-11 (#13), #66 (tartışma + tepki), #67 (yayın puanı, sağlayıcı Mehmet)
import { z } from "zod";
import {
  CategoryRef,
  CommunityRef,
  Count,
  dataOf,
  Empty,
  Id,
  IdParams,
  LocalDate,
  MediaRef,
  Percent,
  PublicUser,
  ReactionSummary,
  ReactionValue,
  Timestamp,
} from "../common.ts";
import { defineEndpoint } from "../endpoint.ts";

export const PollKind = z.enum(["POLL", "DISCUSSION"]);
export const ResultsVisibility = z.enum(["ALWAYS", "AFTER_VOTE"]);

/**
 * Sonuç projeksiyonu. Gizliyken SADECE `{visible:false}`; toplam oy dahil hiçbir sayı yoktur.
 * strictObject: fazladan alan (ör. voterIds, total) şema ihlalidir.
 */
export const Results = z.discriminatedUnion("visible", [
  z.strictObject({ visible: z.literal(false) }),
  z.strictObject({
    visible: z.literal(true),
    total: Count,
    options: z.array(z.strictObject({ id: Id, votes: Count, percent: Percent })),
  }),
]);

export const PollOption = z.strictObject({ id: Id, label: z.string(), position: z.number().int().min(0).max(5) });

/**
 * Oy verememe sebebi (öncelik sırası helpers.ts → voteBlockedReasons).
 * UI oy butonunu buna göre gösterir: OWN_POLL → gizle, EMAIL_NOT_VERIFIED → doğrulama ekranı,
 * POLL_CLOSED/CONTENT_LOCKED → sonuç, VOTE_CHANGE_DISABLED → mevcut oy seçili ve kilitli.
 */
export const VoteBlockedReason = z.enum([
  "NOT_A_POLL",
  "OWN_POLL",
  "POLL_CLOSED",
  "CONTENT_LOCKED",
  "ACCOUNT_RESTRICTED",
  "EMAIL_NOT_VERIFIED",
  "VOTE_INVALIDATED",
  "VOTE_CHANGE_DISABLED",
]);

/** İzleyiciye özel alanlar; misafirde `viewer: null` (UI oy için giriş ister). */
export const PollViewer = z
  .strictObject({
    vote: Id.nullable(),
    voteInvalidated: z.boolean(),
    reaction: ReactionValue.nullable(),
    bookmarked: z.boolean(),
    following: z.boolean(),
    isAuthor: z.boolean(),
    canVote: z.boolean(),
    voteBlockedReason: VoteBlockedReason.nullable(),
  })
  .refine((v) => v.canVote === (v.voteBlockedReason === null), {
    message: "canVote ancak voteBlockedReason null iken true olabilir",
    path: ["voteBlockedReason"],
  })
  .refine((v) => !(v.isAuthor && v.canVote), { message: "Anket sahibi oy veremez", path: ["canVote"] });

/** Feed, arama, trend ve profil listelerindeki kart. */
export const PollCard = z.strictObject({
  id: Id,
  publicId: z.string().min(6).max(12),
  slug: z.string(),
  kind: PollKind,
  title: z.string(),
  excerpt: z.string().nullable(),
  author: PublicUser,
  category: CategoryRef,
  community: CommunityRef.nullable(),
  coverImage: MediaRef.nullable(),
  status: z.enum(["ACTIVE", "LOCKED"]),
  createdAt: Timestamp,
  closesAt: Timestamp.nullable(),
  closed: z.boolean(),
  commentCount: Count,
  reactions: ReactionSummary,
  /** DISCUSSION için null. */
  results: Results.nullable(),
  viewer: PollViewer.nullable(),
});

export const Price = z.strictObject({
  /** Ondalık string ("3000000.00"); float hassasiyet kaybı olmasın diye sayı değil. */
  amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
  currency: z.literal("TRY"),
});

export const Addendum = z.strictObject({ id: Id, body: z.string(), createdAt: Timestamp });

export const PollDetail = z.strictObject({
  ...PollCard.shape,
  description: z.string().nullable(),
  extraInfo: z.string().nullable(),
  price: Price.nullable(),
  tags: z.array(z.string()),
  media: z.array(MediaRef),
  /** DISCUSSION için boş dizi. */
  options: z.array(PollOption),
  resultsVisibility: ResultsVisibility.nullable(),
  allowComments: z.boolean(),
  /** İlk geçerli oydan sonra true: başlık, açıklama, seçenekler, sonuç görünürlüğü değişmez. */
  contentLocked: z.boolean(),
  opensAt: Timestamp,
  closedAt: Timestamp.nullable(),
  addenda: z.array(Addendum),
  canonicalPath: z.string().startsWith("/karar/"),
});

// ─── İstekler ─────────────────────────────────────────────────

const Title = z.string().trim().min(10).max(200);
const Description = z.string().trim().max(5000);
const OptionLabel = z.string().trim().min(1).max(120);
const TagSlug = z.string().regex(/^[a-z0-9-]{2,40}$/);

const commonCreate = {
  title: Title,
  description: Description.optional(),
  categoryId: Id,
  communityId: Id.optional(),
  tagSlugs: z.array(TagSlug).max(5).optional(),
  mediaIds: z.array(Id).max(10).optional(),
  allowComments: z.boolean().default(true),
};

export const CreatePollBody = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("POLL"),
    ...commonCreate,
    price: Price.optional(),
    extraInfo: z.string().trim().max(1000).optional(),
    /** Sunucu sınırı /config → polls.min/maxDurationHours (varsayılan 1–720). */
    durationHours: z.number().int().min(1).max(720),
    resultsVisibility: ResultsVisibility,
    options: z
      .array(z.strictObject({ label: OptionLabel }))
      .min(2)
      .max(6)
      .refine((o) => new Set(o.map((x) => x.label.toLocaleLowerCase("tr"))).size === o.length, "Seçenekler birbirinden farklı olmalı"),
  }),
  z.strictObject({ kind: z.literal("DISCUSSION"), ...commonCreate }),
]);

export const UpdatePollBody = z
  .strictObject({
    title: Title.optional(),
    description: Description.nullable().optional(),
    categoryId: Id.optional(),
    tagSlugs: z.array(TagSlug).max(5).optional(),
    price: Price.nullable().optional(),
    extraInfo: z.string().trim().max(1000).nullable().optional(),
    allowComments: z.boolean().optional(),
    resultsVisibility: ResultsVisibility.optional(),
    options: z.array(z.strictObject({ id: Id.optional(), label: OptionLabel })).min(2).max(6).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "En az bir alan gönderilmeli");

export const VoteResult = z.strictObject({
  vote: z.strictObject({ optionId: Id, changeCount: Count, updatedAt: Timestamp }),
  results: Results,
});

const polls = { owner: "Faruk", module: "polls" } as const;
const votes = { owner: "Faruk", module: "votes" } as const;
const reactions = { owner: "Faruk", module: "reactions" } as const;
const trends = { owner: "Faruk", module: "trends" } as const;
const web = ["Ümit (web)"];
const detailResponse = { 200: dataOf(PollDetail) };

export const pollEndpoints = [
  defineEndpoint({
    id: "polls.create",
    domain: "polls",
    method: "POST",
    path: "/polls",
    summary: "Anket veya tartışma gönderisi yayımlar (10 puan)",
    auth: "verified",
    provider: polls,
    consumers: web,
    unblocks: ["#12", "#66", "#67", "#15", "#22"],
    availability: { status: "ready" },
    request: { body: CreatePollBody },
    responses: { 201: dataOf(PollDetail) },
    errors: [
      "INSUFFICIENT_POINTS",
      "PUBLISH_COOLDOWN",
      "DAILY_PUBLISH_LIMIT",
      "DUPLICATE_TITLE",
      "MEDIA_NOT_USABLE",
      "FEATURE_DISABLED",
    ],
    idempotency: "key-required",
    cache: "private",
    notes: [
      "Yayın ve 10 puanlık harcama aynı transaction'dadır; başarısız yayın puan harcamaz (#67).",
      "Aynı Idempotency-Key + aynı gövde: ilk sonucun aynısı (201) döner, ikinci harcama olmaz. Farklı gövde: 409 IDEMPOTENCY_KEY_REUSED.",
      "kind=DISCUSSION (#66): seçeneksiz, süresiz tartışma/soru gönderisi; options, results ve resultsVisibility null/boş, closesAt null, hiç kapanmaz. Yayın limitleri ve aynı başlık kuralı iki türde de aynıdır.",
      "Puan harcaması planlı (#67): o gelene kadar iki tür de puansız yayınlanır.",
      "mediaIds: yükleyenin kendi, REJECTED olmayan POLL görselleri; APPROVED olana kadar media dizisinde görünmez.",
    ],
  }),
  defineEndpoint({
    id: "polls.get",
    domain: "polls",
    method: "GET",
    path: "/polls/:id",
    summary: "Anket detayı (izleyiciye göre sonuç projeksiyonu)",
    auth: "public",
    provider: polls,
    consumers: [...web, "Mehmet (paylaşım/SEO, KV-25)"],
    unblocks: ["#12", "#15", "#20", "#27"],
    availability: { status: "ready" },
    request: { params: IdParams },
    responses: detailResponse,
    errors: [],
    idempotency: "none",
    cache: "viewer",
    notes: [
      "HIDDEN/UNDER_REVIEW/REMOVED içerik yetkisiz izleyiciye 404 döner; sahibi kendi UNDER_REVIEW içeriğini görür.",
      "Anket sahibi AFTER_VOTE anketinde de sonuçları her zaman görür (oy veremediği için); diğer izleyicilere kural aynen uygulanır.",
      "viewer.canVote / viewer.voteBlockedReason oy butonunun durumunu verir; misafirde viewer null.",
    ],
  }),
  defineEndpoint({
    id: "polls.lookup",
    domain: "polls",
    method: "GET",
    path: "/polls/lookup",
    summary: "SEO URL'indeki publicId'den detay (/karar/<slug>-<publicId>)",
    auth: "public",
    provider: polls,
    consumers: [...web, "Mehmet (paylaşım/SEO, KV-25)"],
    unblocks: ["#12", "#27"],
    availability: { status: "ready" },
    request: { query: z.strictObject({ publicId: z.string().regex(/^[A-Za-z0-9_-]{6,12}$/) }) },
    responses: detailResponse,
    errors: ["NOT_FOUND"],
    idempotency: "none",
    cache: "viewer",
    notes: [
      "Slug yetki veya kimlik kanıtı değildir; yanlış slug ile gelen sayfa canonicalPath'e yönlendirir.",
      "Router'da /polls/:id'den önce tanımlanır (veya :id UUID ile sınırlandırılır); 'lookup' bir id değildir.",
    ],
  }),
  defineEndpoint({
    id: "polls.update",
    domain: "polls",
    method: "PATCH",
    path: "/polls/:id",
    summary: "Sahibinin düzenlemesi",
    auth: "owner",
    provider: polls,
    consumers: web,
    unblocks: ["#12"],
    availability: { status: "ready" },
    request: { params: IdParams, body: UpdatePollBody },
    responses: detailResponse,
    errors: ["POLL_CONTENT_LOCKED", "CONTENT_LOCKED", "NOT_A_POLL"],
    idempotency: "natural",
    cache: "private",
    notes: [
      "İlk geçerli oydan sonra title, description, options, resultsVisibility → 409 POLL_CONTENT_LOCKED (DB trigger).",
      "options gönderilirse tam liste olarak yerine geçer; id'li olanlar korunur (sadece kilitsizken).",
    ],
  }),
  defineEndpoint({
    id: "polls.close",
    domain: "polls",
    method: "POST",
    path: "/polls/:id/close",
    summary: "Sahibin erken kapatması",
    auth: "owner",
    provider: polls,
    consumers: web,
    unblocks: ["#12"],
    availability: { status: "ready" },
    request: { params: IdParams },
    responses: detailResponse,
    errors: ["NOT_A_POLL"],
    idempotency: "natural",
    cache: "private",
    notes: ["Zaten kapalıysa 200 ve değişiklik yok."],
  }),
  defineEndpoint({
    id: "polls.delete",
    domain: "polls",
    method: "DELETE",
    path: "/polls/:id",
    summary: "Sahibin kaldırması (soft delete)",
    auth: "owner",
    provider: polls,
    consumers: web,
    unblocks: ["#12"],
    availability: { status: "ready" },
    request: { params: IdParams },
    responses: { 204: Empty },
    errors: [],
    idempotency: "natural",
    cache: "private",
    notes: ["Harcanan puan iade edilmez (V1_USER_FLOW)."],
  }),
  defineEndpoint({
    id: "polls.addenda.create",
    domain: "polls",
    method: "POST",
    path: "/polls/:id/addenda",
    summary: "Tarihli ek açıklama (kilitli ankete bilgi eklemenin tek yolu)",
    auth: "owner",
    provider: polls,
    consumers: web,
    unblocks: ["#12", "#20"],
    availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ body: z.string().trim().min(1).max(2000) }) },
    responses: { 201: dataOf(Addendum) },
    errors: [],
    idempotency: "key-optional",
    cache: "private",
  }),
  defineEndpoint({
    id: "votes.put",
    domain: "polls",
    method: "PUT",
    path: "/polls/:id/vote",
    summary: "Oy ver / değiştir (tek aktif oy)",
    auth: "verified",
    provider: votes,
    consumers: web,
    unblocks: ["#13", "#15", "#20"],
    availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ optionId: Id }) },
    responses: { 201: dataOf(VoteResult), 200: dataOf(VoteResult) },
    errors: ["SELF_VOTE_FORBIDDEN", "NOT_A_POLL", "POLL_CLOSED", "CONTENT_LOCKED", "VOTE_CHANGE_DISABLED", "VOTE_INVALIDATED"],
    idempotency: "natural",
    cache: "private",
    notes: [
      "İlk oy 201. Aynı seçeneğe tekrar 200 (yeni olay yok). Farklı seçenek: ayar izin veriyorsa 200 + CHANGE, vermiyorsa 409 VOTE_CHANGE_DISABLED.",
      "Eşzamanlı istekler: UNIQUE(poll_id,user_id) çakışması yakalanır, satır tekrar okunur ve aynı kurallar uygulanır. Idempotency-Key gerekmez.",
      "Başka anketin seçeneği → 400 VALIDATION_ERROR (field: optionId).",
      "Anket sahibi kendi anketine oy veremez: 403 SELF_VOTE_FORBIDDEN. Sunucu oturum kullanıcısını DB authorId ile karşılaştırır; ilk oy, tekrar ve değişimde rol istisnası yoktur. Reddedilen istek oy/olay/sayaç değiştirmez.",
      "Cevaptaki results oy sonrası izleyiciye göre hesaplanır (AFTER_VOTE ise artık görünür).",
      "Hata sırası viewer.voteBlockedReason ile aynıdır: NOT_A_POLL, SELF_VOTE_FORBIDDEN, POLL_CLOSED, CONTENT_LOCKED, ACCOUNT_RESTRICTED, EMAIL_NOT_VERIFIED, VOTE_INVALIDATED, VOTE_CHANGE_DISABLED (helpers.ts → voteAvailability).",
    ],
  }),
  defineEndpoint({
    id: "reactions.poll.put",
    domain: "polls",
    method: "PUT",
    path: "/polls/:id/reaction",
    summary: "Gönderiye beğeni/dislike (oydan ayrı)",
    auth: "user",
    provider: reactions,
    consumers: web,
    unblocks: ["#66", "#20"],
    availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ value: ReactionValue }) },
    responses: { 200: dataOf(ReactionSummary) },
    errors: ["CONTENT_LOCKED"],
    idempotency: "natural",
    cache: "private",
    notes: [
      "Hesap + hedef başına tek aktif tepki; aynı değer tekrar 200; LIKE ↔ DISLIKE değiştirir. Anket oyundan ayrıdır; anket ve tartışmada çalışır.",
      "Kapanmış ankette tepki verilebilir; kilitli (LOCKED) içerikte 409 CONTENT_LOCKED. Görünmeyen içerik 404.",
    ],
  }),
  defineEndpoint({
    id: "reactions.poll.delete",
    domain: "polls",
    method: "DELETE",
    path: "/polls/:id/reaction",
    summary: "Gönderi tepkisini kaldırır",
    auth: "user",
    provider: reactions,
    consumers: web,
    unblocks: ["#66", "#20"],
    availability: { status: "ready" },
    request: { params: IdParams },
    responses: { 200: dataOf(ReactionSummary) },
    errors: [],
    idempotency: "natural",
    cache: "private",
  }),
  defineEndpoint({
    id: "polls.history",
    domain: "polls",
    method: "GET",
    path: "/polls/:id/history",
    summary: "Günlük dağılım (grafik verisi, İstanbul günleri)",
    auth: "public",
    provider: trends,
    consumers: ["Ümit (trend/grafik, KV-30)"],
    unblocks: ["#31", "#32"],
    availability: { status: "ready" },
    request: { params: IdParams },
    responses: {
      200: dataOf(
        z.discriminatedUnion("visible", [
          z.strictObject({ visible: z.literal(false) }),
          z.strictObject({
            visible: z.literal(true),
            days: z.array(
              z.strictObject({
                localDate: LocalDate,
                pollDay: z.number().int().min(0),
                total: Count,
                options: z.array(z.strictObject({ id: Id, votes: Count, percent: Percent })),
              }),
            ),
          }),
        ]),
      ),
    },
    errors: ["NOT_A_POLL"],
    idempotency: "none",
    cache: "viewer",
    notes: ["Gizli sonuç kuralı aynen uygulanır. Eksik gün uydurulmaz: snapshot'ı olmayan gün dizide yer almaz."],
  }),
];

// Sözleşme örnekleri: her endpoint için en az bir başarılı istek/cevap ve önemli hata senaryoları.
// Frontend mock'ları (KV-06) ve contract testleri bunları kullanır. Üretim verisi değildir.
// Her örnek, testte endpoint'in request ve response şemalarına karşı doğrulanır.

export type Example = {
  endpoint: string;
  name: string;
  request?: { params?: unknown; query?: unknown; body?: unknown };
  status: number;
  body: unknown;
};

// ─── Sabit kimlikler ve zamanlar ──────────────────────────────
const id = (n: number) => `01998b9a-0000-7000-8000-${String(n).padStart(12, "0")}`;
const U1 = id(1); // deniz (anket sahibi)
const U2 = id(2); // ümit (izleyici)
const CAT = id(10);
const COMM = id(11);
const POLL = id(20);
const DISC = id(21);
const OPT_A = id(30);
const OPT_B = id(31);
const COMMENT = id(40);
const REPLY = id(41);
const MEDIA = id(50);
const REPORT = id(60);
const NOTIF = id(70);
const SANCTION = id(80);
const FEATURED = id(90);
const ANN = id(91);
const LEDGER = id(92);
const AUDIT = id(93);
const VOTE = id(94);
const T0 = "2026-09-27T09:00:00.000Z";
const T1 = "2026-09-28T09:00:00.000Z";
const T_CLOSE = "2026-09-30T09:00:00.000Z";
const requestId = "req_01998b9a00007000";

const error = (code: string, message: string, details: unknown[] = []) => ({ error: { code, message, details }, requestId });
const data = (value: unknown) => ({ data: value });
const page = (items: unknown[], nextCursor: string | null = null) => ({ data: items, page: { nextCursor, hasMore: nextCursor !== null } });

// ─── Paylaşılan görünümler ────────────────────────────────────
const deniz = { id: U1, username: "deniz", displayName: "Deniz", avatarUrl: null };
const umit = { id: U2, username: "umit", displayName: "Ümit", avatarUrl: "https://cdn.kararver.test/a/umit.webp" };
const me = {
  ...umit,
  email: "umit@example.test",
  emailVerified: true,
  bio: null,
  status: "ACTIVE",
  roles: ["USER"],
  createdAt: T0,
};
const categoryRef = { id: CAT, slug: "otomobil", name: "Otomobil" };
const category = { ...categoryRef, description: null, iconKey: "car", sortOrder: 2 };
const communityRef = { id: COMM, slug: "samsun-universitesi", name: "Samsun Üniversitesi" };
const bannedMedia = { id: id(51), sourceMediaId: MEDIA, reason: "Tekrar yüklenen uygunsuz görsel", matchesExact: true, matchesSimilar: true, createdBy: deniz, createdAt: T0 };
const mediaRef = { id: MEDIA, url: "https://cdn.kararver.test/m/araba.webp", width: 1280, height: 960 };
const noReactions = { likes: 0, dislikes: 0, viewer: null };
const hidden = { visible: false };
const visible = {
  visible: true,
  total: 10,
  options: [
    { id: OPT_A, votes: 6, percent: 60 },
    { id: OPT_B, votes: 4, percent: 40 },
  ],
};
const guestViewer = null;
const viewer = (vote: string | null) => ({
  vote,
  voteInvalidated: false,
  reaction: null,
  bookmarked: false,
  following: false,
  isAuthor: false,
  canVote: true,
  voteBlockedReason: null,
});
/** Anket sahibi: oy veremez, sonuçları her zaman görür. */
const authorViewer = { ...viewer(null), isAuthor: true, canVote: false, voteBlockedReason: "OWN_POLL" };
const emptyResults = {
  visible: true,
  total: 0,
  options: [
    { id: OPT_A, votes: 0, percent: 0 },
    { id: OPT_B, votes: 0, percent: 0 },
  ],
};

const card = (results: unknown, v: unknown = guestViewer) => ({
  id: POLL,
  publicId: "ab12cd34",
  slug: "bu-araba-bu-fiyata-alinir-mi",
  kind: "POLL",
  title: "Bu araba bu fiyata alınır mı?",
  excerpt: "2019 model, 85 bin km, sağ çamurluk boyalı.",
  author: deniz,
  category: categoryRef,
  community: null,
  coverImage: mediaRef,
  status: "ACTIVE",
  createdAt: T0,
  closesAt: T_CLOSE,
  closed: false,
  commentCount: 3,
  reactions: noReactions,
  results,
  viewer: v,
});

const detail = (results: unknown, v: unknown = guestViewer, extra: Record<string, unknown> = {}) => ({
  ...card(results, v),
  description: "2019 model, 85 bin km, sağ çamurluk boyalı. Fiyat piyasaya göre nasıl?",
  extraInfo: null,
  price: { amount: "1250000.00", currency: "TRY" },
  tags: ["ikinci-el"],
  media: [mediaRef],
  options: [
    { id: OPT_A, label: "Alınır", position: 0 },
    { id: OPT_B, label: "Alınmaz", position: 1 },
  ],
  resultsVisibility: "AFTER_VOTE",
  allowComments: true,
  contentLocked: true,
  opensAt: T0,
  closedAt: null,
  addenda: [],
  canonicalPath: "/karar/bu-araba-bu-fiyata-alinir-mi-ab12cd34",
  ...extra,
});

const discussion = {
  ...detail(null, guestViewer, {
    options: [],
    resultsVisibility: null,
    contentLocked: false,
    price: null,
    tags: [],
    media: [],
  }),
  id: DISC,
  publicId: "zz98yy76",
  slug: "bu-butceyle-hangi-arabayi-almaliyim",
  kind: "DISCUSSION",
  title: "Bu bütçeyle hangi arabayı almalıyım?",
  coverImage: null,
  closesAt: null,
  canonicalPath: "/karar/bu-butceyle-hangi-arabayi-almaliyim-zz98yy76",
};

const comment = (overrides: Record<string, unknown> = {}) => ({
  id: COMMENT,
  pollId: POLL,
  parentId: null,
  kind: "COMMENT",
  body: "Boyalı parça fiyatı düşürür, pazarlık payı var.",
  deleted: false,
  author: umit,
  reactions: noReactions,
  replyCount: 1,
  editedAt: null,
  createdAt: T1,
  viewer: null,
  ...overrides,
});

const mediaView = (status: string, extra: Record<string, unknown> = {}) => ({
  id: MEDIA,
  purpose: "POLL",
  status,
  url: null,
  preview: { url: "https://storage.kararver.test/private/x?sig=abc", expiresAt: "2026-09-27T09:05:00.000Z" },
  width: 1280,
  height: 960,
  createdAt: T0,
  ...extra,
});

const report = { id: REPORT, target: { type: "COMMENT", id: COMMENT }, reason: "SPAM", note: null, status: "OPEN", reportCount: 2, communityId: null, createdAt: T1, resolvedAt: null };
const communityCard = { ...communityRef, description: "Kampüs, yemekhane, ulaşım.", imageUrl: null, memberCount: 128 };
const communityDetail = { ...communityCard, membersVisibility: "MEMBERS", createdAt: T0, viewer: { role: "MEMBER" } };
const notification = { id: NOTIF, type: "COMMENT_ON_POLL", subject: { type: "POLL", id: POLL }, actor: umit, data: {}, readAt: null, createdAt: T1 };
const sanction = { id: SANCTION, type: "SUSPEND", reason: "Tekrarlayan spam", startsAt: T1, endsAt: T_CLOSE, liftedAt: null, createdBy: deniz, liftedBy: null, liftReason: null };
const adminUser = { ...umit, email: "umit@example.test", status: "ACTIVE", roles: ["USER"], createdAt: T0, reportCount: 0 };
const setting = { key: "polls.voteChangeAllowed", value: true, version: 3, updatedAt: T1, updatedBy: deniz };
const featured = { id: FEATURED, pollId: POLL, surface: "HOME_SPOTLIGHT", scopeId: null, priority: 10, badge: "Editörün Seçimi", startsAt: T0, endsAt: T_CLOSE };
const announcement = { id: ANN, title: "Kapalı beta başladı", body: "Geri bildirimlerinizi bekliyoruz.", level: "INFO", startsAt: T0, endsAt: null };
const ledger = { id: LEDGER, delta: -10, balanceAfter: 10, reason: "PUBLISH", referenceId: POLL, createdAt: T1 };
const features = { registration: true, pollCreation: true, comments: true, uploads: true };
const publicConfig = {
  polls: { minOptions: 2, maxOptions: 6, minDurationHours: 1, maxDurationHours: 720, titleMaxLength: 200, descriptionMaxLength: 5000, voteChangeAllowed: true },
  comments: { bodyMaxLength: 2000 },
  media: { maxBytes: 8 * 1024 * 1024, maxPerPoll: 10, allowedTypes: ["image/jpeg", "image/png", "image/webp"] },
  points: { initialGrant: 20, publishCost: 10 },
  features,
  maintenance: false,
};
const createPoll = {
  kind: "POLL",
  title: "Bu araba bu fiyata alınır mı?",
  description: "2019 model, 85 bin km.",
  categoryId: CAT,
  mediaIds: [MEDIA],
  price: { amount: "1250000.00", currency: "TRY" },
  durationHours: 72,
  resultsVisibility: "AFTER_VOTE",
  options: [{ label: "Alınır" }, { label: "Alınmaz" }],
};
const pollParams = { id: POLL };
const reason = "Topluluk kurallarına aykırı";

export const examples: Example[] = [
  // ── auth ──
  { endpoint: "auth.register", name: "ok", request: { body: { email: "yeni@example.test", username: "yeni_kullanici", displayName: "Yeni", password: "cok-guclu-sifre" } }, status: 202, body: data({ status: "VERIFICATION_SENT" }) },
  { endpoint: "auth.register", name: "username-taken", request: { body: { email: "a@example.test", username: "deniz", displayName: "D", password: "cok-guclu-sifre" } }, status: 409, body: error("USERNAME_TAKEN", "Bu kullanıcı adı alınmış.", [{ field: "username", code: "taken" }]) },
  { endpoint: "auth.login", name: "ok", request: { body: { email: "umit@example.test", password: "cok-guclu-sifre" } }, status: 200, body: data(me) },
  { endpoint: "auth.login", name: "invalid", request: { body: { email: "umit@example.test", password: "yanlis" } }, status: 401, body: error("INVALID_CREDENTIALS", "E-posta veya şifre hatalı.") },
  { endpoint: "auth.login", name: "banned", request: { body: { email: "umit@example.test", password: "cok-guclu-sifre" } }, status: 403, body: error("ACCOUNT_RESTRICTED", "Hesabınız askıya alındı.", [{ code: "login" }]) },
  { endpoint: "auth.logout", name: "ok", status: 204, body: null },
  { endpoint: "auth.email.verify", name: "ok", request: { body: { token: "tok_abcdefghijklmnopqrstuvwxyz" } }, status: 200, body: data({ verified: true }) },
  { endpoint: "auth.email.verify", name: "expired", request: { body: { token: "tok_abcdefghijklmnopqrstuvwxyz" } }, status: 400, body: error("TOKEN_INVALID_OR_EXPIRED", "Bağlantının süresi dolmuş.") },
  { endpoint: "auth.email.resend", name: "ok", status: 202, body: null },
  { endpoint: "auth.password.forgot", name: "ok", request: { body: { email: "kim@example.test" } }, status: 202, body: null },
  { endpoint: "auth.password.reset", name: "ok", request: { body: { token: "tok_abcdefghijklmnopqrstuvwxyz", password: "yeni-guclu-sifre" } }, status: 204, body: null },
  { endpoint: "me.get", name: "ok", status: 200, body: data(me) },
  { endpoint: "me.get", name: "guest", status: 401, body: error("UNAUTHENTICATED", "Giriş yapmanız gerekiyor.") },
  { endpoint: "me.update", name: "ok", request: { body: { bio: "Araba meraklısı" } }, status: 200, body: data({ ...me, bio: "Araba meraklısı" }) },

  // ── polls ──
  { endpoint: "polls.create", name: "poll", request: { body: createPoll }, status: 201, body: data(detail(emptyResults, authorViewer, { contentLocked: false, commentCount: 0 })) },
  { endpoint: "polls.create", name: "discussion", request: { body: { kind: "DISCUSSION", title: "Bu bütçeyle hangi arabayı almalıyım?", categoryId: CAT } }, status: 201, body: data(discussion) },
  { endpoint: "polls.create", name: "insufficient-points", request: { body: createPoll }, status: 409, body: error("INSUFFICIENT_POINTS", "Yayın için yeterli puanınız yok.", [{ code: "balance", message: "0/10" }]) },
  { endpoint: "polls.create", name: "cooldown", request: { body: createPoll }, status: 429, body: error("PUBLISH_COOLDOWN", "Yeni gönderi için biraz beklemelisiniz.") },
  { endpoint: "polls.create", name: "missing-key", request: { body: createPoll }, status: 400, body: error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key başlığı gerekli.") },
  { endpoint: "polls.create", name: "unverified", request: { body: createPoll }, status: 403, body: error("EMAIL_NOT_VERIFIED", "Önce e-postanızı doğrulayın.") },
  { endpoint: "polls.get", name: "guest-hidden", request: { params: pollParams }, status: 200, body: data(detail(hidden)) },
  { endpoint: "polls.get", name: "author-sees-results", request: { params: pollParams }, status: 200, body: data(detail(visible, authorViewer)) },
  { endpoint: "polls.get", name: "unverified-cannot-vote", request: { params: pollParams }, status: 200, body: data(detail(hidden, { ...viewer(null), canVote: false, voteBlockedReason: "EMAIL_NOT_VERIFIED" })) },
  { endpoint: "polls.get", name: "voter-visible", request: { params: pollParams }, status: 200, body: data(detail(visible, viewer(OPT_A))) },
  { endpoint: "polls.get", name: "closed-visible-to-guest", request: { params: pollParams }, status: 200, body: data(detail(visible, guestViewer, { closed: true, closedAt: T1 })) },
  { endpoint: "polls.get", name: "discussion", request: { params: { id: DISC } }, status: 200, body: data(discussion) },
  { endpoint: "polls.get", name: "not-found", request: { params: pollParams }, status: 404, body: error("NOT_FOUND", "İçerik bulunamadı.") },
  { endpoint: "polls.lookup", name: "ok", request: { query: { publicId: "ab12cd34" } }, status: 200, body: data(detail(hidden)) },
  { endpoint: "polls.update", name: "ok", request: { params: pollParams, body: { extraInfo: "Ekspertiz raporu var." } }, status: 200, body: data(detail(visible, authorViewer, { extraInfo: "Ekspertiz raporu var." })) },
  { endpoint: "polls.update", name: "locked", request: { params: pollParams, body: { title: "Başlığı sonradan değiştirmek istiyorum" } }, status: 409, body: error("POLL_CONTENT_LOCKED", "İlk oydan sonra soru, açıklama ve seçenekler değiştirilemez.") },
  { endpoint: "polls.close", name: "ok", request: { params: pollParams }, status: 200, body: data(detail(visible, authorViewer, { closed: true, closedAt: T1 })) },
  { endpoint: "polls.delete", name: "ok", request: { params: pollParams }, status: 204, body: null },
  { endpoint: "polls.addenda.create", name: "ok", request: { params: pollParams, body: { body: "Satıcı 1.200.000'e indi." } }, status: 201, body: data({ id: id(22), body: "Satıcı 1.200.000'e indi.", createdAt: T1 }) },
  { endpoint: "votes.put", name: "self-vote-forbidden", request: { params: pollParams, body: { optionId: OPT_A } }, status: 403, body: error("SELF_VOTE_FORBIDDEN", "Kendi anketinize oy veremezsiniz.") },
  { endpoint: "votes.put", name: "first-vote", request: { params: pollParams, body: { optionId: OPT_A } }, status: 201, body: data({ vote: { optionId: OPT_A, changeCount: 0, updatedAt: T1 }, results: visible }) },
  { endpoint: "votes.put", name: "same-option-retry", request: { params: pollParams, body: { optionId: OPT_A } }, status: 200, body: data({ vote: { optionId: OPT_A, changeCount: 0, updatedAt: T1 }, results: visible }) },
  { endpoint: "votes.put", name: "change", request: { params: pollParams, body: { optionId: OPT_B } }, status: 200, body: data({ vote: { optionId: OPT_B, changeCount: 1, updatedAt: T1 }, results: visible }) },
  { endpoint: "votes.put", name: "change-disabled", request: { params: pollParams, body: { optionId: OPT_B } }, status: 409, body: error("VOTE_CHANGE_DISABLED", "Oy değiştirme kapalı.") },
  { endpoint: "votes.put", name: "closed", request: { params: pollParams, body: { optionId: OPT_A } }, status: 409, body: error("POLL_CLOSED", "Anket kapandı.") },
  { endpoint: "votes.put", name: "invalidated", request: { params: pollParams, body: { optionId: OPT_A } }, status: 409, body: error("VOTE_INVALIDATED", "Bu anketteki oyunuz geçersiz sayıldı.") },
  { endpoint: "votes.put", name: "discussion", request: { params: { id: DISC }, body: { optionId: OPT_A } }, status: 409, body: error("NOT_A_POLL", "Bu gönderide oylama yok.") },
  { endpoint: "votes.put", name: "foreign-option", request: { params: pollParams, body: { optionId: id(99) } }, status: 400, body: error("VALIDATION_ERROR", "Geçersiz seçenek.", [{ field: "optionId", code: "not_in_poll" }]) },
  { endpoint: "reactions.poll.put", name: "like", request: { params: pollParams, body: { value: "LIKE" } }, status: 200, body: data({ likes: 5, dislikes: 1, viewer: "LIKE" }) },
  { endpoint: "reactions.poll.delete", name: "ok", request: { params: pollParams }, status: 200, body: data({ likes: 4, dislikes: 1, viewer: null }) },
  { endpoint: "polls.history", name: "visible", request: { params: pollParams }, status: 200, body: data({ visible: true, days: [{ localDate: "2026-09-27", pollDay: 0, total: 10, options: visible.options }] }) },
  { endpoint: "polls.history", name: "hidden", request: { params: pollParams }, status: 200, body: data({ visible: false }) },

  // ── comments ──
  { endpoint: "comments.list", name: "ok", request: { params: pollParams, query: { sort: "top" } }, status: 200, body: page([comment()], "eyJ2IjoxfQ") },
  { endpoint: "comments.list", name: "tombstone", request: { params: pollParams }, status: 200, body: page([comment({ body: null, deleted: true, author: null })]) },
  { endpoint: "comments.replies", name: "ok", request: { params: { id: COMMENT } }, status: 200, body: page([comment({ id: REPLY, parentId: COMMENT, replyCount: 0 })]) },
  { endpoint: "comments.create", name: "alternative", request: { params: pollParams, body: { body: "Bu bütçeyle 2020 model de bakılabilir.", kind: "ALTERNATIVE" } }, status: 201, body: data(comment({ kind: "ALTERNATIVE", replyCount: 0, body: "Bu bütçeyle 2020 model de bakılabilir." })) },
  { endpoint: "comments.create", name: "depth", request: { params: pollParams, body: { body: "Cevaba cevap", parentId: REPLY } }, status: 400, body: error("COMMENT_DEPTH_EXCEEDED", "Cevaplara cevap verilemez.", [{ field: "parentId", code: "depth" }]) },
  { endpoint: "comments.create", name: "disabled", request: { params: pollParams, body: { body: "Merhaba" } }, status: 409, body: error("COMMENTS_DISABLED", "Bu gönderide yorumlar kapalı.") },
  { endpoint: "comments.update", name: "ok", request: { params: { id: COMMENT }, body: { body: "Düzeltme: sol çamurluk." } }, status: 200, body: data(comment({ body: "Düzeltme: sol çamurluk.", editedAt: T1 })) },
  { endpoint: "comments.delete", name: "ok", request: { params: { id: COMMENT } }, status: 204, body: null },
  { endpoint: "reactions.comment.put", name: "dislike", request: { params: { id: COMMENT }, body: { value: "DISLIKE" } }, status: 200, body: data({ likes: 2, dislikes: 1, viewer: "DISLIKE" }) },
  { endpoint: "reactions.comment.delete", name: "ok", request: { params: { id: COMMENT } }, status: 200, body: data({ likes: 2, dislikes: 0, viewer: null }) },

  // ── discovery ──
  { endpoint: "feed.list", name: "guest", request: { query: { tab: "new", limit: "2" } }, status: 200, body: page([card(hidden), { ...card(null), id: DISC, kind: "DISCUSSION", closesAt: null }], "eyJ2IjoxLCJrIjpbXX0") },
  { endpoint: "feed.list", name: "empty", request: { query: {} }, status: 200, body: page([]) },
  { endpoint: "feed.list", name: "bad-cursor", request: { query: { cursor: "eski" } }, status: 400, body: error("INVALID_CURSOR", "Sayfa bilgisi geçersiz; baştan yükleyin.") },
  { endpoint: "search.query", name: "ok", request: { query: { q: "isik" } }, status: 200, body: page([{ type: "poll", poll: card(hidden) }]) },
  { endpoint: "search.query", name: "users", request: { query: { q: "den", type: "users" } }, status: 200, body: page([{ type: "user", user: deniz }]) },
  { endpoint: "categories.list", name: "ok", status: 200, body: data([category]) },
  { endpoint: "trends.list", name: "movers", request: { params: { format: "WEEKLY_MOVERS" } }, status: 200, body: { data: [{ rank: 1, poll: card(visible), movement: { optionId: OPT_A, fromPercent: 82, toPercent: 46, deltaPoints: -36, sampleFrom: 50, sampleTo: 42, windowFromEnd: "2026-09-19T21:00:00.000Z", windowToEnd: "2026-09-26T21:00:00.000Z" } }], page: { nextCursor: null, hasMore: false }, meta: { format: "WEEKLY_MOVERS", computedAt: T1, calculationVersion: 1, windowStart: "2026-09-12T21:00:00.000Z", windowEnd: "2026-09-26T21:00:00.000Z" } } },
  { endpoint: "trends.list", name: "insufficient-history", request: { params: { format: "WEEKLY_MOVERS" } }, status: 200, body: { data: [], page: { nextCursor: null, hasMore: false }, meta: null, reason: "INSUFFICIENT_HISTORY" } },

  // ── growth ──
  { endpoint: "profiles.get", name: "ok", request: { params: { username: "deniz" } }, status: 200, body: data({ ...deniz, bio: null, joinedAt: T0, stats: { pollCount: 3, votesReceived: 120, commentCount: 14 } }) },
  { endpoint: "profiles.polls", name: "ok", request: { params: { username: "deniz" } }, status: 200, body: page([card(hidden)]) },
  { endpoint: "profiles.comments", name: "ok", request: { params: { username: "umit" } }, status: 200, body: page([comment()]) },
  { endpoint: "bookmarks.put", name: "ok", request: { params: pollParams }, status: 200, body: data({ saved: true }) },
  { endpoint: "bookmarks.delete", name: "ok", request: { params: pollParams }, status: 200, body: data({ saved: false }) },
  { endpoint: "bookmarks.list", name: "ok", status: 200, body: page([card(hidden, { ...viewer(null), bookmarked: true })]) },
  { endpoint: "follows.put", name: "ok", request: { params: pollParams }, status: 200, body: data({ following: true }) },
  { endpoint: "follows.delete", name: "ok", request: { params: pollParams }, status: 200, body: data({ following: false }) },
  { endpoint: "decisions.get", name: "ok", request: { params: pollParams }, status: 200, body: data({ decision: null, following: false, isAuthor: false }) },
  { endpoint: "decisions.put", name: "ok", request: { params: pollParams, body: { chosenOptionId: OPT_A, note: "Pazarlıkla aldım." } }, status: 200, body: data({ pollId: POLL, chosenOptionId: OPT_A, note: "Pazarlıkla aldım.", updatedAt: T1 }) },
  { endpoint: "interests.get", name: "ok", status: 200, body: data({ categoryIds: [CAT] }) },
  { endpoint: "interests.put", name: "ok", request: { body: { categoryIds: [CAT] } }, status: 200, body: data({ categoryIds: [CAT] }) },
  { endpoint: "shares.create", name: "ok", request: { params: pollParams, body: { channel: "whatsapp" } }, status: 201, body: data({ shareId: "sh_9x2k", url: "https://kararver.test/karar/bu-araba-bu-fiyata-alinir-mi-ab12cd34?s=sh_9x2k" }) },
  { endpoint: "announcements.active", name: "ok", status: 200, body: data([announcement]) },
  { endpoint: "points.get", name: "ok", status: 200, body: data({ balance: 10, publishCost: 10 }) },
  { endpoint: "points.ledger", name: "ok", status: 200, body: page([ledger, { ...ledger, id: id(94), delta: 20, balanceAfter: 20, reason: "INITIAL_GRANT", referenceId: null, createdAt: T0 }]) },

  // ── media ──
  { endpoint: "media.uploads.create", name: "ok", request: { body: { purpose: "POLL", mimeType: "image/webp", sizeBytes: 350000 } }, status: 201, body: data({ mediaId: MEDIA, upload: { method: "PUT", url: "https://storage.kararver.test/private/u?sig=abc", headers: { "Content-Type": "image/webp" }, expiresAt: "2026-09-27T09:10:00.000Z" } }) },
  { endpoint: "media.uploads.create", name: "svg-rejected", request: { body: { purpose: "POLL", mimeType: "image/webp", sizeBytes: 350000 } }, status: 415, body: error("MEDIA_TYPE_NOT_ALLOWED", "Sadece JPEG, PNG ve WebP yüklenebilir.") },
  { endpoint: "media.uploads.create", name: "too-large", request: { body: { purpose: "POLL", mimeType: "image/jpeg", sizeBytes: 20000000 } }, status: 413, body: error("MEDIA_TOO_LARGE", "Dosya en fazla 8 MB olabilir.") },
  { endpoint: "media.complete", name: "ok", request: { params: { id: MEDIA } }, status: 202, body: data(mediaView("PENDING")) },
  { endpoint: "media.get", name: "approved", request: { params: { id: MEDIA } }, status: 200, body: data(mediaView("APPROVED", { url: mediaRef.url, preview: null })) },

  // ── moderation ──
  { endpoint: "reports.create", name: "ok", request: { body: { target: { type: "COMMENT", id: COMMENT }, reason: "SPAM" } }, status: 202, body: data({ reportId: REPORT }) },
  { endpoint: "admin.reports.list", name: "ok", status: 200, body: page([report]) },
  { endpoint: "admin.reports.resolve", name: "ok", request: { params: { id: REPORT }, body: { resolution: "ACTIONED", note: "Yorum kaldırıldı" } }, status: 200, body: data({ ...report, status: "ACTIONED", resolvedAt: T1 }) },
  { endpoint: "admin.moderation.polls", name: "hide", request: { params: pollParams, body: { action: "HIDE", reason } }, status: 200, body: data({ id: POLL, status: "HIDDEN", trendExcluded: false }) },
  { endpoint: "admin.moderation.polls", name: "out-of-scope", request: { params: pollParams, body: { action: "HIDE", reason } }, status: 403, body: error("FORBIDDEN", "Bu topluluk için yetkiniz yok.") },
  { endpoint: "admin.moderation.comments", name: "remove", request: { params: { id: COMMENT }, body: { action: "REMOVE", reason } }, status: 200, body: data({ id: COMMENT, status: "REMOVED", trendExcluded: null }) },
  { endpoint: "admin.media.list", name: "ok", status: 200, body: page([mediaView("QUARANTINED")]) },
  { endpoint: "admin.media.decide", name: "ok", request: { params: { id: MEDIA }, body: { decision: "APPROVE", reason: "Uygun içerik" } }, status: 200, body: data(mediaView("APPROVED", { url: mediaRef.url, preview: null })) },
  { endpoint: "admin.media.bans.list", name: "ok", status: 200, body: page([bannedMedia]) },
  { endpoint: "admin.media.bans.create", name: "ok", request: { body: { mediaId: MEDIA, reason: "Tekrar yüklenen uygunsuz görsel" } }, status: 201, body: data(bannedMedia) },
  { endpoint: "admin.media.bans.create", name: "zaten-yasakli", request: { body: { mediaId: MEDIA, reason: "Tekrar yüklenen uygunsuz görsel" } }, status: 200, body: data(bannedMedia) },
  { endpoint: "admin.media.bans.create", name: "reddedilmemis", request: { body: { mediaId: MEDIA, reason: "Henüz karara bağlanmadı" } }, status: 409, body: error("CONFLICT", "Yalnız reddedilmiş görsel yasaklanabilir.", [{ code: "not_rejected" }]) },
  { endpoint: "admin.media.bans.delete", name: "ok", request: { params: { id: id(51) } }, status: 204, body: null },
  { endpoint: "admin.revisions.polls", name: "ok", request: { params: pollParams }, status: 200, body: page([{ version: 1, editor: deniz, editedAt: T0, snapshot: { title: "Bu araba bu fiyata alınır mı?" } }]) },
  { endpoint: "admin.revisions.comments", name: "ok", request: { params: { id: COMMENT } }, status: 200, body: page([{ version: 1, editor: umit, editedAt: T1, snapshot: { body: "Boyalı parça fiyatı düşürür." } }]) },
  { endpoint: "admin.votes.invalidate", name: "hesaplar", request: { body: { target: { type: "ACCOUNTS", userIds: [U2], pollId: POLL }, reason: "Sahte hesap ağı doğrulandı" } }, status: 200, body: data({ changed: 1, unchanged: 0, notFound: [], affectedPollIds: [POLL] }) },
  { endpoint: "admin.votes.restore", name: "ok", request: { body: { voteIds: [VOTE], reason: "Yanlış tespit, itiraz kabul" } }, status: 200, body: data({ changed: 1, unchanged: 0, notFound: [], affectedPollIds: [POLL] }) },

  // ── communities ──
  { endpoint: "communities.list", name: "ok", status: 200, body: page([communityCard]) },
  { endpoint: "communities.get", name: "ok", request: { params: { slug: "samsun-universitesi" } }, status: 200, body: data(communityDetail) },
  { endpoint: "communities.members", name: "ok", request: { params: { id: COMM } }, status: 200, body: page([{ user: umit, role: "MEMBER", joinedAt: T1 }]) },
  { endpoint: "communities.join", name: "ok", request: { params: { id: COMM } }, status: 200, body: data({ role: "MEMBER" }) },
  { endpoint: "communities.leave", name: "ok", request: { params: { id: COMM } }, status: 204, body: null },
  { endpoint: "admin.communities.create", name: "ok", request: { body: { slug: "samsun-universitesi", name: "Samsun Üniversitesi" } }, status: 201, body: data({ ...communityDetail, memberCount: 0, viewer: null }) },
  { endpoint: "admin.communities.update", name: "ok", request: { params: { id: COMM }, body: { description: "Kampüs hayatı", reason: "Açıklama güncellendi" } }, status: 200, body: data({ ...communityDetail, description: "Kampüs hayatı", viewer: null }) },
  { endpoint: "admin.communities.moderators.put", name: "ok", request: { params: { id: COMM, userId: U2 }, body: { reason: "Aktif üye" } }, status: 200, body: data({ role: "MODERATOR" }) },
  { endpoint: "admin.communities.moderators.delete", name: "ok", request: { params: { id: COMM, userId: U2 } }, status: 204, body: null },

  // ── notifications ──
  { endpoint: "notifications.list", name: "ok", request: { query: { unreadOnly: "true" } }, status: 200, body: page([notification]) },
  { endpoint: "notifications.unreadCount", name: "ok", status: 200, body: data({ count: 3 }) },
  { endpoint: "notifications.markRead", name: "all", request: { body: { all: true } }, status: 200, body: data({ updated: 3 }) },
  { endpoint: "notifications.preferences.get", name: "ok", status: 200, body: data({ types: { COMMENT_ON_POLL: true, POLL_TRENDING: false } }) },
  { endpoint: "notifications.preferences.update", name: "ok", request: { body: { types: { POLL_TRENDING: true } } }, status: 200, body: data({ types: { COMMENT_ON_POLL: true, POLL_TRENDING: true } }) },
  { endpoint: "notifications.mutes.put", name: "ok", request: { params: { pollId: POLL } }, status: 200, body: data({ muted: true }) },
  { endpoint: "notifications.mutes.delete", name: "ok", request: { params: { pollId: POLL } }, status: 200, body: data({ muted: false }) },

  // ── admin ──
  { endpoint: "config.get", name: "ok", status: 200, body: data(publicConfig) },
  { endpoint: "admin.users.list", name: "ok", request: { query: { q: "umit" } }, status: 200, body: page([adminUser]) },
  { endpoint: "admin.users.get", name: "ok", request: { params: { id: U2 } }, status: 200, body: data({ ...adminUser, emailVerified: true, lastLoginAt: T1, stats: { pollCount: 1, commentCount: 5, voteCount: 12 }, activeSanctions: [] }) },
  { endpoint: "admin.users.sanctions", name: "ok", request: { params: { id: U2 } }, status: 200, body: page([sanction]) },
  { endpoint: "admin.users.reports", name: "against", request: { params: { id: U2 }, query: { side: "against" } }, status: 200, body: page([{ id: REPORT, target: { type: "COMMENT", id: COMMENT }, reason: "SPAM", status: "OPEN", createdAt: T1, resolvedAt: null }]) },
  { endpoint: "admin.users.activity", name: "ok", request: { params: { id: U2 } }, status: 200, body: page([{ kind: "COMMENT", id: COMMENT, pollId: POLL, excerpt: "Bence ikinci seçenek daha mantıklı.", status: "ACTIVE", createdAt: T1 }]) },
  { endpoint: "admin.sanctions.create", name: "conflict", request: { params: { id: U2 }, body: { type: "SUSPEND", reason: "Tekrarlayan spam", endsAt: T_CLOSE } }, status: 409, body: error("CONFLICT", "Bu kullanıcıda aynı tipte aktif bir yaptırım var.", [{ code: "already_active" }]) },
  { endpoint: "admin.sanctions.create", name: "suspend", request: { params: { id: U2 }, body: { type: "SUSPEND", reason: "Tekrarlayan spam", endsAt: T_CLOSE } }, status: 201, body: data(sanction) },
  { endpoint: "admin.sanctions.lift", name: "ok", request: { params: { id: U2, sanctionId: SANCTION }, body: { reason: "İtiraz kabul edildi" } }, status: 200, body: data({ ...sanction, liftedAt: T1, liftedBy: deniz, liftReason: "İtiraz kabul edildi" }) },
  { endpoint: "admin.roles.put", name: "ok", request: { params: { id: U2 }, body: { role: "MODERATOR", reason: "Topluluk moderatörü" } }, status: 200, body: data({ userId: U2, roles: ["MODERATOR"] }) },
  { endpoint: "admin.settings.list", name: "ok", status: 200, body: data([setting]) },
  { endpoint: "admin.settings.update", name: "ok", request: { params: { key: "polls.voteChangeAllowed" }, body: { value: false, version: 3, reason: "Beta kararı" } }, status: 200, body: data({ ...setting, value: false, version: 4 }) },
  { endpoint: "admin.settings.update", name: "stale", request: { params: { key: "polls.voteChangeAllowed" }, body: { value: false, version: 2, reason: "Beta kararı" } }, status: 409, body: error("VERSION_CONFLICT", "Ayar başka biri tarafından değiştirildi; yenileyin.") },
  { endpoint: "admin.emergency.put", name: "ok", request: { body: { switches: { uploads: false }, reason: "Görsel saldırısı" } }, status: 200, body: data({ ...features, uploads: false, maintenance: false }) },
  { endpoint: "admin.audit.list", name: "ok", status: 200, body: page([{ id: AUDIT, actor: deniz, source: "API", action: "user.sanction", operation: "apply", target: { type: "USER", id: U2 }, before: { status: "ACTIVE" }, after: { status: "SUSPENDED" }, reason: "Tekrarlayan spam", requestId, createdAt: T1 }]) },
  { endpoint: "admin.points.adjust", name: "ok", request: { params: { id: U2 }, body: { delta: 10, reason: "Başarısız yayın iadesi" } }, status: 201, body: data({ ...ledger, delta: 10, balanceAfter: 20, reason: "ADMIN_ADJUSTMENT", referenceId: null }) },
  { endpoint: "admin.metrics.get", name: "ok", status: 200, body: data({ range: "7d", generatedAt: T1, totals: { users: 120, polls: 40, votes: 900, comments: 210, openReports: 2 }, series: [{ localDate: "2026-09-27", activeUsers: 60, registrations: 8, polls: 5, votes: 140, comments: 30 }] }) },
  { endpoint: "admin.featured.list", name: "ok", status: 200, body: page([featured]) },
  { endpoint: "admin.featured.create", name: "ok", request: { body: { pollId: POLL, surface: "HOME_SPOTLIGHT", startsAt: T0, endsAt: T_CLOSE, reason: "Editör seçimi" } }, status: 201, body: data(featured) },
  { endpoint: "admin.featured.update", name: "ok", request: { params: { id: FEATURED }, body: { priority: 20, reason: "Öncelik arttı" } }, status: 200, body: data({ ...featured, priority: 20 }) },
  { endpoint: "admin.featured.delete", name: "ok", request: { params: { id: FEATURED } }, status: 204, body: null },
  { endpoint: "admin.announcements.list", name: "ok", status: 200, body: page([announcement]) },
  { endpoint: "admin.announcements.create", name: "ok", request: { body: { title: "Kapalı beta başladı", body: "Geri bildirimlerinizi bekliyoruz.", startsAt: T0, reason: "Beta duyurusu" } }, status: 201, body: data(announcement) },
  { endpoint: "admin.announcements.update", name: "ok", request: { params: { id: ANN }, body: { endsAt: T_CLOSE, reason: "Süre belirlendi" } }, status: 200, body: data({ ...announcement, endsAt: T_CLOSE }) },
  { endpoint: "admin.announcements.delete", name: "ok", request: { params: { id: ANN } }, status: 204, body: null },
  { endpoint: "admin.categories.list", name: "ok", status: 200, body: page([{ ...category, isActive: true, pollCount: 40 }]) },
  { endpoint: "admin.categories.create", name: "ok", request: { body: { slug: "kariyer", name: "Kariyer", reason: "Yeni kategori" } }, status: 201, body: data({ ...category, id: id(12), slug: "kariyer", name: "Kariyer", iconKey: null, sortOrder: 12, isActive: true, pollCount: 0 }) },
  { endpoint: "admin.categories.update", name: "deactivate", request: { params: { id: CAT }, body: { isActive: false, reason: "Birleştirildi" } }, status: 200, body: data({ ...category, isActive: false, pollCount: 40 }) },
];

export { hidden, visible, card, detail, communityRef };

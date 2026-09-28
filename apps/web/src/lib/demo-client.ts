import { UiError, validateDraft } from "./model.ts";
import type { Draft, Poll, ProductClient, User } from "./model.ts";
import { DemoEngagement } from "../features/social/demo-engagement.ts";
import type { CommentDraft, Reaction } from "../features/social/model.ts";
import { DemoDiscovery } from "../features/discovery/demo-discovery.ts";
import { discoverySeeds } from "../features/discovery/fixtures.ts";
import type {
  FeedTab,
  SearchType,
  TrendFormat,
} from "../features/discovery/model.ts";
type RecordPoll = Omit<Poll, "results" | "ownVote"> & {
  counts: number[];
  votes: Map<string, string>;
};
type Account = User & {
  password: string;
  granted: boolean;
  resetRequested: boolean;
};
/** Ephemeral UI simulator. No API, storage, cookie or production auth implementation. */
export class DemoClient implements ProductClient {
  private accounts = new Map<string, Account>();
  private polls: RecordPoll[];
  private userId: string | null = null;
  private failure: string | null = null;
  private engagement = new DemoEngagement();
  private discovery = new DemoDiscovery();
  private requests = new Map<string, { fingerprint: string; pollId: string }>();
  private delay: number;
  constructor(delay = 180) {
    this.delay = delay;
    for (const [name, email] of [
      ["Ümit", "umit@example.test"],
      ["Deniz", "deniz@example.test"],
    ])
      this.accounts.set(email, {
        id: email,
        name,
        email,
        verified: true,
        balance: 0,
        granted: false,
        password: "Demo12345!",
        resetRequested: false,
      });
    const base = {
      author: "Deniz",
      category: "Teknoloji",
      status: "ACTIVE" as const,
      closesAt: "2099-10-01T12:00:00Z",
      commentsEnabled: true,
      comments: [
        {
          id: "comment-1",
          author: "Ece",
          text: "Bence kullanım alışkanlıkları kararı çok değiştiriyor.",
        },
      ],
      votes: new Map<string, string>(),
    };
    this.polls = [
      {
        ...base,
        id: "calisma-sekli",
        title: "Uzaktan mı, ofisten mi daha verimli çalışıyorsun?",
        description:
          "Yol süresi, ekip iletişimi ve odaklanma. Sence hangisi ağır basıyor?",
        kind: "poll",
        options: [
          {
            id: "remote",
            label: "Uzaktan çalışma",
            image: "/images/laptop.jpg",
          },
          {
            id: "office",
            label: "Ofis çalışması",
            image: "/images/office.jpg",
          },
        ],
        counts: [68, 32],
        visibility: "after_vote",
      },
      {
        ...base,
        votes: new Map(),
        id: "tatil-rotasi",
        title: "Bir sonraki tatil için hangi rotayı seçerdin?",
        description:
          "Sahil kasabalarını keşfetmek mi, sakin bir plajda dinlenmek mi?",
        kind: "poll",
        category: "Seyahat",
        options: [
          { id: "coast", label: "Kıyı kasabası", image: "/images/coast.jpg" },
          { id: "beach", label: "Sakin bir plaj", image: "/images/beach.jpg" },
        ],
        counts: [62, 38],
        visibility: "always",
        gallery: [
          {
            id: "coast-photo",
            status: "ready",
            src: "/images/coast.jpg",
            alt: "Kıyı kasabası ve deniz manzarası",
          },
          {
            id: "beach-photo",
            status: "ready",
            src: "/images/beach.jpg",
            alt: "Sakin bir koy ve plaj",
          },
          {
            id: "pending-photo",
            status: "pending",
            alt: "İncelemedeki fotoğraf",
          },
          {
            id: "removed-photo",
            status: "removed",
            alt: "Kaldırılan fotoğraf",
          },
        ],
        price: {
          amount: "12000.00",
          currency: "TRY",
          note: "Örnek bütçe · kişi başı, 3 gece; güncel teklif değildir.",
        },
        details: [
          { label: "Süre", value: "3 gece" },
          { label: "Ulaşım", value: "Bütçeye dahil değil" },
        ],
      },
      {
        ...base,
        votes: new Map(),
        id: "ilk-bisiklet",
        title: "İlk bisikletimi alırken nelere dikkat etmeliyim?",
        description:
          "Şehir içinde kısa mesafelerde kullanacağım. Deneyimlerinizi merak ediyorum.",
        kind: "discussion",
        category: "Yaşam",
        options: [],
        counts: [],
        visibility: "always",
      },
      {
        ...base,
        votes: new Map(),
        id: "kapali-anket",
        title: "Hafta sonu için film mi kitap mı?",
        description: "Bu örnek anketin oylaması sona erdi.",
        kind: "poll",
        status: "CLOSED",
        closesAt: "2026-01-01T00:00:00Z",
        options: [
          { id: "film", label: "Film" },
          { id: "book", label: "Kitap" },
        ],
        counts: [6, 4],
        visibility: "after_vote",
      },
      {
        ...base,
        votes: new Map(),
        id: "kilitli-anket",
        title: "Şehir merkezinde bisiklet yolu yeterli mi?",
        description: "Bu örnek anket inceleme nedeniyle kilitlendi.",
        kind: "poll",
        status: "LOCKED",
        options: [
          { id: "yes", label: "Yeterli" },
          { id: "no", label: "Geliştirilmeli" },
        ],
        counts: [2, 8],
        visibility: "after_vote",
      },
    ];
    this.polls.push(...discoverySeeds());
    this.polls.forEach((poll, index) => {
      poll.createdAt = new Date(Date.UTC(2026, 8, 22, index)).toISOString();
    });
  }
  expireDiscoveryPages() {
    this.discovery.expirePages();
  }
  async getCategories(signal?: AbortSignal) {
    await this.wait("categories", signal);
    return this.discovery.categories();
  }
  async getFeed(
    tab: FeedTab,
    categoryId?: string,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    await this.wait(cursor ? "discoveryMore" : "discovery", signal);
    return this.discovery.feed(
      this.polls.map((p) => this.project(p)),
      this.userId || "guest",
      tab,
      categoryId,
      cursor,
    );
  }
  async search(
    query: string,
    type: SearchType,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    await this.wait(cursor ? "discoveryMore" : "search", signal);
    return this.discovery.search(
      this.polls.map((p) => this.project(p)),
      this.userId || "guest",
      query,
      type,
      cursor,
    );
  }
  async getTrends(
    format: TrendFormat,
    categoryId?: string,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    await this.wait(cursor ? "discoveryMore" : "trends", signal);
    return this.discovery.trends(
      this.polls.map((p) => this.project(p)),
      this.userId || "guest",
      format,
      categoryId,
      cursor,
    );
  }
  failNext(operation: string) {
    this.failure = operation;
  }
  private async wait(operation: string, signal?: AbortSignal) {
    await new Promise((resolve) => setTimeout(resolve, this.delay));
    signal?.throwIfAborted();
    if (this.failure === operation) {
      this.failure = null;
      throw new UiError(
        "INTERNAL_ERROR",
        "Bağlantı örneği: işlem tamamlanamadı. Tekrar deneyebilirsin.",
      );
    }
  }
  private account() {
    const account = [...this.accounts.values()].find(
      (u) => u.id === this.userId,
    );
    if (!account)
      throw new UiError(
        "UNAUTHENTICATED",
        "Devam etmek için giriş yapmalısın.",
      );
    return account;
  }
  private publicUser(account: Account): User {
    return {
      id: account.id,
      email: account.email,
      name: account.name,
      verified: account.verified,
      balance: account.balance,
    };
  }
  current() {
    return this.userId ? this.publicUser(this.account()) : null;
  }
  private project(p: RecordPoll): Poll {
    const { counts, votes, ...rest } = p;
    const ownVote = this.userId ? votes.get(this.userId) || null : null;
    const visible =
      p.kind === "poll" &&
      (p.visibility === "always" || Boolean(ownVote) || p.status === "CLOSED");
    const total = counts.reduce((a, b) => a + b, 0);
    return structuredClone({
      ...rest,
      commentCount: this.engagement.count(p.id, p.comments.length),
      ownVote,
      results: visible
        ? {
            visible: true,
            total,
            options: p.options.map((o, i) => ({
              id: o.id,
              votes: counts[i],
              percent: total ? Math.round((counts[i] * 1000) / total) / 10 : 0,
            })),
          }
        : { visible: false },
    });
  }
  private record(id: string) {
    const poll = this.polls.find((p) => p.id === id);
    if (!poll) throw new UiError("NOT_FOUND", "Bu içerik bulunamadı.");
    return poll;
  }
  async list() {
    await this.wait("list");
    return this.polls.map((p) => this.project(p));
  }
  async get(id: string) {
    await this.wait("get");
    return this.project(this.record(id));
  }
  async login(email: string, password: string) {
    await this.wait("login");
    const account = this.accounts.get(email.trim().toLowerCase());
    if (!account || account.password !== password)
      throw new UiError("VALIDATION_ERROR", "Demo e-posta veya şifre hatalı.");
    if (!account.verified)
      throw new UiError(
        "EMAIL_UNVERIFIED",
        "Önce demo e-postanı doğrulamalısın.",
      );
    if (!account.granted) {
      account.balance += 20;
      account.granted = true;
    }
    this.userId = account.id;
    return this.publicUser(account);
  }
  async register(name: string, email: string, password: string) {
    await this.wait("register");
    email = email.trim().toLowerCase();
    if (
      !name.trim() ||
      !/^[^\s@]+@[^\s@]+\.test$/.test(email) ||
      password.length < 8
    )
      throw new UiError(
        "VALIDATION_ERROR",
        "İsim, .test uzantılı demo e-posta ve en az 8 karakter şifre gerekli.",
      );
    if (this.accounts.has(email))
      throw new UiError("CONFLICT", "Bu demo e-posta zaten kullanılıyor.");
    this.accounts.set(email, {
      id: email,
      name: name.trim(),
      email,
      password,
      verified: false,
      balance: 0,
      granted: false,
      resetRequested: false,
    });
  }
  async verify(email: string, code: string) {
    await this.wait("verify");
    const account = this.accounts.get(email.trim().toLowerCase());
    if (!account || code !== "123456" || account.verified)
      throw new UiError(
        "INVALID_TOKEN",
        "Doğrulama kodu geçersiz veya kullanılmış.",
      );
    account.verified = true;
  }
  async requestReset(email: string) {
    await this.wait("requestReset");
    const account = this.accounts.get(email.trim().toLowerCase());
    if (account) account.resetRequested = true;
  }
  async reset(email: string, code: string, password: string) {
    await this.wait("reset");
    const account = this.accounts.get(email.trim().toLowerCase());
    if (!account?.resetRequested || code !== "123456" || password.length < 8)
      throw new UiError(
        "INVALID_TOKEN",
        "Kod geçersiz/kullanılmış veya şifre 8 karakterden kısa.",
      );
    account.password = password;
    account.resetRequested = false;
    if (this.userId === account.id) this.userId = null;
  }
  async logout() {
    await this.wait("logout");
    this.userId = null;
  }
  async create(draft: Draft, requestId: string) {
    await this.wait("create");
    const account = this.account();
    const errors = validateDraft(draft);
    if (Object.keys(errors).length)
      throw new UiError("VALIDATION_ERROR", "Alanları kontrol et.", errors);
    const key = account.id + ":" + requestId;
    const fingerprint = JSON.stringify(draft);
    const previous = this.requests.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new UiError("CONFLICT", "İstek kimliği başka bir taslağa ait.");
      return this.project(this.record(previous.pollId));
    }
    if (!account.verified)
      throw new UiError("FORBIDDEN", "E-posta doğrulaması gerekli.");
    if (account.balance < 10)
      throw new UiError(
        "INSUFFICIENT_BALANCE",
        "Yayınlamak için 10 puan gerekiyor. Taslağın korunuyor.",
      );
    const id = "karar-" + crypto.randomUUID();
    const poll: RecordPoll = {
      id,
      title: draft.title.trim(),
      description: draft.description.trim(),
      kind: draft.kind,
      category: draft.category,
      createdAt: new Date().toISOString(),
      author: account.name,
      status: "ACTIVE",
      closesAt: new Date(Date.now() + draft.hours * 3600000).toISOString(),
      options:
        draft.kind === "poll"
          ? draft.options.map((label, i) => ({
              id: `${id}-${i}`,
              label: label.trim(),
            }))
          : [],
      counts: draft.kind === "poll" ? draft.options.map(() => 0) : [],
      votes: new Map(),
      comments: [],
      commentsEnabled: draft.commentsEnabled,
      visibility: draft.visibility,
    };
    account.balance -= 10;
    this.polls.unshift(poll);
    this.requests.set(key, { fingerprint, pollId: id });
    return this.project(poll);
  }
  async vote(id: string, optionId: string) {
    await this.wait("vote");
    const account = this.account();
    const poll = this.record(id);
    if (
      poll.kind !== "poll" ||
      poll.status !== "ACTIVE" ||
      Date.parse(poll.closesAt) <= Date.now()
    )
      throw new UiError("POLL_CLOSED", "Bu ankette oy kullanılamıyor.");
    const index = poll.options.findIndex((o) => o.id === optionId);
    if (index < 0)
      throw new UiError("VALIDATION_ERROR", "Geçerli bir seçenek seçmelisin.");
    const previous = poll.votes.get(account.id);
    if (previous && previous !== optionId)
      throw new UiError("CONFLICT", "Bu örnekte oy değiştirme kapalı.");
    if (!previous) {
      poll.counts[index]++;
      poll.votes.set(account.id, optionId);
    }
    return this.project(poll);
  }
  async getEngagement(id: string, signal?: AbortSignal) {
    await this.wait("engagement", signal);
    return this.engagement.snapshot(
      this.project(this.record(id)),
      this.current(),
    );
  }
  async react(id: string, commentId: string | null, value: Reaction) {
    const actor = this.account().id;
    await this.wait("reaction");
    if (this.account().id !== actor)
      throw new UiError(
        "UNAUTHENTICATED",
        "Oturum değişti. İşlemi tekrar onayla.",
      );
    return this.engagement.react(
      this.project(this.record(id)),
      this.current()!,
      commentId,
      value,
    );
  }
  async addComment(id: string, draft: CommentDraft, requestId: string) {
    const actor = this.account().id;
    await this.wait("comment");
    if (this.account().id !== actor)
      throw new UiError(
        "UNAUTHENTICATED",
        "Oturum değişti. İşlemi tekrar onayla.",
      );
    return this.engagement.add(
      this.project(this.record(id)),
      this.current()!,
      draft,
      requestId,
    );
  }
  async editComment(id: string, commentId: string, text: string) {
    const actor = this.account().id;
    await this.wait("editComment");
    if (this.account().id !== actor)
      throw new UiError(
        "UNAUTHENTICATED",
        "Oturum değişti. İşlemi tekrar onayla.",
      );
    return this.engagement.edit(
      this.project(this.record(id)),
      this.current()!,
      commentId,
      text,
    );
  }
  async deleteComment(id: string, commentId: string) {
    const actor = this.account().id;
    await this.wait("deleteComment");
    if (this.account().id !== actor)
      throw new UiError(
        "UNAUTHENTICATED",
        "Oturum değişti. İşlemi tekrar onayla.",
      );
    return this.engagement.delete(
      this.project(this.record(id)),
      this.current()!,
      commentId,
    );
  }
}

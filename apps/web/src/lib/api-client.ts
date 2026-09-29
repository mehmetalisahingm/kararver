import { Category, Me, PollCard, PollDetail, VoteResult, dataOf, pageOf } from "@kararver/contracts";
import { HttpClient } from "./http-client.ts";
import { UiError, safeReturnTo } from "./model.ts";
import type { Draft, Poll, ProductClient, User } from "./model.ts";
import type { CommentDraft, Engagement, Reaction } from "../features/social/model.ts";

export function mapPoll(wire: ReturnType<typeof PollCard.parse> | ReturnType<typeof PollDetail.parse>): Poll {
  const detail = "options" in wire ? wire : null;
  return {
    id: wire.id, canonicalPath: detail ? safeReturnTo(detail.canonicalPath) : `/karar/${wire.id}`,
    title: wire.title, description: detail?.description ?? wire.excerpt ?? "",
    kind: wire.kind === "POLL" ? "poll" : "discussion", author: wire.author.displayName,
    category: wire.category.name, status: wire.status === "LOCKED" ? "LOCKED" : wire.closed ? "CLOSED" : "ACTIVE",
    closesAt: wire.closesAt ?? "", options: detail?.options ?? [],
    visibility: detail?.resultsVisibility === "ALWAYS" ? "always" : "after_vote",
    results: wire.results ?? { visible: false }, ownVote: wire.viewer?.vote ?? null,
    voteBlockedReason: wire.viewer?.voteBlockedReason ?? null,
    canVote: wire.viewer?.canVote, commentsEnabled: detail?.allowComments ?? false, comments: [],
  };
}
export class ApiClient implements ProductClient {
  protected http: HttpClient;
  private user: User | null = null;
  private listeners = new Set<() => void>();
  constructor(baseUrl: string, fetcher?: typeof fetch) {
    this.http = new HttpClient(baseUrl, fetcher);
    this.http.onUnauthorized = () => this.setUser(null);
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private setUser(user: User | null) { if (this.user === user) return user; this.user = user; this.listeners.forEach((listener) => listener()); return user; }
  current() { return this.user; }
  private acceptUser(value: unknown) {
    const { data } = dataOf(Me).parse(value);
    return this.setUser({ id: data.id, name: data.displayName, email: data.email, verified: data.emailVerified, balance: null })!;
  }
  async restore() {
    try { return this.acceptUser(await this.http.request("me.get")); }
    catch (error) { if (error instanceof UiError && error.code === "UNAUTHENTICATED") return this.setUser(null); throw error; }
  }
  async login(email: string, password: string) { return this.acceptUser(await this.http.request("auth.login", { body: { email, password } })); }
  async register(name: string, email: string, password: string, username?: string) {
    await this.http.request("auth.register", { body: { displayName: name, email, password, username } });
  }
  async verify(_email: string, token: string) { await this.http.request("auth.email.verify", { body: { token } }); if (this.user) await this.restore(); }
  async resendVerification() { await this.http.request("auth.email.resend"); }
  async requestReset(email: string) { await this.http.request("auth.password.forgot", { body: { email } }); }
  async reset(_email: string, token: string, password: string) { await this.http.request("auth.password.reset", { body: { token, password } }); this.setUser(null); }
  async logout() {
    try { await this.http.request("auth.logout"); }
    catch (error) { if (!(error instanceof UiError && error.code === "UNAUTHENTICATED")) throw error; }
    this.setUser(null);
  }
  async list() { return pageOf(PollCard).parse(await this.http.request("feed.list")).data.map(mapPoll); }
  async get(id: string) {
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
    // KV-10 generates eight alphanumeric public IDs; legacy demo slugs never reach the API.
    const publicId = id.match(/-([A-Za-z0-9]{8})$/)?.[1];
    if (!uuid && !publicId) throw new UiError("NOT_FOUND", "İçerik bağlantısı geçersiz.");
    return mapPoll(dataOf(PollDetail).parse(await this.http.request(uuid ? "polls.get" : "polls.lookup", uuid ? { params: { id } } : { query: { publicId } })).data);
  }
  async publicationCategories() { return dataOf(Category.array()).parse(await this.http.request("categories.list")).data; }
  async create(draft: Draft, key: string) {
    const common = { title: draft.title.trim(), description: draft.description.trim(), categoryId: draft.categoryId, allowComments: draft.commentsEnabled };
    const body = draft.kind === "discussion" ? { ...common, kind: "DISCUSSION" } : {
      ...common, kind: "POLL", durationHours: draft.hours, resultsVisibility: draft.visibility === "always" ? "ALWAYS" : "AFTER_VOTE",
      options: draft.options.map((label) => ({ label: label.trim() })),
    };
    return mapPoll(dataOf(PollDetail).parse(await this.http.request("polls.create", { body, key })).data);
  }
  async vote(id: string, optionId: string) {
    const poll = await this.get(id);
    const { data } = dataOf(VoteResult).parse(await this.http.request("votes.put", { params: { id: poll.id }, body: { optionId } }));
    return { ...poll, ownVote: data.vote.optionId, results: data.results };
  }
  private socialUnavailable(): never {
    throw new UiError("INTERNAL_ERROR", "Sosyal etkileşimlerin gerçek API entegrasyonu henüz hazır değil.");
  }
  async getEngagement(_pollId: string, _signal?: AbortSignal): Promise<Engagement> {
    return this.socialUnavailable();
  }
  async react(_pollId: string, _commentId: string | null, _value: Reaction): Promise<Engagement> {
    return this.socialUnavailable();
  }
  async addComment(_pollId: string, _draft: CommentDraft, _requestId: string): Promise<Engagement> {
    return this.socialUnavailable();
  }
  async editComment(_pollId: string, _commentId: string, _text: string): Promise<Engagement> {
    return this.socialUnavailable();
  }
  async deleteComment(_pollId: string, _commentId: string): Promise<Engagement> {
    return this.socialUnavailable();
  }
}

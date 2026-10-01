import { Category, CommunityCard, Me, PollCard, PollDetail, VoteResult, SearchResult as WireSearchResult, TrendPage as WireTrendPage, dataOf, pageOf } from "@kararver/contracts";
import { HttpClient } from "./http-client.ts";
import { UiError, safeReturnTo } from "./model.ts";
import type { Draft, Poll, ProductClient, User } from "./model.ts";
import { ApiEngagement } from "../features/social/api-engagement.ts";
import type { CommentDraft, Reaction } from "../features/social/model.ts";
import type { FeedTab, SearchType, SearchResult, TrendFormat, TrendPage } from "../features/discovery/model.ts";

export function mapPoll(wire: ReturnType<typeof PollCard.parse> | ReturnType<typeof PollDetail.parse>): Poll {
  const detail = "options" in wire ? wire : null;
  return {
    id: wire.id, canonicalPath: detail ? safeReturnTo(detail.canonicalPath) : `/karar/${wire.id}`,
    title: wire.title, description: detail?.description ?? wire.excerpt ?? "",
    kind: wire.kind === "POLL" ? "poll" : "discussion", author: wire.author.displayName,
    category: wire.category.name, status: wire.status === "LOCKED" ? "LOCKED" : wire.closed ? "CLOSED" : "ACTIVE",
    createdAt: wire.createdAt,
    closesAt: wire.closesAt ?? "", options: detail?.options ?? [],
    visibility: detail?.resultsVisibility === "ALWAYS" ? "always" : "after_vote",
    results: wire.results ?? { visible: false }, ownVote: wire.viewer?.vote ?? null,
    voteBlockedReason: wire.viewer?.voteBlockedReason ?? null,
    commentCount: wire.commentCount,
    gallery: (detail?.media ?? (wire.coverImage ? [wire.coverImage] : [])).map(m => ({id:m.id,status:"ready",src:m.url,alt:wire.title})),
    details: detail?.extraInfo ? [{label:"Ek bilgi",value:detail.extraInfo}] : [],
    price: detail?.price ? {...detail.price,note:""} : undefined,
    canVote: wire.viewer?.canVote, commentsEnabled: detail?.allowComments ?? false, comments: [],
  };
}
export class ApiClient implements ProductClient {
  private social: ApiEngagement;
  protected http: HttpClient;
  private user: User | null = null;
  private listeners = new Set<() => void>();
  constructor(baseUrl: string, fetcher?: typeof fetch) {
    this.http = new HttpClient(baseUrl, fetcher);
    this.social = new ApiEngagement(this.http);
    this.http.onUnauthorized = () => this.setUser(null);
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private setUser(user: User | null) { if (this.user === user) return user; this.social.clear(); this.user = user; this.listeners.forEach((listener) => listener()); return user; }
  getEngagement(id: string, signal?: AbortSignal) { return this.social.getEngagement(id,signal); }
  loadMoreEngagement(id: string) { return this.social.loadMoreEngagement(id); }
  react(id: string, commentId: string | null, value: Reaction) { return this.social.react(id,commentId,value); }
  addComment(id: string, draft: CommentDraft, key: string) { return this.social.addComment(id,draft,key); }
  editComment(id: string, commentId: string, text: string) { return this.social.editComment(id,commentId,text); }
  deleteComment(id: string, commentId: string) { return this.social.deleteComment(id,commentId); }
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
  async interests() {
    const response = await this.http.request("interests.get") as { data: { categoryIds: string[] } };
    return response.data.categoryIds;
  }
  async saveInterests(categoryIds: string[]) {
    const response = await this.http.request("interests.put", { body: { categoryIds } }) as { data: { categoryIds: string[] } };
    return response.data.categoryIds;
  }
  async onboardingCommunities(limit = 3) {
    return pageOf(CommunityCard).parse(await this.http.request("communities.list", { query: { limit: String(limit) } })).data;
  }
  async getCategories(signal?: AbortSignal) {
    return dataOf(Category.array()).parse(await this.http.request("categories.list",{signal})).data.map(c=>({...c,description:c.description??""}));
  }
  async getFeed(tab: FeedTab, categoryId?: string, cursor?: string, signal?: AbortSignal) {
    const page=pageOf(PollCard).parse(await this.http.request("feed.list",{query:{tab,categoryId,cursor},signal}));
    return {...page,data:page.data.map(mapPoll)};
  }
  async search(q: string, type: SearchType, cursor?: string, signal?: AbortSignal) {
    const page=pageOf(WireSearchResult).parse(await this.http.request("search.query",{query:{q,type,cursor},signal}));
    const data: SearchResult[]=page.data.map(item=>item.type==="poll"?{type:"poll",poll:mapPoll(item.poll)}:item.type==="category"?{type:"category",category:{...item.category,description:item.category.description??""}}:item);
    return {...page,data};
  }
  async getTrends(format: TrendFormat, categoryId?: string, cursor?: string, signal?: AbortSignal): Promise<TrendPage> {
    const page=WireTrendPage.parse(await this.http.request("trends.list",{params:{format},query:{categoryId,cursor},signal}));
    // Card payloads intentionally omit option labels. Hydrate only displayed trend
    // cards using viewer-aware detail requests, never reconstruct hidden results.
    const data=await Promise.all(page.data.map(async item=>{
      const detail=dataOf(PollDetail).parse(await this.http.request("polls.get",{params:{id:item.poll.id},signal})).data;
      const poll=mapPoll(detail);
      poll.results=poll.results.visible && item.poll.results?.visible ? item.poll.results : {visible:false};
      const movement=format==="WEEKLY_MOVERS" && poll.results.visible && (detail.resultsVisibility==="ALWAYS" || detail.closed) ? item.movement : null;
      return {rank:item.rank,poll,movement};
    }));
    return {...page,data};
  }
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
}

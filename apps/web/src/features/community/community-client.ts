// Kullanıcı tarafı topluluk istemcisi (KV-31) ve rapor gönderme (KV-24). Her çağrı sözleşme şemasıyla doğrulanır
// (HttpClient). Üye listesi görünürlüğü ve topluluk kapsamı sunucudadır; yetkisiz izleyici 404 alır ve ekran
// "bu liste sana açık değil" durumuna düşer.
import type { CommunityCard, CommunityDetail, CommunityMember, CommunityRequestView, ReportReason } from "@kararver/contracts";
import type { HttpClient } from "../../lib/http-client.ts";
import type { Poll } from "../../lib/model.ts";

export type CommunityRequestItem = ReturnType<typeof CommunityRequestView.parse>;
export type CommunityRequestPayload = { name: string; slug: string; description?: string; categoryId?: string };
export type CommunitySummary = ReturnType<typeof CommunityCard.parse>;
export type CommunityPage = ReturnType<typeof CommunityDetail.parse>;
export type Member = ReturnType<typeof CommunityMember.parse>;
export type Paged<T> = { items: T[]; next: string | null };
export type ReportTarget = { type: "POLL" | "COMMENT"; id: string };
export type ReportReasonId = ReturnType<typeof ReportReason.parse>;

type Wire<T> = { data: T[]; page: { nextCursor: string | null } };
const paged = <T>(wire: unknown): Paged<T> => {
  const { data, page } = wire as Wire<T>;
  return { items: data, next: page.nextCursor };
};

export class CommunityClient {
  private http: HttpClient;
  private mapPoll: (wire: never) => Poll;
  constructor(http: HttpClient, mapPoll: (wire: never) => Poll) {
    this.http = http;
    this.mapPoll = mapPoll;
  }

  async categories() { return (await this.http.request("categories.list") as { data: { id: string; name: string }[] }).data; }
  async createRequest(body: CommunityRequestPayload) {
    return (await this.http.request("communities.requests.create", { body }) as { data: CommunityRequestItem }).data;
  }
  async myRequests() {
    return (await this.http.request("communities.requests.mine") as { data: CommunityRequestItem[] }).data;
  }
  async list(cursor?: string, signal?: AbortSignal) {
    return paged<CommunitySummary>(await this.http.request("communities.list", { query: { cursor, limit: "20" }, signal }));
  }
  async get(slug: string, signal?: AbortSignal) {
    return (await this.http.request("communities.get", { params: { slug }, signal }) as { data: CommunityPage }).data;
  }
  async members(id: string, cursor?: string, signal?: AbortSignal) {
    return paged<Member>(await this.http.request("communities.members", { params: { id }, query: { cursor, limit: "20" }, signal }));
  }
  async join(id: string) {
    return (await this.http.request("communities.join", { params: { id } }) as { data: { role: "MEMBER" | "MODERATOR" } }).data.role;
  }
  async leave(id: string) {
    await this.http.request("communities.leave", { params: { id } });
  }
  /** Topluluğun akışı: GET /feed?communityId= (sunucu yalnız o topluluğun görünür gönderilerini döner). */
  async feed(communityId: string, cursor?: string, signal?: AbortSignal) {
    const page = (await this.http.request("feed.list", { query: { tab: "new", communityId, cursor, limit: "10" }, signal })) as { data: never[]; page: { nextCursor: string | null } };
    return { items: page.data.map(this.mapPoll), next: page.page.nextCursor } satisfies Paged<Poll>;
  }
}

export class ReportClient {
  private http: HttpClient;
  constructor(http: HttpClient) {
    this.http = http;
  }
  /** 202: rapor kuyruğa alındı. Aynı içerik için tekrar gönderim aynı rapor kimliğini döner (çift sayılmaz). */
  async create(target: ReportTarget, reason: ReportReasonId, note: string) {
    const body = { target, reason, ...(note.trim() ? { note: note.trim() } : {}) };
    return (await this.http.request("reports.create", { body }) as { data: { reportId: string } }).data.reportId;
  }
}

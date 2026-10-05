// Yönetim ekranlarının API istemcisi (KV-14, KV-24, KV-32, KV-37, KV-38, KV-41). Her çağrı sözleşme endpoint'ine gider ve
// cevap sözleşme şemasıyla doğrulanır (HttpClient). Yetki sunucudadır: istemci rol kontrolü yalnız menü/düğme
// gizlemedir, ret 403 olarak gelir ve ekranda gösterilir.
import type { AdminCategory, BannedMediaView, CommunityCard, CommunityDetail, MediaView, ReportView } from "@kararver/contracts";
import type { HttpClient } from "../../lib/http-client.ts";

export type Report = ReturnType<typeof ReportView.parse>;
export type AdminMedia = ReturnType<typeof MediaView.parse>;
export type BannedMedia = ReturnType<typeof BannedMediaView.parse>;
export type Community = ReturnType<typeof CommunityCard.parse>;
export type CommunityDetailView = ReturnType<typeof CommunityDetail.parse>;
export type Category = ReturnType<typeof AdminCategory.parse>;

export type Page<T> = { items: T[]; next: string | null };
type Wire<T> = { data: T[]; page: { nextCursor: string | null } };

export type ReportStatus = "OPEN" | "ACTIONED" | "DISMISSED";
export type ReportTargetType = "POLL" | "COMMENT" | "MEDIA" | "USER";
export type MediaQueueStatus = "QUARANTINED" | "PENDING" | "REJECTED";
export type ContentKind = "polls" | "comments";
export type ModerationAction = "HIDE" | "RESTORE" | "LOCK" | "UNLOCK" | "REMOVE" | "EXCLUDE_FROM_TRENDS" | "INCLUDE_IN_TRENDS";
export type ModerationOutcome = { id: string; status: string; trendExcluded: boolean | null };
export type CommunityInput = { slug: string; name: string; description?: string; membersVisibility: "PUBLIC" | "MEMBERS" | "MODERATORS" };
export type CommunityPatch = Partial<CommunityInput> & { status?: "ACTIVE" | "HIDDEN" };
export type CategoryInput = {
  slug: string;
  name: string;
  description?: string | null;
  iconKey?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};
export type CategoryPatch = Partial<CategoryInput>;

const page = <T>(wire: unknown): Page<T> => {
  const { data, page: info } = wire as Wire<T>;
  return { items: data, next: info.nextCursor };
};
const data = <T>(wire: unknown) => (wire as { data: T }).data;

export class AdminClient {
  private http: HttpClient;
  constructor(http: HttpClient) {
    this.http = http;
  }

  // ── Rapor kuyruğu (KV-24) ──
  async reports(query: { status: ReportStatus; targetType?: ReportTargetType; cursor?: string }, signal?: AbortSignal) {
    return page<Report>(await this.http.request("admin.reports.list", { query: { status: query.status, targetType: query.targetType, cursor: query.cursor, limit: "20" }, signal }));
  }
  async resolveReport(id: string, resolution: "ACTIONED" | "DISMISSED", note: string) {
    return data<Report>(await this.http.request("admin.reports.resolve", { params: { id }, body: { resolution, note } }));
  }

  // ── İçerik moderasyonu (KV-37) ──
  async moderate(kind: ContentKind, id: string, action: ModerationAction, reason: string) {
    return data<ModerationOutcome>(await this.http.request(`admin.moderation.${kind}`, { params: { id }, body: { action, reason } }));
  }

  // ── Görsel inceleme ve yasak listesi (KV-16, KV-38) ──
  async media(query: { status: MediaQueueStatus; cursor?: string }, signal?: AbortSignal) {
    return page<AdminMedia>(await this.http.request("admin.media.list", { query: { status: query.status, cursor: query.cursor, limit: "20" }, signal }));
  }
  async decideMedia(id: string, decision: "APPROVE" | "REJECT", reason: string) {
    return data<AdminMedia>(await this.http.request("admin.media.decide", { params: { id }, body: { decision, reason } }));
  }
  async bans(cursor?: string, signal?: AbortSignal) {
    return page<BannedMedia>(await this.http.request("admin.media.bans.list", { query: { cursor, limit: "20" }, signal }));
  }
  async banMedia(mediaId: string, reason: string) {
    return data<BannedMedia>(await this.http.request("admin.media.bans.create", { body: { mediaId, reason } }));
  }
  async unban(id: string) {
    await this.http.request("admin.media.bans.delete", { params: { id } });
  }

  // ── Topluluk yönetimi (KV-32) ──
  async communities(cursor?: string, signal?: AbortSignal) {
    return page<Community>(await this.http.request("communities.list", { query: { cursor, limit: "20" }, signal }));
  }
  async createCommunity(input: CommunityInput, key: string) {
    return data<CommunityDetailView>(await this.http.request("admin.communities.create", { body: input, key }));
  }
  async updateCommunity(id: string, patch: CommunityPatch, reason: string) {
    return data<CommunityDetailView>(await this.http.request("admin.communities.update", { params: { id }, body: { ...patch, reason } }));
  }
  async assignModerator(id: string, userId: string, reason: string) {
    await this.http.request("admin.communities.moderators.put", { params: { id, userId }, body: { reason } });
  }
  async removeModerator(id: string, userId: string) {
    await this.http.request("admin.communities.moderators.delete", { params: { id, userId } });
  }

  // ── Kategori yönetimi (KV-41) ──
  async categories(cursor?: string, signal?: AbortSignal) {
    return page<Category>(await this.http.request("admin.categories.list", { query: { cursor, limit: "20" }, signal }));
  }
  async createCategory(input: CategoryInput, reason: string, key: string) {
    return data<Category>(await this.http.request("admin.categories.create", { body: { ...input, reason }, key }));
  }
  async updateCategory(id: string, patch: CategoryPatch, reason: string) {
    return data<Category>(await this.http.request("admin.categories.update", { params: { id }, body: { ...patch, reason } }));
  }
}
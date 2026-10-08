// Yönetim ekranlarının API istemcisi (KV-14, KV-24, KV-32, KV-37, KV-38, KV-41). Her çağrı sözleşme endpoint'ine gider ve
// cevap sözleşme şemasıyla doğrulanır (HttpClient). Yetki sunucudadır: istemci rol kontrolü yalnız menü/düğme
// gizlemedir, ret 403 olarak gelir ve ekranda gösterilir.
import type {
  AdminCategory,
  AdminCommentItem,
  AdminPollItem,
  Announcement,
  BannedMediaView,
  FeaturedPlacement,
  Category as PublicCategory,
  CommunityCard,
  CommunityDetail,
  ContentHistoryItem,
  MediaView,
  ReportView,
  Setting,
} from "@kararver/contracts";
import type { HttpClient } from "../../lib/http-client.ts";

export type Report = ReturnType<typeof ReportView.parse>;
export type AdminMedia = ReturnType<typeof MediaView.parse>;
export type BannedMedia = ReturnType<typeof BannedMediaView.parse>;
export type Community = ReturnType<typeof CommunityCard.parse>;
export type CommunityDetailView = ReturnType<typeof CommunityDetail.parse>;
export type Category = ReturnType<typeof AdminCategory.parse>;
export type PollCategory = ReturnType<typeof PublicCategory.parse>;
export type AdminPoll = ReturnType<typeof AdminPollItem.parse>;
export type AdminComment = ReturnType<typeof AdminCommentItem.parse>;
export type HistoryItem = ReturnType<typeof ContentHistoryItem.parse>;
export type Featured = ReturnType<typeof FeaturedPlacement.parse>;
export type SettingView = ReturnType<typeof Setting.parse>;
export type EmergencyState = { registration: boolean; pollCreation: boolean; comments: boolean; uploads: boolean; maintenance: boolean };
export type AnnouncementView = ReturnType<typeof Announcement.parse>;

export type Page<T> = { items: T[]; next: string | null };
type Wire<T> = { data: T[]; page: { nextCursor: string | null } };

export type ReportStatus = "OPEN" | "ACTIONED" | "DISMISSED";
export type ReportTargetType = "POLL" | "COMMENT" | "MEDIA" | "USER";
export type MediaQueueStatus = "QUARANTINED" | "PENDING" | "REJECTED";
export type ContentKind = "polls" | "comments";
export type ModerationAction =
  | "HIDE"
  | "RESTORE"
  | "LOCK"
  | "UNLOCK"
  | "REMOVE"
  | "EXCLUDE_FROM_TRENDS"
  | "INCLUDE_IN_TRENDS"
  | "CLOSE_COMMENTS"
  | "OPEN_COMMENTS";
export type ModerationOutcome = { id: string; status: string; trendExcluded: boolean | null; commentsClosed: boolean | null };
export type ContentStatus = "ACTIVE" | "HIDDEN" | "UNDER_REVIEW" | "LOCKED" | "REMOVED";
export type PollSearch = { q?: string; status?: ContentStatus; communityId?: string; categoryId?: string; reported?: boolean; trendExcluded?: boolean };
export type CommentSearch = { q?: string; status?: ContentStatus; communityId?: string; pollId?: string; reported?: boolean };
/** categoryId / communityId: yalnız verilen alan değişir; communityId null topluluktan çıkarır (yalnız yönetici). */
export type PollPlacement = { categoryId?: string; communityId?: string | null };
export type StrongSanction = "RESTRICT_COMMENTS" | "RESTRICT_POSTING" | "SUSPEND" | "BAN";
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
export type FeaturedInput = {
  pollId: string;
  surface: "HOME_SPOTLIGHT" | "FEED_TOP" | "DAILY_PICK" | "CATEGORY" | "COMMUNITY" | "EDITORS_CHOICE";
  scopeId: string | null;
  priority: number;
  badge: string | null;
  startsAt: string;
  endsAt: string;
};
export type AnnouncementInput = {
  title: string;
  body: string;
  level: "INFO" | "WARNING";
  audience: "ALL" | "AUTHENTICATED";
  startsAt: string;
  endsAt: string | null;
};

const page = <T>(wire: unknown): Page<T> => {
  const { data, page: info } = wire as Wire<T>;
  return { items: data, next: info.nextCursor };
};
const data = <T>(wire: unknown) => (wire as { data: T }).data;
/** Boolean süzgeç sorgusu: yalnız verilen değer gönderilir ("true" | "false"). */
const flag = (value: boolean | undefined) => (value === undefined ? undefined : String(value));

export class AdminClient {
  private http: HttpClient;
  constructor(http: HttpClient) {
    this.http = http;
  }

  // ── Rapor kuyruğu (KV-24) ──
  async reports(query: { status: ReportStatus; targetType?: ReportTargetType; communityId?: string; cursor?: string }, signal?: AbortSignal) {
    return page<Report>(await this.http.request("admin.reports.list", { query: { status: query.status, targetType: query.targetType, communityId: query.communityId, cursor: query.cursor, limit: "20" }, signal }));
  }
  async resolveReport(id: string, resolution: "ACTIONED" | "DISMISSED", note: string) {
    return data<Report>(await this.http.request("admin.reports.resolve", { params: { id }, body: { resolution, note } }));
  }

  /** Kuyruktan içerik sahibini uyar (WARNING); hedefin açık raporlarını kapatır. */
  async warn(reportId: string, reason: string) {
    return data<{ sanctionId: string; userId: string; closedReports: number }>(await this.http.request("admin.reports.warn", { params: { id: reportId }, body: { reason } }));
  }
  /** Sert yaptırım (yalnız yönetici): reportId ile rapora ve moderasyon geçmişine bağlanır. SUSPEND için endsAt gerekir. */
  async sanction(userId: string, type: StrongSanction, reason: string, reportId: string, endsAt: string | null) {
    return data<{ id: string }>(await this.http.request("admin.sanctions.create", { params: { id: userId }, body: { type, reason, endsAt, reportId } }));
  }

  // ── İçerik moderasyonu (KV-37) ──
  async moderate(kind: ContentKind, id: string, action: ModerationAction, reason: string) {
    return data<ModerationOutcome>(await this.http.request(`admin.moderation.${kind}`, { params: { id }, body: { action, reason } }));
  }
  async polls(search: PollSearch, cursor?: string, signal?: AbortSignal) {
    const query = { ...search, reported: flag(search.reported), trendExcluded: flag(search.trendExcluded), cursor, limit: "20" };
    return page<AdminPoll>(await this.http.request("admin.content.polls", { query, signal }));
  }
  async comments(search: CommentSearch, cursor?: string, signal?: AbortSignal) {
    const query = { ...search, reported: flag(search.reported), cursor, limit: "20" };
    return page<AdminComment>(await this.http.request("admin.content.comments", { query, signal }));
  }
  async history(kind: ContentKind, id: string, cursor?: string, signal?: AbortSignal) {
    return page<HistoryItem>(await this.http.request(`admin.moderation.history.${kind}`, { params: { id }, query: { cursor, limit: "20" }, signal }));
  }
  async movePoll(id: string, placement: PollPlacement, reason: string) {
    return data<AdminPoll>(await this.http.request("admin.moderation.polls.move", { params: { id }, body: { ...placement, reason } }));
  }
  /** Taşıma penceresindeki kategori seçenekleri: aktif kategoriler (public; yönetici listesi yalnız admin'e açık). */
  async pollCategories(signal?: AbortSignal) {
    return data<PollCategory[]>(await this.http.request("categories.list", { signal }));
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

  // ── Öne çıkarma ve duyurular (KV-42) ──
  async featured(cursor?: string, signal?: AbortSignal) {
    return page<Featured>(await this.http.request("admin.featured.list", { query: { cursor, limit: "20" }, signal }));
  }
  async createFeatured(input: FeaturedInput, reason: string, key: string) {
    return data<Featured>(await this.http.request("admin.featured.create", { body: { ...input, reason }, key }));
  }
  async updateFeatured(id: string, patch: Partial<FeaturedInput>, reason: string) {
    return data<Featured>(await this.http.request("admin.featured.update", { params: { id }, body: { ...patch, reason } }));
  }
  async deleteFeatured(id: string) {
    await this.http.request("admin.featured.delete", { params: { id } });
  }

  async announcements(cursor?: string, signal?: AbortSignal) {
    return page<AnnouncementView>(await this.http.request("admin.announcements.list", { query: { cursor, limit: "20" }, signal }));
  }
  async createAnnouncement(input: AnnouncementInput, reason: string, key: string) {
    return data<AnnouncementView>(await this.http.request("admin.announcements.create", { body: { ...input, reason }, key }));
  }
  async updateAnnouncement(id: string, patch: Partial<AnnouncementInput>, reason: string) {
    return data<AnnouncementView>(await this.http.request("admin.announcements.update", { params: { id }, body: { ...patch, reason } }));
  }
  async deleteAnnouncement(id: string) {
    await this.http.request("admin.announcements.delete", { params: { id } });
  }

  // ── Sistem ayarları ve acil durum (KV-40) ──
  /** Bütün ayarlar (sayfalanmaz); satırı olmayan ayar sürüm 1 ve varsayılanla gelir. */
  async settings(signal?: AbortSignal) {
    return data<SettingView[]>(await this.http.request("admin.settings.list", { signal }));
  }
  /** version: listede görülen sürüm (iyimser kilit); eski ise VERSION_CONFLICT. Yalnız SUPER_ADMIN. */
  async updateSetting(key: string, value: unknown, version: number, reason: string) {
    return data<SettingView>(await this.http.request("admin.settings.update", { params: { key }, body: { value, version, reason } }));
  }
  /** Yalnız SUPER_ADMIN. Gönderilmeyen anahtar değişmez; yanıt bütün anahtarların güncel durumudur. */
  async putEmergency(switches: Partial<EmergencyState>, reason: string) {
    return data<EmergencyState>(await this.http.request("admin.emergency.put", { body: { switches, reason } }));
  }
}

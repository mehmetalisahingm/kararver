import type { IdempotencyScope, IdempotentResult } from "../../http/idempotency.ts";

export type FeaturedSurface =
  | "HOME_SPOTLIGHT"
  | "FEED_TOP"
  | "DAILY_PICK"
  | "CATEGORY"
  | "COMMUNITY"
  | "EDITORS_CHOICE";

export type FeaturedRow = {
  id: string;
  pollId: string;
  surface: FeaturedSurface;
  scopeId: string | null;
  priority: number;
  badge: string | null;
  startsAt: Date;
  endsAt: Date;
  /** One-time activation marker; internal, not exposed to public response. */
  activatedAt?: Date | null;
  createdAt: Date;
};

export type AnnouncementAudience = "ALL" | "AUTHENTICATED";
export type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  level: "INFO" | "WARNING";
  audience: AnnouncementAudience;
  startsAt: Date;
  endsAt: Date | null;
  /** One-time publication marker, null for future schedules. */
  activatedAt?: Date | null;
  createdAt: Date;
};

export type FeaturedInput = Omit<FeaturedRow, "id" | "createdAt">;
export type AnnouncementInput = Omit<AnnouncementRow, "id" | "createdAt">;
export type Page = { after: { keys: (string | number)[]; id: string } | null; limit: number };
export type AdminTrail = { actorId: string; requestId: string | null; now: Date; reason: string | null };

export type FeaturedCreateResult = IdempotentResult | { kind: "rejected"; reason: "POLL_NOT_AVAILABLE" };
export type AnnouncementCreateResult = IdempotentResult;

export interface FeaturedAdminStore {
  listFeatured(page: Page): Promise<FeaturedRow[]>;
  activeFeatured(surface: FeaturedSurface, scopeId: string | null, now: Date): Promise<FeaturedRow[]>;
  getFeatured(id: string): Promise<FeaturedRow | null>;
  createFeatured(scope: IdempotencyScope | null, input: FeaturedInput, trail: AdminTrail): Promise<FeaturedCreateResult>;
  updateFeatured(id: string, patch: Partial<FeaturedInput>, trail: AdminTrail): Promise<"OK" | "NOT_FOUND" | "POLL_NOT_AVAILABLE">;
  deleteFeatured(id: string, trail: AdminTrail): Promise<boolean>;

  listAnnouncements(page: Page): Promise<AnnouncementRow[]>;
  activeAnnouncements(now: Date, authenticated: boolean): Promise<AnnouncementRow[]>;
  getAnnouncement(id: string): Promise<AnnouncementRow | null>;
  createAnnouncement(scope: IdempotencyScope | null, input: AnnouncementInput, trail: AdminTrail): Promise<AnnouncementCreateResult>;
  updateAnnouncement(id: string, patch: Partial<AnnouncementInput>, trail: AdminTrail): Promise<"OK" | "NOT_FOUND">;
  deleteAnnouncement(id: string, trail: AdminTrail): Promise<boolean>;
}

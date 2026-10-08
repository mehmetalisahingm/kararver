import { PollCard } from "@kararver/contracts";
import { ApiError } from "../../http/errors.ts";
import { decodeCursor, encodeCursor } from "../../http/cursor.ts";
import { idempotencyKeyReused, readIdempotencyScope } from "../../http/idempotency.ts";
import type { Route } from "../../http/route.ts";
import type { PollSettings, PollStore } from "../polls/store.ts";
import { toPollDetail } from "../polls/view.ts";
import type {
  AnnouncementInput,
  AnnouncementRow,
  FeaturedAdminStore,
  FeaturedInput,
  FeaturedRow,
  FeaturedSurface,
} from "./store.ts";

export type FeaturedAdminDeps = {
  store: FeaturedAdminStore;
  now: () => Date;
  polls?: { store: PollStore; settings: () => Promise<PollSettings>; mediaPublicBaseUrl: string };
};

const featured = (row: FeaturedRow) => ({
  id: row.id,
  pollId: row.pollId,
  surface: row.surface,
  scopeId: row.scopeId,
  priority: row.priority,
  badge: row.badge,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
});

const CARD_KEYS = Object.keys(PollCard.shape) as (keyof typeof PollCard.shape)[];

const announcement = (row: AnnouncementRow) => ({
  id: row.id,
  title: row.title,
  body: row.body,
  level: row.level,
  audience: row.audience,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt?.toISOString() ?? null,
});

function date(value: string | undefined, field: string): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ApiError("VALIDATION_ERROR", `${field} geçersiz.`);
  return parsed;
}

function validateFeatured(input: Partial<FeaturedInput> & { surface?: FeaturedSurface }, current?: FeaturedRow) {
  const surface = input.surface ?? current?.surface;
  const scopeId = input.scopeId !== undefined ? input.scopeId : current?.scopeId;
  const startsAt = input.startsAt ?? current?.startsAt;
  const endsAt = input.endsAt ?? current?.endsAt;
  if (!surface || !startsAt || !endsAt) return;
  if (endsAt.getTime() <= startsAt.getTime()) throw new ApiError("VALIDATION_ERROR", "Bitiş zamanı başlangıçtan sonra olmalı.");
  const scoped = surface === "CATEGORY" || surface === "COMMUNITY";
  if (scoped !== Boolean(scopeId)) {
    throw new ApiError("VALIDATION_ERROR", scoped ? "Bu yüzey için scopeId zorunlu." : "Bu yüzey scopeId kabul etmiyor.");
  }
}

function validateAnnouncement(input: Partial<AnnouncementInput>, current?: AnnouncementRow) {
  const startsAt = input.startsAt ?? current?.startsAt;
  const endsAt = input.endsAt !== undefined ? input.endsAt : current?.endsAt;
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) throw new ApiError("VALIDATION_ERROR", "Bitiş zamanı başlangıçtan sonra olmalı.");
}

export function registerFeaturedAdminRoutes(route: Route, deps: FeaturedAdminDeps): void {
  const { store, now } = deps;

  route("featured.active", async ({ query, viewer }) => {
    const scoped = query.surface === "CATEGORY" || query.surface === "COMMUNITY";
    if (scoped !== Boolean(query.scopeId)) {
      throw new ApiError("VALIDATION_ERROR", scoped ? "Bu yüzey için scopeId zorunlu." : "Bu yüzey scopeId kabul etmiyor.");
    }
    if (!deps.polls) throw new Error("featured.active requires poll store");
    const at = now();
    const rows = await store.activeFeatured(query.surface, query.scopeId ?? null, at);
    const polls = await deps.polls.store.listByIds(rows.map((row) => row.pollId), viewer?.id ?? null);
    const byId = new Map(polls.map((poll) => [poll.id, poll]));
    const settings = await deps.polls.settings();
    const data = rows.flatMap((row) => {
      const poll = byId.get(row.pollId);
      if (!poll) return [];
      const detail = toPollDetail(poll, viewer, at, settings, deps.polls!.mediaPublicBaseUrl) as Record<string, unknown>;
      const card = Object.fromEntries(CARD_KEYS.map((key) => [key, detail[key]]));
      return [{
        placementId: row.id,
        surface: row.surface,
        scopeId: row.scopeId,
        priority: row.priority,
        badge: row.badge,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        poll: card,
      }];
    });
    return { status: 200, body: { data } };
  });

  route("announcements.active", async ({ viewer }) => {
    const rows = await store.activeAnnouncements(now(), viewer !== null);
    return { status: 200, body: { data: rows.map(announcement) } };
  });

  route("admin.featured.list", async ({ query }) => {
    const after = decodeCursor(query.cursor, "admin.featured");
    const rows = await store.listFeatured({ after, limit: query.limit + 1 });
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    const nextCursor = rows.length > query.limit && last
      ? encodeCursor("admin.featured", [last.createdAt.toISOString()], last.id)
      : null;
    return { status: 200, body: { data: items.map(featured), page: { nextCursor, hasMore: nextCursor !== null } } };
  });

  route("admin.featured.create", async ({ body, viewer, request }) => {
    const at = now();
    const input: FeaturedInput = {
      pollId: body.pollId,
      surface: body.surface,
      scopeId: body.scopeId ?? null,
      priority: body.priority ?? 0,
      badge: body.badge ?? null,
      startsAt: date(body.startsAt, "startsAt")!,
      endsAt: date(body.endsAt, "endsAt")!,
    };
    validateFeatured(input);
    const scope = readIdempotencyScope(request, { userId: viewer!.id, route: "admin.featured.create", body, now: at, required: false });
    const result = await store.createFeatured(scope, input, { actorId: viewer!.id, requestId: request.id, now: at, reason: body.reason });
    if (result.kind === "key_reused") throw idempotencyKeyReused();
    if (result.kind === "rejected") throw new ApiError("CONFLICT", "Kaldırılmış veya bulunamayan içerik öne çıkarılamaz.");
    const row = await store.getFeatured(result.resourceId);
    if (!row) throw new Error("Öne çıkarma oluşturuldu fakat okunamadı.");
    return { status: 201, body: { data: featured(row) } };
  });

  route("admin.featured.update", async ({ params, body, viewer, request }) => {
    const current = await store.getFeatured(params.id);
    if (!current) throw new ApiError("NOT_FOUND", "Öne çıkarma bulunamadı.");
    const patch: Partial<FeaturedInput> = {
      ...(body.pollId !== undefined ? { pollId: body.pollId } : {}),
      ...(body.surface !== undefined ? { surface: body.surface } : {}),
      ...(body.scopeId !== undefined ? { scopeId: body.scopeId } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.badge !== undefined ? { badge: body.badge } : {}),
      ...(body.startsAt !== undefined ? { startsAt: date(body.startsAt, "startsAt")! } : {}),
      ...(body.endsAt !== undefined ? { endsAt: date(body.endsAt, "endsAt")! } : {}),
    };
    validateFeatured(patch, current);
    const result = await store.updateFeatured(params.id, patch, { actorId: viewer!.id, requestId: request.id, now: now(), reason: body.reason });
    if (result === "POLL_NOT_AVAILABLE") throw new ApiError("CONFLICT", "Kaldırılmış veya bulunamayan içerik öne çıkarılamaz.");
    if (result === "NOT_FOUND") throw new ApiError("NOT_FOUND", "Öne çıkarma bulunamadı.");
    const row = await store.getFeatured(params.id);
    return { status: 200, body: { data: featured(row!) } };
  });

  route("admin.featured.delete", async ({ params, viewer, request }) => {
    const ok = await store.deleteFeatured(params.id, { actorId: viewer!.id, requestId: request.id, now: now(), reason: null });
    if (!ok) throw new ApiError("NOT_FOUND", "Öne çıkarma bulunamadı.");
    return { status: 204, body: null };
  });

  route("admin.announcements.list", async ({ query }) => {
    const after = decodeCursor(query.cursor, "admin.announcements");
    const rows = await store.listAnnouncements({ after, limit: query.limit + 1 });
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    const nextCursor = rows.length > query.limit && last
      ? encodeCursor("admin.announcements", [last.createdAt.toISOString()], last.id)
      : null;
    return { status: 200, body: { data: items.map(announcement), page: { nextCursor, hasMore: nextCursor !== null } } };
  });

  route("admin.announcements.create", async ({ body, viewer, request }) => {
    const at = now();
    const input: AnnouncementInput = {
      title: body.title,
      body: body.body,
      level: body.level ?? "INFO",
      audience: body.audience ?? "ALL",
      startsAt: date(body.startsAt, "startsAt")!,
      endsAt: body.endsAt == null ? null : date(body.endsAt, "endsAt")!,
    };
    validateAnnouncement(input);
    const scope = readIdempotencyScope(request, { userId: viewer!.id, route: "admin.announcements.create", body, now: at, required: false });
    const result = await store.createAnnouncement(scope, input, { actorId: viewer!.id, requestId: request.id, now: at, reason: body.reason });
    if (result.kind === "key_reused") throw idempotencyKeyReused();
    const row = await store.getAnnouncement(result.resourceId);
    if (!row) throw new Error("Duyuru oluşturuldu fakat okunamadı.");
    return { status: 201, body: { data: announcement(row) } };
  });

  route("admin.announcements.update", async ({ params, body, viewer, request }) => {
    const current = await store.getAnnouncement(params.id);
    if (!current) throw new ApiError("NOT_FOUND", "Duyuru bulunamadı.");
    const patch: Partial<AnnouncementInput> = {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.body !== undefined ? { body: body.body } : {}),
      ...(body.level !== undefined ? { level: body.level } : {}),
      ...(body.audience !== undefined ? { audience: body.audience } : {}),
      ...(body.startsAt !== undefined ? { startsAt: date(body.startsAt, "startsAt")! } : {}),
      ...(body.endsAt !== undefined ? { endsAt: body.endsAt === null ? null : date(body.endsAt, "endsAt")! } : {}),
    };
    validateAnnouncement(patch, current);
    const result = await store.updateAnnouncement(params.id, patch, { actorId: viewer!.id, requestId: request.id, now: now(), reason: body.reason });
    if (result === "NOT_FOUND") throw new ApiError("NOT_FOUND", "Duyuru bulunamadı.");
    const row = await store.getAnnouncement(params.id);
    return { status: 200, body: { data: announcement(row!) } };
  });

  route("admin.announcements.delete", async ({ params, viewer, request }) => {
    const ok = await store.deleteAnnouncement(params.id, { actorId: viewer!.id, requestId: request.id, now: now(), reason: null });
    if (!ok) throw new ApiError("NOT_FOUND", "Duyuru bulunamadı.");
    return { status: 204, body: null };
  });
}

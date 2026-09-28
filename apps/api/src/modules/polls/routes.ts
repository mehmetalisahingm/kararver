// Anket endpoint'leri — KV-10 (#12). Sözleşme: packages/contracts/src/domains/polls.ts
// Kapsam dışı (kalan işler: docs/KV-10_POLLS.md): tartışma gönderisi (#66), yayın puanı (#67),
// cooldown / günlük limit / aynı başlık (KV-20, #22), domain olayları (KV-04, #6).
import { createHash } from "node:crypto";
import { dbErrorMap, headers, IdempotencyKey, type ErrorCode } from "@kararver/contracts";
import type { FastifyRequest } from "fastify";
import { ApiError } from "../../http/errors.ts";
import type { Route, RouteContext } from "../../http/route.ts";
import { newPublicId, slugify } from "./slug.ts";
import type { IdempotencyScope, IdempotentResult, PollPatch, PollSettings, PollStore } from "./store.ts";
import { isClosed, isPubliclyVisible, toPollDetail } from "./view.ts";

export type PollDeps = {
  store: PollStore;
  now: () => Date;
  mediaPublicBaseUrl: string;
  /** Sistem ayarları (KV-40, #42); ayar servisi gelene kadar varsayılanlar. */
  settings: () => Promise<PollSettings>;
};

const HOUR_MS = 60 * 60 * 1000;
const IDEMPOTENCY_TTL_MS = 24 * HOUR_MS;
const LOCKED_FIELDS = ["title", "description", "options", "resultsVisibility"] as const;

/** DB trigger'ının ürettiği hata (ör. KV_POLL_CONTENT_LOCKED) → sözleşme kodu; tanınmıyorsa null. */
export function mapDbError(err: unknown): ErrorCode | null {
  const text = err instanceof Error ? `${err.message} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})} ${String(err.cause ?? "")}` : "";
  for (const [dbCode, apiCode] of Object.entries(dbErrorMap)) {
    if (text.includes(dbCode)) return apiCode;
  }
  return null;
}

function idempotencyScope(request: FastifyRequest, userId: string, route: string, body: unknown, now: Date, required: boolean): IdempotencyScope | null {
  const raw = request.headers[headers.idempotencyKey.toLowerCase()];
  if (raw === undefined) {
    if (required) throw new ApiError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key başlığı gerekli.");
    return null;
  }
  const key = IdempotencyKey.safeParse(raw);
  if (!key.success) {
    throw new ApiError("VALIDATION_ERROR", "Idempotency-Key geçersiz.", [{ field: headers.idempotencyKey, code: "invalid_format" }]);
  }
  const requestHash = createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
  return { userId, route, key: key.data, requestHash, now, ttlMs: IDEMPOTENCY_TTL_MS };
}

function keyReused(): ApiError {
  return new ApiError("IDEMPOTENCY_KEY_REUSED", "Bu Idempotency-Key farklı bir istekle kullanılmış.");
}

export function registerPollRoutes(route: Route, deps: PollDeps): void {
  const { store, now } = deps;

  async function detail(by: { id: string } | { publicId: string }, viewer: RouteContext["viewer"]) {
    const poll = await store.findPoll(by, viewer?.id ?? null);
    if (!poll || !isPubliclyVisible(poll)) throw new ApiError("NOT_FOUND", "İçerik bulunamadı.");
    return toPollDetail(poll, viewer, now(), await deps.settings(), deps.mediaPublicBaseUrl);
  }

  /** Sahip kontrolü. Görünmeyen içerik 404; başkasının içeriği 403. */
  async function ownedPoll(id: string, viewerId: string, options: { allowRemoved?: boolean } = {}) {
    const meta = await store.findPollMeta(id);
    if (!meta || (meta.status === "REMOVED" && !options.allowRemoved)) throw new ApiError("NOT_FOUND", "İçerik bulunamadı.");
    if (meta.authorId !== viewerId) throw new ApiError("FORBIDDEN", "Bu işlem sadece gönderinin sahibine açık.");
    return meta;
  }

  async function validateReferences(ctx: RouteContext, refs: { categoryId?: string; communityId?: string; mediaIds?: string[] }) {
    if (refs.categoryId && !(await store.isActiveCategory(refs.categoryId))) {
      throw new ApiError("VALIDATION_ERROR", "Kategori bulunamadı.", [{ field: "categoryId", code: "not_found" }]);
    }
    if (refs.communityId) {
      const access = await store.communityAccess(refs.communityId, ctx.viewer!.id);
      if (access === "not_found") {
        throw new ApiError("VALIDATION_ERROR", "Topluluk bulunamadı.", [{ field: "communityId", code: "not_found" }]);
      }
      if (access === "not_member") {
        throw new ApiError("FORBIDDEN", "Bu toplulukta paylaşım için üye olmalısınız.", [{ field: "communityId", code: "not_member" }]);
      }
    }
    if (refs.mediaIds && !(await store.areUsablePollMedia(ctx.viewer!.id, refs.mediaIds))) {
      throw new ApiError("MEDIA_NOT_USABLE", "Görsellerden biri bu gönderide kullanılamaz.", [{ field: "mediaIds", code: "not_usable" }]);
    }
  }

  async function uniquePublicId(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = newPublicId();
      if (!(await store.publicIdExists(id))) return id;
    }
    throw new Error("publicId üretilemedi");
  }

  async function withDbErrors<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      const code = mapDbError(err);
      if (code === "POLL_CONTENT_LOCKED") {
        throw new ApiError(code, "İlk oydan sonra soru, açıklama, seçenekler ve sonuç görünürlüğü değiştirilemez.");
      }
      throw err;
    }
  }

  function created(result: IdempotentResult): { resourceId: string } {
    if (result.kind === "key_reused") throw keyReused();
    return { resourceId: result.resourceId };
  }

  route("polls.create", async (ctx) => {
    const { body, viewer, request } = ctx;
    const scope = idempotencyScope(request, viewer!.id, "polls.create", body, now(), true)!;
    if (body.kind !== "POLL") {
      throw new ApiError("VALIDATION_ERROR", "Tartışma gönderileri henüz açık değil.", [{ field: "kind", code: "not_supported_yet" }]);
    }
    const settings = await deps.settings();
    if (body.durationHours < settings.minDurationHours || body.durationHours > settings.maxDurationHours) {
      throw new ApiError("VALIDATION_ERROR", `Süre ${settings.minDurationHours}–${settings.maxDurationHours} saat arasında olmalı.`, [
        { field: "durationHours", code: "out_of_range" },
      ]);
    }
    await validateReferences(ctx, { categoryId: body.categoryId, communityId: body.communityId, mediaIds: body.mediaIds });

    const opensAt = now();
    const result = await store.createPoll(
      {
        authorId: viewer!.id,
        publicId: await uniquePublicId(),
        slug: slugify(body.title),
        title: body.title,
        description: body.description || null,
        categoryId: body.categoryId,
        communityId: body.communityId ?? null,
        tagSlugs: body.tagSlugs ?? [],
        mediaIds: body.mediaIds ?? [],
        priceAmount: body.price?.amount ?? null,
        priceCurrency: body.price?.currency ?? null,
        extraInfo: body.extraInfo || null,
        allowComments: body.allowComments,
        resultsVisibility: body.resultsVisibility,
        opensAt,
        closesAt: new Date(opensAt.getTime() + body.durationHours * HOUR_MS),
        options: body.options.map((o: { label: string }) => o.label),
      },
      scope,
    );
    const { resourceId } = created(result);
    return { status: 201, body: { data: await detail({ id: resourceId }, viewer) } };
  });

  route("polls.get", async ({ params, viewer }) => ({ status: 200, body: { data: await detail({ id: params.id }, viewer) } }));

  route("polls.lookup", async ({ query, viewer }) => ({ status: 200, body: { data: await detail({ publicId: query.publicId }, viewer) } }));

  route("polls.update", async (ctx) => {
    const { params, body, viewer } = ctx;
    const meta = await ownedPoll(params.id, viewer!.id);
    if (meta.status === "LOCKED") throw new ApiError("CONTENT_LOCKED", "Bu gönderi moderasyon nedeniyle kilitli.");
    if (!isPubliclyVisible(meta)) throw new ApiError("NOT_FOUND", "İçerik bulunamadı.");

    const touchesLocked = LOCKED_FIELDS.filter((f) => body[f] !== undefined);
    if (meta.firstValidVoteAt && touchesLocked.length > 0) {
      throw new ApiError(
        "POLL_CONTENT_LOCKED",
        "İlk oydan sonra soru, açıklama, seçenekler ve sonuç görünürlüğü değiştirilemez.",
        touchesLocked.map((field) => ({ field, code: "locked" })),
      );
    }

    if (body.options) {
      const labels = body.options.map((o: { label: string }) => o.label.toLocaleLowerCase("tr"));
      if (new Set(labels).size !== labels.length) {
        throw new ApiError("VALIDATION_ERROR", "Seçenekler birbirinden farklı olmalı.", [{ field: "options", code: "duplicate" }]);
      }
      const current = await store.findPoll({ id: params.id }, null);
      const known = new Set(current!.options.map((o) => o.id));
      const ids = body.options.flatMap((o: { id?: string }) => (o.id ? [o.id] : []));
      if (ids.some((id: string) => !known.has(id)) || new Set(ids).size !== ids.length) {
        throw new ApiError("VALIDATION_ERROR", "Seçenek bu ankete ait değil.", [{ field: "options", code: "unknown_option" }]);
      }
    }
    await validateReferences(ctx, { categoryId: body.categoryId });

    const patch: PollPatch = {};
    if (body.title !== undefined) Object.assign(patch, { title: body.title, slug: slugify(body.title) });
    if (body.description !== undefined) patch.description = body.description || null;
    if (body.categoryId !== undefined) patch.categoryId = body.categoryId;
    if (body.tagSlugs !== undefined) patch.tagSlugs = body.tagSlugs;
    if (body.price !== undefined) Object.assign(patch, { priceAmount: body.price?.amount ?? null, priceCurrency: body.price?.currency ?? null });
    if (body.extraInfo !== undefined) patch.extraInfo = body.extraInfo || null;
    if (body.allowComments !== undefined) patch.allowComments = body.allowComments;
    if (body.resultsVisibility !== undefined) patch.resultsVisibility = body.resultsVisibility;
    if (body.options !== undefined) patch.options = body.options;

    // Ön kontrol ile yazma arasında ilk oy gelirse DB trigger'ı reddeder → 409 (DATA_MODEL §6 "Yarış durumu").
    await withDbErrors(() => store.updatePoll(params.id, patch));
    return { status: 200, body: { data: await detail({ id: params.id }, viewer) } };
  });

  route("polls.close", async ({ params, viewer }) => {
    const meta = await ownedPoll(params.id, viewer!.id);
    if (!isPubliclyVisible(meta)) throw new ApiError("NOT_FOUND", "İçerik bulunamadı.");
    if (!isClosed(meta, now())) await store.closePoll(params.id, now());
    return { status: 200, body: { data: await detail({ id: params.id }, viewer) } };
  });

  route("polls.delete", async ({ params, viewer }) => {
    await ownedPoll(params.id, viewer!.id, { allowRemoved: true });
    await store.removePoll(params.id, now());
    return { status: 204, body: null };
  });

  route("polls.addenda.create", async ({ params, body, viewer, request }) => {
    const meta = await ownedPoll(params.id, viewer!.id);
    if (meta.status === "LOCKED") {
      throw new ApiError("FORBIDDEN", "Bu gönderi moderasyon nedeniyle kilitli.", [{ code: "content_locked" }]);
    }
    if (!isPubliclyVisible(meta)) throw new ApiError("NOT_FOUND", "İçerik bulunamadı.");
    const scope = idempotencyScope(request, viewer!.id, `polls.addenda.create:${params.id}`, body, now(), false);
    const { resourceId } = created(await store.createAddendum(params.id, body.body, scope));
    const addendum = (await store.findAddendum(resourceId))!;
    return { status: 201, body: { data: { id: addendum.id, body: addendum.body, createdAt: addendum.createdAt.toISOString() } } };
  });
}

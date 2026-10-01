// Anket endpoint'leri — KV-10 (#12). Sözleşme: packages/contracts/src/domains/polls.ts
// Kapsam dışı (kalan işler: docs/KV-10_POLLS.md): tartışma gönderisi (#66), yayın puanı (#67),
// cooldown / günlük limit / aynı başlık (KV-20, #22), domain olayları (KV-04, #6).
import { dbErrorMap, headers, type ErrorCode } from "@kararver/contracts";
import type { FastifyRequest } from "fastify";
import { ApiError } from "../../http/errors.ts";
import { idempotencyKeyReused, readIdempotencyScope } from "../../http/idempotency.ts";
import type { Route, RouteContext } from "../../http/route.ts";
import { newPublicId, slugify } from "./slug.ts";
import { PollLimitError, PollReferenceError, type IdempotencyScope, type IdempotentResult, type PollPatch, type PollSettings, type PollStore } from "./store.ts";
import { isClosed, isPubliclyVisible, toPollDetail } from "./view.ts";

export type PollDeps = {
  store: PollStore;
  now: () => Date;
  mediaPublicBaseUrl: string;
  /** Sistem ayarları (KV-40, #42); ayar servisi gelene kadar varsayılanlar. */
  settings: () => Promise<PollSettings>;
};

const HOUR_MS = 60 * 60 * 1000;
const LOCKED_FIELDS = ["title", "description", "options", "resultsVisibility"] as const;

/** DB trigger'ının ürettiği hata (ör. KV_POLL_CONTENT_LOCKED) → sözleşme kodu; tanınmıyorsa null. */
export function mapDbError(err: unknown): ErrorCode | null {
  const text = err instanceof Error ? `${err.message} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})} ${String(err.cause ?? "")}` : "";
  for (const [dbCode, apiCode] of Object.entries(dbErrorMap)) {
    if (text.includes(dbCode)) return apiCode;
  }
  return null;
}

/** Tartışma gönderisinde ankete özgü işlem (oy, seçenek, sonuç görünürlüğü, kapatma) — #66. */
function notAPoll(fields: readonly string[]): ApiError {
  return new ApiError("NOT_A_POLL", "Bu bir tartışma gönderisi; seçenek, oy ve süre yok.", fields.map((field) => ({ field, code: "not_a_poll" })));
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

  /** Referans sorunları → sözleşme hatası. Hem ön kontrol hem transaction içi kontrol aynı mesajı verir. */
  function referenceError(err: PollReferenceError): ApiError {
    if (err.field === "categoryId") return new ApiError("VALIDATION_ERROR", "Kategori bulunamadı.", [{ field: "categoryId", code: "not_found" }]);
    if (err.field === "communityId" && err.reason === "not_member") {
      return new ApiError("FORBIDDEN", "Bu toplulukta paylaşım için üye olmalısınız.", [{ field: "communityId", code: "not_member" }]);
    }
    if (err.field === "communityId") return new ApiError("VALIDATION_ERROR", "Topluluk bulunamadı.", [{ field: "communityId", code: "not_found" }]);
    return new ApiError("MEDIA_NOT_USABLE", "Görsellerden biri bu gönderide kullanılamaz.", [{ field: "mediaIds", code: "not_usable" }]);
  }

  /**
   * Hızlı ön kontrol (net hata mesajı için). Yetkili kontrol, anket oluşturma transaction'ı içinde
   * satırlar kilitlenerek tekrarlanır (prisma-store.ts → lockReferences).
   */
  async function validateReferences(ctx: RouteContext, refs: { categoryId?: string; communityId?: string; mediaIds?: string[] }) {
    if (refs.categoryId && !(await store.isActiveCategory(refs.categoryId))) throw referenceError(new PollReferenceError("categoryId", "not_found"));
    if (refs.communityId) {
      const access = await store.communityAccess(refs.communityId, ctx.viewer!.id);
      if (access !== "ok") throw referenceError(new PollReferenceError("communityId", access));
    }
    if (refs.mediaIds && !(await store.areUsablePollMedia(ctx.viewer!.id, refs.mediaIds))) {
      throw referenceError(new PollReferenceError("mediaIds", "not_usable"));
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

  /** Yayın limitleri (KV-20): 429 + Retry-After; aynı başlık 409. */
  function limitError(err: PollLimitError): ApiError {
    const retry: Record<string, string> = err.retryAfterSeconds === null ? {} : { [headers.retryAfter]: String(err.retryAfterSeconds) };
    if (err.code === "DAILY_PUBLISH_LIMIT") {
      return new ApiError(err.code, "Günlük gönderi sınırına ulaştınız.", [{ code: "retry_after_seconds", message: String(err.retryAfterSeconds) }], retry);
    }
    if (err.code === "PUBLISH_COOLDOWN") {
      return new ApiError(err.code, "Yeni gönderi için biraz beklemelisiniz.", [{ code: "retry_after_seconds", message: String(err.retryAfterSeconds) }], retry);
    }
    return new ApiError(err.code, "Aynı başlıkla açık bir gönderiniz zaten var.", [{ field: "title", code: "duplicate" }]);
  }

  async function withReferenceErrors<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof PollReferenceError) throw referenceError(err);
      if (err instanceof PollLimitError) throw limitError(err);
      throw err;
    }
  }

  function created(result: IdempotentResult): { resourceId: string } {
    if (result.kind === "key_reused") throw idempotencyKeyReused();
    return { resourceId: result.resourceId };
  }

  route("polls.create", async (ctx) => {
    const { body, viewer, request } = ctx;
    const scope = readIdempotencyScope(request, { userId: viewer!.id, route: "polls.create", body, now: now(), required: true })!;
    const isPoll = body.kind === "POLL";
    // Başarılı bir isteğin tekrarı, sonucu sonradan değişebilecek kontrollerden (süre ayarı, kategori,
    // üyelik, görsel durumu) önce kayıtlı sonucu alır.
    const prior = await store.findIdempotentResult(scope);
    if (prior) {
      const { resourceId } = created(prior);
      return { status: 201, body: { data: await detail({ id: resourceId }, viewer) } };
    }
    const settings = await deps.settings();
    // Tartışma (#66) süresizdir; süre sınırı sadece ankete uygulanır.
    if (isPoll && (body.durationHours < settings.minDurationHours || body.durationHours > settings.maxDurationHours)) {
      throw new ApiError("VALIDATION_ERROR", `Süre ${settings.minDurationHours}–${settings.maxDurationHours} saat arasında olmalı.`, [
        { field: "durationHours", code: "out_of_range" },
      ]);
    }
    await validateReferences(ctx, { categoryId: body.categoryId, communityId: body.communityId, mediaIds: body.mediaIds });

    const opensAt = now();
    const publicId = await uniquePublicId();
    const result = await withReferenceErrors(() => store.createPoll(
      {
        kind: body.kind,
        authorId: viewer!.id,
        publicId,
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
        resultsVisibility: isPoll ? body.resultsVisibility : null,
        opensAt,
        closesAt: isPoll ? new Date(opensAt.getTime() + body.durationHours * HOUR_MS) : null,
        options: isPoll ? body.options.map((o: { label: string }) => o.label) : [],
      },
      scope,
      settings,
    ));
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
    if (meta.kind !== "POLL") {
      const pollOnly = (["options", "resultsVisibility"] as const).filter((f) => body[f] !== undefined);
      if (pollOnly.length > 0) throw notAPoll(pollOnly);
    }

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
    await withDbErrors(() => store.updatePoll(params.id, patch, { id: viewer!.id, at: now() }));
    return { status: 200, body: { data: await detail({ id: params.id }, viewer) } };
  });

  route("polls.close", async ({ params, viewer }) => {
    const meta = await ownedPoll(params.id, viewer!.id);
    if (!isPubliclyVisible(meta)) throw new ApiError("NOT_FOUND", "İçerik bulunamadı.");
    if (meta.kind !== "POLL") throw notAPoll([]);
    if (!isClosed(meta, now())) await store.closePoll(params.id, now());
    return { status: 200, body: { data: await detail({ id: params.id }, viewer) } };
  });

  route("polls.delete", async ({ params, viewer }) => {
    await ownedPoll(params.id, viewer!.id, { allowRemoved: true });
    await store.removePoll(params.id, now());
    return { status: 204, body: null };
  });

  route("polls.addenda.create", async ({ params, body, viewer, request }) => {
    const scope = readIdempotencyScope(request, { userId: viewer!.id, route: `polls.addenda.create:${params.id}`, body, now: now(), required: false });
    const prior = scope ? await store.findIdempotentResult(scope) : null;
    if (prior) {
      const addendum = (await store.findAddendum(created(prior).resourceId))!;
      return { status: 201, body: { data: { id: addendum.id, body: addendum.body, createdAt: addendum.createdAt.toISOString() } } };
    }
    const meta = await ownedPoll(params.id, viewer!.id);
    if (meta.status === "LOCKED") {
      throw new ApiError("FORBIDDEN", "Bu gönderi moderasyon nedeniyle kilitli.", [{ code: "content_locked" }]);
    }
    if (!isPubliclyVisible(meta)) throw new ApiError("NOT_FOUND", "İçerik bulunamadı.");
    const { resourceId } = created(await store.createAddendum(params.id, body.body, scope));
    const addendum = (await store.findAddendum(resourceId))!;
    return { status: 201, body: { data: { id: addendum.id, body: addendum.body, createdAt: addendum.createdAt.toISOString() } } };
  });

  // Gönderi tepkileri (#66): anket ve tartışmada; anket oyundan ayrıdır. Hesap + gönderi başına tek aktif tepki.
  async function react(pollId: string, userId: string, value: "LIKE" | "DISLIKE" | null) {
    const result = await store.setReaction(pollId, userId, value);
    if (result.kind !== "ok") {
      if (result.kind === "locked") throw new ApiError("CONTENT_LOCKED", "Bu gönderi moderasyon nedeniyle kilitli.");
      throw new ApiError("NOT_FOUND", "İçerik bulunamadı.");
    }
    return { status: 200, body: { data: result.summary } };
  }

  route("reactions.poll.put", async ({ params, body, viewer }) => react(params.id, viewer!.id, body.value));

  route("reactions.poll.delete", async ({ params, viewer }) => react(params.id, viewer!.id, null));
}

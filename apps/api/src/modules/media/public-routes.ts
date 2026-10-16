// Railway buckets are private. Expose only approved WebP copies, with a fresh DB check on every request.
import type { FastifyInstance } from "fastify";
import { errorResponse } from "@kararver/contracts";
import { ApiError } from "../../http/errors.ts";
import { MAX_PUBLIC_READ_BYTES, publicObjectKeyFor, type MediaStorage } from "./storage.ts";
import type { MediaStore } from "./store.ts";

export function registerPublicMediaRoutes(app: FastifyInstance, deps: {
  store: Pick<MediaStore, "findPublicKey">;
  storage: Pick<MediaStorage, "readPublic">;
}): void {
  app.get<{ Params: { file: string } }>("/media-public/m/:file", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store").header("X-Robots-Tag", "noindex, nofollow");
    const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/.exec(request.params.file);
    const missing = () => new ApiError("NOT_FOUND", "Görsel bulunamadı.");
    if (!match) throw missing();
    const id = match[1]!;
    const key = publicObjectKeyFor(id);
    if (await deps.store.findPublicKey(id) !== key) throw missing();
    let bytes: Buffer | null;
    try { bytes = await deps.storage.readPublic(key); }
    catch {
      // Provider errors can contain signed URLs. Keep them out of HTTP responses and logs.
      request.log.warn("Onaylı görsel depolamadan okunamadı");
      return reply.code(503).header("Retry-After", "5").send(errorResponse("INTERNAL_ERROR", "Görsel şu anda yüklenemiyor.", request.id));
    }
    if (!bytes) throw missing();
    if (bytes.length > MAX_PUBLIC_READ_BYTES) throw new ApiError("INTERNAL_ERROR", "Görsel okunamadı.");
    // A moderator may have removed it while storage was being read.
    if (await deps.store.findPublicKey(id) !== key) throw missing();
    return reply.type("image/webp").send(bytes);
  });
}

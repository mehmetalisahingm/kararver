// İçerik sürüm geçmişi — #66. Sözleşme: packages/contracts/src/domains/moderation.ts (admin.revisions.polls/comments).
// Yetki revision.read (ADMIN+, KV-04), router kapısında. Kaldırılmış içeriğin geçmişi de açıktır (inceleme/itiraz).
// Bilinen açık: geçmiş okumasının kendisi audit_logs'a (KV-39, #41) yazılmalı (V1_USER_FLOW "log erişimi de izlenebilir");
// tablo gelince eklenecek.
import { decodeCursor, encodeCursor, invalidCursor } from "../../http/cursor.ts";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { RevisionStore } from "./store.ts";
import type { RevisionTarget } from "./write.ts";

export type RevisionDeps = { store: RevisionStore; mediaPublicBaseUrl: string };

export function registerRevisionRoutes(route: Route, deps: RevisionDeps): void {
  const handler = (target: RevisionTarget) => async ({ params, query }: { params: { id: string }; query: { cursor?: string; limit: number } }) => {
    if (!(await deps.store.exists(target, params.id))) throw new ApiError("NOT_FOUND", "İçerik bulunamadı.");
    const filter = `revisions:${target}:${params.id}`;
    const after = decodeCursor(query.cursor, filter);
    const before = after ? after.keys[0] : null;
    if (before !== null && (typeof before !== "number" || !Number.isInteger(before) || before < 1)) throw invalidCursor();

    const rows = await deps.store.list(target, params.id, before as number | null, query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > query.limit && last ? encodeCursor(filter, [last.version], params.id) : null;
    const data = page.map((r) => ({
      version: r.version,
      editor: {
        id: r.editor.id,
        username: r.editor.username,
        displayName: r.editor.displayName,
        avatarUrl: r.editor.avatarPublicKey ? `${deps.mediaPublicBaseUrl}/${r.editor.avatarPublicKey}` : null,
      },
      editedAt: r.editedAt.toISOString(),
      snapshot: r.snapshot,
    }));
    return { status: 200, body: { data, page: { nextCursor, hasMore: nextCursor !== null } } };
  };

  route("admin.revisions.polls", handler("poll"));
  route("admin.revisions.comments", handler("comment"));
}

// Bildirimler — KV-21 (#23): liste, okunmamış sayısı, okundu işaretleme. Tüketici: bildirim merkezi (Mehmet, KV-35).
// Kullanıcı izolasyonu: her işlem oturumdaki kullanıcının satırlarıyla sınırlıdır. Tekil bildirim endpoint'i yoktur;
// başka kullanıcının id'si okundu işaretine verilirse satır değişmez ve sayıya girmez (varlık sızdırılmaz, hata dönmez).
// Kapsam dışı: tercih ve sessize alma (notifications.preferences.*, notifications.mutes.*, KV-34 #36), teslim (KV-21 PR-3).
import { decodeCursor, encodeCursor, invalidCursor } from "../../http/cursor.ts";
import type { Route } from "../../http/route.ts";
import type { NotificationRecord, NotificationStore } from "./store.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toNotificationView(n: NotificationRecord, mediaBase: string) {
  return {
    id: n.id,
    type: n.type,
    subject: n.subject,
    actor: n.actor
      ? {
          id: n.actor.id,
          username: n.actor.username,
          displayName: n.actor.displayName,
          avatarUrl: n.actor.avatarPublicKey ? `${mediaBase}/${n.actor.avatarPublicKey}` : null,
        }
      : null,
    data: n.data,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

/** Cursor anahtarı [created_at ISO]; bozuk zaman veya id 400 INVALID_CURSOR olur (DB hatasına düşmez). */
function cursorPosition(cursor: string | undefined, filter: string): { createdAt: Date; id: string } | null {
  const after = decodeCursor(cursor, filter);
  if (!after) return null;
  const [at] = after.keys;
  const createdAt = typeof at === "string" ? new Date(at) : null;
  if (after.keys.length !== 1 || !createdAt || Number.isNaN(createdAt.getTime()) || !UUID.test(after.id)) throw invalidCursor();
  return { createdAt, id: after.id };
}

export function registerNotificationRoutes(
  route: Route,
  deps: { store: NotificationStore; now: () => Date; mediaPublicBaseUrl: string },
): void {
  const { store } = deps;

  route("notifications.list", async ({ query, viewer }) => {
    const unreadOnly = query.unreadOnly as boolean;
    const filter = `notifications:${unreadOnly ? "unread" : "all"}`;
    const after = cursorPosition(query.cursor, filter);
    const rows = await store.list(viewer!.id, { unreadOnly, after, limit: query.limit + 1 });
    const visible = rows.slice(0, query.limit);
    const last = visible[visible.length - 1];
    const nextCursor = rows.length > query.limit && last ? encodeCursor(filter, [last.createdAt.toISOString()], last.id) : null;
    return {
      status: 200,
      body: { data: visible.map((n) => toNotificationView(n, deps.mediaPublicBaseUrl)), page: { nextCursor, hasMore: nextCursor !== null } },
    };
  });

  route("notifications.unreadCount", async ({ viewer }) => {
    return { status: 200, body: { data: { count: await store.unreadCount(viewer!.id) } } };
  });

  route("notifications.markRead", async ({ body, viewer }) => {
    const target = "all" in body ? { all: true as const } : { ids: [...new Set(body.ids as string[])] };
    return { status: 200, body: { data: { updated: await store.markRead(viewer!.id, target, deps.now()) } } };
  });
}

// Bildirimler — KV-21 (#23): liste, okunmamış sayısı, okundu işaretleme. Tüketici: bildirim merkezi (Mehmet, KV-35).
// Kullanıcı izolasyonu: her işlem oturumdaki kullanıcının satırlarıyla sınırlıdır. Tekil bildirim endpoint'i yoktur;
// başka kullanıcının id'si okundu işaretine verilirse satır değişmez ve sayıya girmez (varlık sızdırılmaz, hata dönmez).
// KV-34 (#36): tip tercihi ve anket sessizi. Teslim anında worker politikası uygular (yalnız yeni bildirimler); mevcut
// bildirimler ve okundu durumları değişmez. Kapatılamayan tipler (moderasyon, yaptırım) 400 VALIDATION_ERROR.
// Kapsam dışı: teslim (worker, KV-21 PR-3).
import { MANDATORY_NOTIFICATION_TYPES, NotificationType } from "@kararver/contracts";
import { decodeCursor, encodeCursor, invalidCursor } from "../../http/cursor.ts";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { NotificationPreferenceMap, NotificationRecord, NotificationStore } from "./store.ts";

/** Kullanıcının açıp kapatabildiği tipler; cevapta hepsi açıkça yer alır (istemci eksik tipi açık sayar). */
const OPTIONAL_TYPES = NotificationType.options.filter((t) => !MANDATORY_NOTIFICATION_TYPES.includes(t));

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
    // DB'de zaten tutulan poll_id, yorum bildirimini doğru ankete döndürmek için view data'sına eklenir.
    // Olay payload'ı değişmez; NotificationView.data scalar map sözleşmesi korunur.
    data: n.pollId ? { ...n.data, pollId: n.pollId } : n.data,
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

  async function preferences(userId: string) {
    const off = new Set(await store.optedOut(userId));
    return { types: Object.fromEntries(OPTIONAL_TYPES.map((t) => [t, !off.has(t)])) as NotificationPreferenceMap };
  }

  route("notifications.preferences.get", async ({ viewer }) => {
    return { status: 200, body: { data: await preferences(viewer!.id) } };
  });

  route("notifications.preferences.update", async ({ body, viewer }) => {
    const types = body.types as NotificationPreferenceMap;
    const mandatory = Object.keys(types).filter((t) => MANDATORY_NOTIFICATION_TYPES.includes(t as NotificationRecord["type"]));
    if (mandatory.length > 0) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Moderasyon ve yaptırım bildirimleri kapatılamaz.",
        mandatory.map((t) => ({ field: `types.${t}`, code: "not_configurable" })),
      );
    }
    await store.setPreferences(viewer!.id, types);
    return { status: 200, body: { data: await preferences(viewer!.id) } };
  });

  route("notifications.mutes.put", async ({ params, viewer }) => {
    if (!(await store.mutePoll(viewer!.id, params.pollId))) throw new ApiError("NOT_FOUND", "Anket bulunamadı.");
    return { status: 200, body: { data: { muted: true as const } } };
  });

  route("notifications.mutes.delete", async ({ params, viewer }) => {
    await store.unmutePoll(viewer!.id, params.pollId);
    return { status: 200, body: { data: { muted: false as const } } };
  });
}

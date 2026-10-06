// KV-35 bildirim merkezi istemcisi: sözleşmeli istekler, hedef bağlantılar ve kopyalar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { HttpClient } from "../src/lib/http-client.ts";
import { NotificationClient, notificationCopy, notificationHref } from "../src/features/notifications/notification-client.ts";
import type { NotificationItem } from "../src/features/notifications/notification-client.ts";

type Seen = { url: string; method: string; body: unknown };
function fixture(endpoint: string, name: string) {
  return structuredClone(examples.find((e) => e.endpoint === endpoint && e.name === name)!);
}
function reply(endpoint: string, name: string) {
  const e = fixture(endpoint, name);
  return new Response(e.body === null ? null : JSON.stringify(e.body), { status: e.status });
}
function api(respond: (seen: Seen) => Response) {
  const calls: Seen[] = [];
  const http = new HttpClient("http://api.test", async (url, init) => {
    const seen = { url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : undefined };
    calls.push(seen);
    return respond(seen);
  });
  return { notifications: new NotificationClient(http), calls };
}

test("liste filtresi, sayaç ve okundu işlemi doğru endpointleri kullanır", async () => {
  const list = api(() => reply("notifications.list", "ok"));
  const page = await list.notifications.list(true, "abc_1");
  const url = new URL(list.calls[0].url);
  assert.equal(url.pathname, "/v1/notifications");
  assert.equal(url.searchParams.get("unreadOnly"), "true");
  assert.equal(url.searchParams.get("cursor"), "abc_1");
  assert.equal(page.items.length, 1);

  const count = api(() => reply("notifications.unreadCount", "ok"));
  assert.equal(await count.notifications.unreadCount(), 3);

  const read = api(() => reply("notifications.markRead", "all"));
  assert.equal(await read.notifications.markRead({ all: true }), 3);
  assert.deepEqual(read.calls[0].body, { all: true });
});

test("tercihler ve anket sessizi sözleşmeli çağrılar yapar", async () => {
  const preferences = api((seen) => seen.method === "GET" ? reply("notifications.preferences.get", "ok") : reply("notifications.preferences.update", "ok"));
  assert.equal((await preferences.notifications.preferences()).types.POLL_TRENDING, false);
  assert.equal((await preferences.notifications.updatePreferences({ POLL_TRENDING: true })).types.POLL_TRENDING, true);

  const mute = api((seen) => seen.method === "PUT" ? reply("notifications.mutes.put", "ok") : reply("notifications.mutes.delete", "ok"));
  const poll = "01998b9a-0000-7000-8000-000000000020";
  assert.equal(await mute.notifications.setPollMuted(poll, true), true);
  assert.equal(await mute.notifications.setPollMuted(poll, false), false);
});

test("anket ve yorum bildirimleri doğru içeriğe döner", () => {
  const poll = "01998b9a-0000-7000-8000-000000000020";
  const comment = "01998b9a-0000-7000-8000-000000000040";
  const base = {
    id: "01998b9a-0000-7000-8000-000000000090",
    actor: null,
    readAt: null,
    createdAt: "2026-10-06T10:00:00.000Z",
  };
  const pollNotification = { ...base, type: "POLL_CLOSED", subject: { type: "POLL", id: poll }, data: { reason: "OWNER" } } as NotificationItem;
  assert.equal(notificationHref(pollNotification), `/karar/${poll}`);

  const commentNotification = { ...base, type: "REPLY_TO_COMMENT", subject: { type: "COMMENT", id: comment }, data: { parentId: comment, pollId: poll } } as NotificationItem;
  assert.equal(notificationHref(commentNotification), `/karar/${poll}#yorum-${comment}`);
  assert.match(notificationCopy(commentNotification).title, /cevap verdi/);
});

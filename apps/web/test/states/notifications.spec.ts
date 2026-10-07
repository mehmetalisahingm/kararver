import { expect, test } from "@playwright/test";
import { api, empty, failure, sample } from "./api";

test("notification center: loading error, retry and empty states", async ({ page }) => {
  const mock = await api(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  mock.handlers.set("notifications.list", async (route) => {
    await gate;
    await route.fulfill({ status: 500, json: failure() });
  });

  await page.goto("/bildirimler");
  await expect(page.getByRole("status").filter({ hasText: "Bildirimler yükleniyor" })).toBeVisible();
  release();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();

  mock.handlers.set("notifications.list", (route) => route.fulfill({ json: empty() }));
  await page.getByRole("button", { name: "Tekrar dene", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Henüz bildirimin yok." })).toBeVisible();
  expect(mock.unexpected).toEqual([]);
});

test("removed notification target stays in center with a safe explanation and is marked read", async ({ page }) => {
  const mock = await api(page);
  let marked = 0;
  mock.handlers.set("polls.get", (route) => route.fulfill({ status: 404, json: failure("NOT_FOUND") }));
  mock.handlers.set("notifications.markRead", async (route) => {
    marked += 1;
    await route.fulfill({ json: { data: { updated: 1 } } });
  });

  await page.goto("/bildirimler");
  await expect(page.locator(".notification-item")).toHaveCount(1);
  await page.locator(".notification-open").click();

  await expect(page).toHaveURL(/\/bildirimler$/);
  await expect(page.getByRole("heading", { name: "Bildirim hedefi artık erişilebilir değil." })).toBeVisible();
  await expect(page.getByText(/Kaldırılmış veya görünürlüğü değişmiş olabilir/)).toBeVisible();
  await expect(page.locator(".notification-item--unread")).toHaveCount(0);
  expect(marked).toBe(1);
  expect(mock.unexpected).toEqual([]);
});

test("successful notification open marks read first and navigates to the poll", async ({ page }) => {
  const mock = await api(page);
  let marked = 0;
  mock.handlers.set("notifications.markRead", async (route) => {
    marked += 1;
    await route.fulfill({ json: { data: { updated: 1 } } });
  });

  await page.goto("/bildirimler");
  await page.locator(".notification-open").click();
  await expect(page).toHaveURL(/\/karar\/01998b9a-0000-7000-8000-000000000020$/);
  expect(marked).toBe(1);
  expect(mock.unexpected).toEqual([]);
});

test("#36 unavailable: preferences degrade safely and mute controls stay hidden", async ({ page }) => {
  const mock = await api(page);
  mock.handlers.set("notifications.preferences.get", (route) => route.fulfill({ status: 404, json: failure("NOT_FOUND") }));

  await page.goto("/bildirimler");
  await expect(page.getByRole("heading", { name: "Bildirim tercihleri" })).toBeVisible();
  await expect(page.getByText(/henüz kullanıma açılmadı/)).toBeVisible();
  await expect(page.getByRole("button", { name: /sessize al|Sessizi kaldır/ })).toHaveCount(0);
  expect(mock.unexpected).toEqual([]);
});

test("mark all keeps sidebar badge consistent with server unread count", async ({ page }) => {
  const mock = await api(page);
  let unread = 3;
  mock.handlers.set("notifications.unreadCount", (route) => route.fulfill({ json: { data: { count: unread } } }));
  mock.handlers.set("notifications.markRead", async (route) => {
    unread = 0;
    await route.fulfill({ json: { data: { updated: 3 } } });
  });

  await page.goto("/bildirimler");
  await expect(page.locator(".app-sidebar .notification-badge")).toHaveText("3");
  await page.getByRole("button", { name: "Tümünü okundu yap" }).click();
  await expect(page.locator(".app-sidebar .notification-badge")).toHaveCount(0);
  await expect(page.locator(".notification-item--unread")).toHaveCount(0);
  expect(mock.unexpected).toEqual([]);
});

test("pagination ignores duplicate notification ids from a moving feed", async ({ page }) => {
  const mock = await api(page);
  const first = sample("notifications.list");
  first.page = { hasMore: true, nextCursor: "next" };
  mock.handlers.set("notifications.list", async (route, url) => {
    if (url.searchParams.get("cursor") === "next") {
      await route.fulfill({ json: { data: first.data, page: { hasMore: false, nextCursor: null } } });
      return;
    }
    await route.fulfill({ json: first });
  });

  await page.goto("/bildirimler");
  await expect(page.locator(".notification-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Daha fazla göster" }).click();
  await expect(page.locator(".notification-item")).toHaveCount(1);
  expect(mock.unexpected).toEqual([]);
});

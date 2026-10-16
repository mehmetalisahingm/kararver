import { test, expect } from "@playwright/test";
import { api, failure, sample } from "./api";

const routeId = sample("polls.get").data.id;
const shareUrl = "https://kararver.test/s/test-link";

test("social popup is reserved before the API finishes and navigates only to the confirmed share link", async ({ page }) => {
  const mock = await api(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  mock.handlers.set("shares.create", async route => {
    await pending;
    await route.fulfill({ status: 201, json: { data: { shareId: "test-link", url: shareUrl } } });
  });
  await page.addInitScript(() => {
    const w = window as any;
    w.shareEvents = [];
    window.open = ((url: string) => {
      w.shareEvents.push(["open", url]);
      return { closed: false, opener: null, location: { replace: (url: string) => w.shareEvents.push(["navigate", url]) }, close: () => w.shareEvents.push(["close"]) };
    }) as any;
  });
  await page.goto(`/karar/${routeId}`);
  await page.getByRole("button", { name: "X'te paylaş", exact: true }).click();
  expect(await page.evaluate(() => (window as any).shareEvents)).toEqual([["open", "about:blank"]]);
  await expect(page.getByRole("button", { name: "Açılıyor…", exact: true })).toBeDisabled();
  release();
  await expect.poll(() => page.evaluate(() => (window as any).shareEvents.length)).toBe(2);
  const target = await page.evaluate(() => (window as any).shareEvents[1][1]);
  expect(new URL(target).origin).toBe("https://twitter.com");
  expect(new URL(target).searchParams.get("url")).toBe(shareUrl);
  expect(mock.unexpected).toEqual([]);
});

test("blocked popup and denied clipboard leave a usable link; failed share creates no external navigation", async ({ page }) => {
  const mock = await api(page);
  let failed = false;
  mock.handlers.set("shares.create", route => failed
    ? route.fulfill({ status: 404, json: failure("NOT_FOUND") })
    : route.fulfill({ status: 201, json: { data: { shareId: "test-link", url: shareUrl } } }));
  await page.addInitScript(() => {
    window.open = () => null;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("NotAllowedError"); } } });
  });
  await page.goto(`/karar/${routeId}`);
  await page.getByRole("button", { name: "WhatsApp'ta paylaş", exact: true }).click();
  const link = page.getByRole("link", { name: "WhatsApp paylaşımını aç" });
  await expect(link).toBeVisible();
  expect(new URL((await link.getAttribute("href"))!).searchParams.get("text")).toContain(shareUrl);
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await page.getByRole("button", { name: "Bağlantıyı kopyala", exact: true }).click();
  await expect(link).toHaveCount(0);
  await expect(page.getByLabel("Paylaşım bağlantısı", { exact: true })).toHaveValue(shareUrl);
  failed = true;
  await page.getByRole("button", { name: "X'te paylaş", exact: true }).click();
  await expect(page.getByLabel("Paylaşım bağlantısı", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "X'te paylaş", exact: true })).toBeEnabled();
  expect(mock.unexpected).toEqual([]);
});

test("API failure closes the reserved blank popup", async ({ page }) => {
  const mock = await api(page);
  mock.handlers.set("shares.create", route => route.fulfill({ status: 500, json: failure() }));
  await page.addInitScript(() => {
    (window as any).shareClosed = false;
    window.open = (() => ({ closed: false, opener: null, close: () => { (window as any).shareClosed = true; } })) as any;
  });
  await page.goto(`/karar/${routeId}`);
  await page.getByRole("button", { name: "X'te paylaş", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).shareClosed)).toBe(true);
  await expect(page.getByRole("link", { name: "X paylaşımını aç" })).toHaveCount(0);
  expect(mock.unexpected).toEqual([]);
});

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { api, failure, sample } from "./api";
test.use({ actionTimeout: 15000 });

const id = "01998b9a-0000-7000-8000-000000000020";
const path = `/hesap/itiraz/${id}`;
const view = { rejectionActionId: id, deliveredAt: "2026-11-09T12:00:00Z", deadlineAt: "2026-12-09T12:00:00Z", filedAt: null as string | null, status: "OPEN" };
const reason = "Kararın yeniden incelenmesini istiyorum.";

for (const status of [400, 403, 409, 500, "network"] as const) test(`appeal ${status}: no optimistic success, retained reason, explicit retry`, async ({ page }, info) => {
  const mock = await api(page); let failed = true; let calls = 0;
  mock.handlers.set("me.moderationAppeals.get", r => r.fulfill({ json: { data: view } }));
  mock.handlers.set("me.moderationAppeals.file", r => {
    calls++; expect(r.request().postDataJSON()).toEqual({ reason });
    if (failed) return status === "network" ? r.abort("failed") : r.fulfill({ status, json: failure(status === 409 ? "CONFLICT" : status === 403 ? "FORBIDDEN" : status === 400 ? "VALIDATION_ERROR" : "INTERNAL_ERROR") });
    return r.fulfill({ json: { data: { ...view, status: "FILED", filedAt: "2026-11-10T12:00:00Z" } } });
  });
  await page.goto(path);
  await expect(page.locator('time[datetime="2026-12-09T12:00:00Z"]')).toBeVisible();
  await page.getByLabel("İtiraz gerekçen").fill(reason);
  await page.getByRole("button", { name: "İtirazımı gönder" }).click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("İtiraz gerekçen")).toHaveValue(reason);
  await expect(page.getByText(/Başvurun kaydedildi/)).toHaveCount(0);
  expect(calls).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath(`appeal-${status}.png`), fullPage: true });
  failed = false;
  await page.getByRole("button", { name: "İtirazımı gönder" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Başvurun kaydedildi" })).toBeVisible();
  await expect(page.getByRole("button", { name: "İtirazımı gönder" })).toHaveCount(0);
  expect(calls).toBe(2); expect(mock.unexpected).toEqual([]);
});

for (const status of [401, 403, 404]) test(`appeal read ${status} discloses no private dates or form`, async ({ page }) => {
  const mock = await api(page);
  mock.handlers.set("me.moderationAppeals.get", r => r.fulfill({ status, json: failure(status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : "NOT_FOUND") }));
  await page.goto(path);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator("main time")).toHaveCount(0);
  await expect(page.getByLabel("İtiraz gerekçen")).toHaveCount(0);
  await expect(page.locator("main").getByRole(status === 401 ? "link" : "alert").filter({ hasText: status === 401 ? "Giriş yap" : "erişilebilir değil" })).toBeVisible();
});

test("delayed response blocks resubmit; expiry and filed states come only from API", async ({ page }) => {
  const mock = await api(page); let writes = 0; let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  mock.handlers.set("me.moderationAppeals.get", r => r.fulfill({ json: { data: view } }));
  mock.handlers.set("me.moderationAppeals.file", async r => { writes++; await gate; await r.fulfill({ status: 409, json: failure("CONFLICT") }); });
  await page.goto(path);
  await page.getByLabel("İtiraz gerekçen").fill(reason);
  await page.getByRole("button", { name: "İtirazımı gönder" }).click();
  await expect(page.getByRole("button", { name: "Gönderiliyor…" })).toBeDisabled();
  expect(writes).toBe(1);
  release(); await expect(page.locator("main").getByRole("alert")).toBeVisible();
  mock.handlers.set("me.moderationAppeals.get", r => r.fulfill({ json: { data: { ...view, status: "EXPIRED" } } }));
  await page.getByRole("button", { name: "Durumu tekrar kontrol et" }).click();
  await expect(page.getByRole("status").filter({ hasText: "başvuru süresi dolmuş" })).toBeVisible();
  await expect(page.getByLabel("İtiraz gerekçen")).toHaveCount(0);
  expect(writes).toBe(1);
});

test("ledger shows confirmed refund amount once across overlapping pages, without any credit write", async ({ page }, info) => {
  const mock = await api(page); let moreReads = 0;
  const refund = { ...sample("points.ledger").data[0], reason: "MODERATION_REFUND", delta: 10, balanceAfter: 20 };
  mock.handlers.set("points.ledger", (r, url) => { const more = url.searchParams.has("cursor"); if (more) moreReads++; return r.fulfill({ json: { data: [refund], page: { hasMore: !more, nextCursor: !more ? "next-page" : null } } }); });
  await page.goto("/hesap/puanlar");
  await expect(page.getByText("Moderasyon iadesi · +10 puan", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Daha fazla göster" }).click();
  await expect.poll(() => moreReads).toBe(1);
  await expect(page.getByText("Moderasyon iadesi · +10 puan", { exact: true })).toHaveCount(1);
  await expect(page.getByText("İşlem sonrası bakiye: 20 puan", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("ledger-refund.png"), fullPage: true });
  expect(mock.unexpected).toEqual([]);
});

import { test, expect } from "@playwright/test";
import { api, sample } from "./api";

test("user timeline shows the unified history, sends filters to the API and validates the content id without leaking IP or device data", async ({ page }) => {
  const mock = await api(page);
  const queries: URLSearchParams[] = [];
  mock.handlers.set("admin.users.timeline", route => {
    const url = new URL(route.request().url());
    queries.push(url.searchParams);
    return route.fulfill({ json: sample("admin.users.timeline") });
  });
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Hesabı yönet", exact: true }).first().click();
  const region = page.getByRole("region", { name: "Birleşik geçmiş" });
  await expect(region).toContainText("IP ve cihaz bilgisi gösterilmez");
  await expect(region.getByRole("list", { name: "Olaylar" })).toContainText("Moderasyon kararı");
  await expect(region.getByRole("list", { name: "Olaylar" })).toContainText("Gerekçe: Moderatör incelemesi");
  await expect(region.getByRole("list", { name: "Olaylar" })).toContainText("Hakkında rapor");
  await expect(region.getByLabel("Olay sayıları")).toContainText("Yorum: 12");
  await expect(region).not.toContainText(/\bIP:|User-Agent|cihaz kimliği/i);

  await region.getByLabel("Yorum", { exact: true }).check();
  await region.getByLabel("Yaptırım", { exact: true }).check();
  await region.getByRole("button", { name: "Süz", exact: true }).click();
  await expect.poll(() => queries.at(-1)?.get("kinds")).toBe("COMMENT,SANCTION");

  await region.getByLabel(/İçerik kimliği/).fill("abc");
  await expect(region.getByRole("alert")).toContainText("geçerli bir UUID");
  await expect(region.getByRole("button", { name: "Süz", exact: true })).toBeDisabled();
  await region.getByRole("button", { name: "Süzgeci temizle", exact: true }).click();
  await expect.poll(() => queries.at(-1)?.get("kinds")).toBe(null);
  expect(mock.unexpected).toEqual([]);
});

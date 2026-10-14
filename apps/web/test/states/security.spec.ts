import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { api, failure } from "./api";
import { safeReturnTo } from "../../src/lib/model";

test("MFA status failure cannot open setup; retry loads a usable accessible form", async ({ page }) => {
  const mock = await api(page);
  mock.handlers.set("me.mfa.status", r => r.fulfill({ status: 500, json: failure() }));
  await page.goto("/hesap/guvenlik");
  await expect(page.getByRole("alert").filter({ hasText: "İstek tamamlanamadı" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Doğrulayıcı kurulumunu başlat" })).toHaveCount(0);
  mock.handlers.set("me.mfa.status", r => r.fulfill({ json: { data: { enabled: false, stepUpExpiresAt: null } } }));
  await page.getByRole("button", { name: "Güvenlik durumunu tekrar yükle" }).click();
  await expect(page.getByRole("button", { name: "Doğrulayıcı kurulumunu başlat" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  expect(mock.unexpected).toEqual([]);
});

test("security return path is exact and cannot admit query, child or external destinations", () => {
  expect(safeReturnTo("/hesap/guvenlik")).toBe("/hesap/guvenlik");
  for (const path of ["/hesap/guvenlik?next=//evil.test", "/hesap/guvenlik/other", "//evil.test/hesap/guvenlik"])
    expect(safeReturnTo(path)).toBe("/");
});

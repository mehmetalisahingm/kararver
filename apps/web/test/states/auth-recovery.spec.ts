import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { api, failure, sample } from "./api";

const token = "auth-recovery-browser-test-token-1234567890";

test("missing reset link offers a recovery path and keeps the destination", async ({ page }) => {
  const mock = await api(page);
  let requests = 0;
  mock.handlers.set("auth.password.forgot", route => { requests++; return route.fulfill({ status: 202, json: sample("auth.password.forgot") }); });
  await page.goto("/sifre-yenile?returnTo=%2Fhesap&email=qa%40example.test");
  await expect(page.getByRole("button", { name: "Şifreyi yenile", exact: true })).toBeDisabled();
  await page.getByRole("link", { name: "Yeni şifre sıfırlama bağlantısı iste" }).click();
  await expect(page.getByLabel("E-posta", { exact: true })).toHaveValue("qa@example.test");
  await page.getByRole("button", { name: "Sıfırlama isteği oluştur" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Bu hesap varsa" })).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: "Giriş yap", exact: true })).toHaveAttribute("href", /returnTo=%2Fhesap/);
  expect(requests).toBe(1);
  expect(mock.unexpected).toEqual([]);
});

for (const mode of ["verify", "reset"] as const) test(`${mode}: fragment stays private, explicit confirmation, failure and recovery`, async ({ page }) => {
  const mock = await api(page);
  const path = mode === "verify" ? "/dogrula" : "/sifre-yenile";
  const endpoint = mode === "verify" ? "auth.email.verify" : "auth.password.reset";
  let requests = 0;
  mock.handlers.set(endpoint, route => {
    requests++;
    expect(route.request().postDataJSON().token).toBe(token);
    return route.fulfill({ status: 400, json: failure("TOKEN_INVALID_OR_EXPIRED") });
  });
  await page.goto(`${path}?returnTo=%2Fhesap#token=${token}`);
  await expect(page).toHaveURL(new RegExp(`${path}[?]returnTo=%2Fhesap$`));
  expect(requests).toBe(0);
  if (mode === "reset") await page.getByLabel("Şifre", { exact: true }).fill("New-password-12345");
  await page.getByRole("button", { name: mode === "verify" ? "E-postayı doğrula" : "Şifreyi yenile", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  const recovery = page.getByRole("link", { name: mode === "verify" ? "Hesabımla giriş yap ve yeni doğrulama bağlantısı iste" : "Yeni şifre sıfırlama bağlantısı iste" });
  await expect(recovery).toHaveAttribute("href", /returnTo=%2Fhesap/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  expect(requests).toBe(1);
  expect(mock.unexpected).toEqual([]);
});

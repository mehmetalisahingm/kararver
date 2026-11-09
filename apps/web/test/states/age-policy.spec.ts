import { test, expect } from "@playwright/test";
import { api, sample } from "./api";
import AxeBuilder from "@axe-core/playwright";

test("18+ declaration is keyboard operable, labeled and readable at 2x CSS zoom", async ({ page }) => {
  await api(page);
  await page.goto("/kayit?returnTo=%2Fhesap");
  const checkbox = page.getByRole("checkbox", { name: /18 yaşımı doldurduğumu beyan ediyorum/ });
  const submit = page.getByRole("button", { name: "Hesap oluştur", exact: true });
  await expect(checkbox).toBeEnabled();
  await expect(checkbox).not.toBeChecked();
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await expect(submit).toBeEnabled();
  await page.keyboard.press("Space");
  await expect(checkbox).not.toBeChecked();
  await expect(submit).toBeDisabled();
  await expect(page.locator("main").getByRole("link", { name: "Mevcut hesabımla giriş yap", exact: true })).toHaveAttribute("href", /returnTo=%2Fhesap/);
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
});

test("register requires an explicit 18+ declaration and transmits it to API", async ({ page }) => {
  const mock = await api(page);
  let registrations = 0;
  let declared: unknown = null;

  mock.handlers.set("auth.register", async route => {
    registrations++;
    declared = (await route.request().postDataJSON()).adultConfirmed;
    await route.fulfill({ status: 202, json: sample("auth.register") });
  });

  await page.goto("/kayit");
  const checkbox = page.getByRole("checkbox", { name: /18 yaşımı doldurduğumu beyan ediyorum/ });
  const submit = page.getByRole("button", { name: "Hesap oluştur", exact: true });
  await expect(checkbox).not.toBeChecked();
  await expect(submit).toBeDisabled();

  await page.getByLabel("Görünen ad", { exact: true }).fill("Yaş Testi");
  await page.getByLabel("Kullanıcı adı", { exact: true }).fill("yas_testi");
  await page.getByLabel("E-posta", { exact: true }).fill("yas_testi@example.test");
  await page.getByLabel("Şifre", { exact: true }).fill("Strong-test-password-18");
  await expect(submit).toBeDisabled();
  expect(registrations).toBe(0);

  await checkbox.check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect.poll(() => registrations).toBe(1);
  expect(declared).toBe(true);
});

test("legacy account signs in and explicitly declares 18+ before a participation redirect", async ({ page }) => {
  const mock = await api(page);
  let declared = false;
  let submissions = 0;
  mock.handlers.set("auth.login", async route => {
    const payload = sample("auth.login");
    payload.data.adultDeclarationRequired = true;
    await route.fulfill({ status: 200, json: payload });
  });
  mock.handlers.set("me.get", async route => {
    const payload = sample("me.get");
    payload.data.adultDeclarationRequired = !declared;
    await route.fulfill({ status: 200, json: payload });
  });
  mock.handlers.set("me.adultDeclaration.confirm", async route => {
    submissions++;
    expect(route.request().postDataJSON()).toEqual({ adultConfirmed: true });
    declared = true;
    await route.fulfill({ status: 200, json: { data: { declaredAt: "2026-11-09T19:00:00.000Z" } } });
  });

  await page.goto("/giris?returnTo=%2Folustur");
  await page.getByLabel("E-posta", { exact: true }).fill("older@example.test");
  await page.getByLabel("Şifre", { exact: true }).fill("Old-account-strong-password");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.getByText("Giriş başarılı. Hesabınla oy vermek", { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/\/giris/);
  const declaration = page.getByRole("checkbox", { name: /18 yaşımı doldurduğumu beyan ediyorum/ });
  const submit = page.getByRole("button", { name: "18+ beyanını kaydet ve devam et" });
  await expect(declaration).not.toBeChecked();
  await expect(submit).toBeDisabled();
  expect(submissions).toBe(0);

  await declaration.check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect.poll(() => submissions).toBe(1);
  await expect(page).toHaveURL(/\/olustur/);
  expect(mock.unexpected).toEqual([]);
});

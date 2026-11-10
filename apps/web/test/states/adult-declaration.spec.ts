import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { api, sample, failure } from "./api";

const path = "/hesap/yas-beyani?returnTo=%2Folustur";
for (const fault of ["server", "network", "forbidden"] as const) test(`restored legacy account ${fault}, retry and verified returnTo`, async ({ page }, info) => {
  const mock = await api(page); let declared = false; let failing = true; let writes = 0;
  mock.handlers.set("me.get", r => { const body = sample("me.get"); body.data.adultDeclarationRequired = !declared; return r.fulfill({ json: body }); });
  mock.handlers.set("me.adultDeclaration.confirm", r => {
    writes++; expect(r.request().postDataJSON()).toEqual({ adultConfirmed: true });
    if (failing) return fault === "network" ? r.abort("failed") : r.fulfill({ status: fault === "forbidden" ? 403 : 500, json: failure(fault === "forbidden" ? "FORBIDDEN" : "INTERNAL_ERROR") });
    declared = true; return r.fulfill({ json: { data: { declaredAt: "2026-11-10T12:00:00Z" } } });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/olustur");
  await expect(page.getByRole("heading", { name: "Katılım için 18+ beyanı gerekiyor." })).toBeVisible();
  await page.getByRole("link", { name: "Yaş beyanına git" }).click();
  await expect(page).toHaveURL(new RegExp(path.replace("?", "\\?")));
  const checkbox = page.getByRole("checkbox", { name: "18 yaşımı doldurduğumu beyan ediyorum.", exact: true });
  const submit = page.getByRole("button", { name: "Beyanı kaydet ve devam et", exact: true });
  await expect(checkbox).not.toBeChecked(); await expect(submit).toBeDisabled();
  await checkbox.focus(); await page.keyboard.press("Space"); await submit.click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(checkbox).toBeChecked(); await expect(page).toHaveURL(/yas-beyani/);
  expect(writes).toBe(1);
  expect((await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`adult-${fault}.png`), fullPage: true });
  failing = false; await submit.click();
  await expect(page).toHaveURL(/\/olustur$/);
  await expect(page.getByRole("heading", { name: "Aklında ne var?" })).toBeVisible();
  expect(writes).toBe(2); expect(mock.unexpected).toEqual([]);
});

test("expiry after successful declaration never shows a successful participation redirect", async ({ page }) => {
  const mock = await api(page); let expired = false;
  mock.handlers.set("me.get", r => { if (expired) return r.fulfill({ status: 401, json: failure("UNAUTHENTICATED") }); const body = sample("me.get"); body.data.adultDeclarationRequired = true; return r.fulfill({ json: body }); });
  mock.handlers.set("me.adultDeclaration.confirm", r => { expired = true; return r.fulfill({ json: { data: { declaredAt: "2026-11-10T12:00:00Z" } } }); });
  await page.goto(path);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Beyanı kaydet ve devam et", exact: true }).click();
  await expect(page.getByRole("link", { name: "Yeniden giriş yap", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/yas-beyani/);
});

test("another tab declaration is re-read from API without another write", async ({ page, context }) => {
  let declared = false; let writes = 0;
  const other = await context.newPage();
  for (const tab of [page, other]) {
    const mock = await api(tab);
    mock.handlers.set("me.get", r => { const body = sample("me.get"); body.data.adultDeclarationRequired = !declared; return r.fulfill({ json: body }); });
    mock.handlers.set("me.adultDeclaration.confirm", r => { writes++; declared = true; return r.fulfill({ json: { data: { declaredAt: "2026-11-10T12:00:00Z" } } }); });
    await tab.goto(path);
  }
  await other.getByRole("checkbox").check();
  await other.getByRole("button", { name: "Beyanı kaydet ve devam et", exact: true }).click();
  await expect(other).toHaveURL(/\/olustur$/);
  await page.getByRole("button", { name: "Durumu tekrar kontrol et" }).click();
  await expect(page.getByRole("status").filter({ hasText: "yeni bir yaş beyanı gerekmiyor" })).toBeVisible();
  expect(writes).toBe(1); await other.close();
});

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { api, sample, failure } from "./api";

const token = "synthetic_export_token_for_browser_regression_01";
const key = "kv-data-export-token";

for (const theme of ["light", "dark"]) {
  test(`data export ${theme}: explicit download, network retry, file and invalid-link cleanup`, async ({ page }) => {
    const mock = await api(page);
    let attempts = 0;
    let failed = true;
    mock.handlers.set("dataExports.download", async route => {
      attempts++;
      expect(route.request().postDataJSON()).toEqual({ token });
      await route.fulfill(failed ? { status: 500, json: failure() } : { json: sample("dataExports.download") });
    });
    await page.goto(`/veri-indir#token=${token}`);
    const screen = page.locator("main");
    const button = screen.getByRole("button", { name: "Verilerimi indir", exact: true });
    await expect(button).toBeVisible();
    await expect(page).toHaveURL(/\/veri-indir$/);
    expect(attempts).toBe(0);
    if (await page.locator(".product").getAttribute("data-theme") !== theme)
      await page.getByRole("button", { name: /tema/i }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await button.click();
    await expect(screen.getByRole("alert")).toContainText("Biraz sonra tekrar dene");
    expect(await page.evaluate(k => sessionStorage.getItem(k), key)).toBe(token);
    failed = false;
    const [file] = await Promise.all([
      page.waitForEvent("download"),
      screen.getByRole("button", { name: "Tekrar dene", exact: true }).click(),
    ]);
    expect(file.suggestedFilename()).toMatch(/^kararver-verilerim-\d{4}-\d{2}-\d{2}\.json$/);
    const stream = await file.createReadStream();
    const chunks = [];
    for await (const chunk of stream!) chunks.push(chunk);
    const pkg = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(pkg.schemaVersion).toBe(1);
    expect(pkg.profile).toEqual(sample("dataExports.download").data.profile);
    await expect(screen.getByRole("status").filter({ hasText: "İndirme başladı" })).toBeVisible();
    expect(attempts).toBe(2);
    mock.handlers.set("dataExports.download", r => r.fulfill({ status: 400, json: failure("TOKEN_INVALID_OR_EXPIRED") }));
    await page.reload();
    await screen.getByRole("button", { name: "Verilerimi indir", exact: true }).click();
    await expect(screen.getByRole("alert")).toContainText("Doğru hesapla giriş yaptığından emin ol");
    await expect(screen.getByRole("button", { name: "Tekrar dene", exact: true })).toHaveCount(0);
    expect(await page.evaluate(k => sessionStorage.getItem(k), key)).toBeNull();
    expect(mock.unexpected).toEqual([]);
  });
}

test("data export guest: sign-in continuation keeps token and does not spend a download", async ({ page }) => {
  const mock = await api(page);
  let loggedIn = false;
  let downloads = 0;
  mock.handlers.set("me.get", route => route.fulfill(loggedIn ? { json: sample("me.get") } : { status: 401, json: failure("UNAUTHENTICATED") }));
  mock.handlers.set("auth.login", route => {
    loggedIn = true;
    return route.fulfill({ json: sample("auth.login") });
  });
  mock.handlers.set("dataExports.download", route => { downloads++; return route.fulfill({ json: sample("dataExports.download") }); });
  await page.goto(`/veri-indir#token=${token}`);
  await page.locator("main").getByRole("link", { name: "Giriş yap", exact: true }).click();
  await page.getByLabel("E-posta", { exact: true }).fill("fixture@example.test");
  await page.getByLabel("Şifre", { exact: true }).fill("fixture-password");
  await expect(page.getByLabel("E-posta", { exact: true })).toHaveValue("fixture@example.test");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page).toHaveURL(/\/veri-indir$/);
  await expect(page.getByRole("button", { name: "Verilerimi indir", exact: true })).toBeVisible();
  expect(downloads).toBe(0);
  expect(await page.evaluate(k => sessionStorage.getItem(k), key)).toBe(token);
  expect(mock.unexpected).toEqual([]);
});

test("data export: unavailable session storage retains a fragment link on the current page", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", { get() { throw new DOMException("Storage unavailable", "SecurityError"); } });
  });
  await api(page);
  await page.goto(`/veri-indir#token=${token}`);
  await expect(page.getByRole("button", { name: "Verilerimi indir", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/veri-indir$/);
});

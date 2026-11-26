import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { api, failure, sample } from "./api";

for (const status of [409, 429, 500]) test(`admin HTTP ${status}: no privileged reads until successful role recheck`, async ({ page }, info) => {
  const mock = await api(page);
  let privileged = 0; let signedIn = false;
  mock.handlers.set("auth.login", r => { signedIn = true; return r.fulfill({ json: sample("auth.login") }); });
  mock.handlers.set("me.get", r => {
    if (!signedIn) return r.fulfill({ status: 401, json: failure("UNAUTHENTICATED") });
    return r.fulfill({ status, json: failure(status === 429 ? "RATE_LIMITED" : status === 409 ? "CONFLICT" : "INTERNAL_ERROR") });
  });
  for (const endpoint of ["admin.metrics.get", "admin.ops.status"]) mock.handlers.set(endpoint, r => { privileged++; return r.fulfill({ json: sample(endpoint) }); });
  // Use the normal UI to establish a fixture session before entering admin.
  await page.goto("/giris?returnTo=%2Fadmin");
  await page.getByLabel("E-posta", { exact: true }).fill("release-admin@example.test");
  await page.getByLabel("Şifre", { exact: true }).fill("synthetic-test-password");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Yönetim açılamadı." })).toBeVisible();
  expect(privileged).toBe(0);
  // Explicit role belongs to the isolated response, never to a real account.
  mock.handlers.set("me.get", r => { const body = sample("me.get"); body.data.roles = ["SUPER_ADMIN"]; return r.fulfill({ json: body }); });
  await page.getByRole("button", { name: "Yetkiyi tekrar kontrol et" }).click();
  await expect(page.getByRole("heading", { name: "Yönetim merkezi", exact: true })).toBeVisible();
  await expect.poll(() => privileged).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath(`admin-${status}-recovery.png`), fullPage: true });
  expect(mock.unexpected).toEqual([]);
});

test("critical modal: server failure has no success notice, busy blocks cancellation, Escape restores pointer invoker", async ({ page }, info) => {
  const mock = await api(page);
  const key = "trends.dailyGravityPercent";
  mock.handlers.set("admin.settings.list", r => r.fulfill({ json: { data: [{ key, value: 120, version: 1, updatedAt: "2026-11-01T00:00:00Z", updatedBy: null }] } }));
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  let writes = 0;
  mock.handlers.set("admin.settings.update", async r => { writes++; await gate; await r.fulfill({ status: 500, json: failure() }); });
  await page.goto("/admin/settings");
  const invoker = page.getByRole("row").filter({ hasText: key }).getByRole("button", { name: /değiştir/i });
  // Safari-like pointer activation: a clicked button need not become activeElement.
  await invoker.evaluate(button => button.addEventListener("mousedown", e => e.preventDefault()));
  await invoker.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Değer/).fill("150");
  await dialog.getByLabel("Gerekçe", { exact: true }).fill("İzole regresyon kontrolü");
  await dialog.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Vazgeç" })).toBeDisabled();
  await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
  release();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(writes).toBe(1);
  await expect(page.getByText("Ayar güncellendi.", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include("dialog").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("admin-failed-operation.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(invoker).toBeFocused();
  expect(mock.unexpected).toEqual([]);
});

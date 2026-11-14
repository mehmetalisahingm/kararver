import { test, expect } from "@playwright/test";
import { api, failure, sample } from "./api";

test("timed-out role read recovers; keyboard modal traps focus and Escape returns it", async ({ page }, info) => {
  const mock = await api(page);
  let signedIn = false; let recover = false; let privileged = 0;
  mock.handlers.set("auth.login", r => { signedIn = true; return r.fulfill({ json: sample("auth.login") }); });
  mock.handlers.set("me.get", r => {
    if (!signedIn) return r.fulfill({ status: 401, json: failure("UNAUTHENTICATED") });
    if (!recover) return r.abort("timedout");
    const body = sample("me.get"); body.data.roles = ["SUPER_ADMIN"];
    return r.fulfill({ json: body });
  });
  for (const endpoint of ["admin.metrics.get", "admin.ops.status"]) mock.handlers.set(endpoint, r => { privileged++; return r.fulfill({ json: sample(endpoint) }); });
  await page.goto("/giris?returnTo=%2Fadmin");
  await page.getByLabel("E-posta", { exact: true }).fill("timeout@example.test");
  await page.getByLabel("Şifre", { exact: true }).fill("synthetic-test-password");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Yönetim açılamadı." })).toBeVisible();
  expect(privileged).toBe(0);
  recover = true;
  await page.getByRole("button", { name: "Yetkiyi tekrar kontrol et" }).click();
  await expect(page.getByRole("heading", { name: "Yönetim merkezi", exact: true })).toBeVisible();
  await page.goto("/admin/settings");
  const trigger = page.getByRole("button", { name: /değiştir/i }).first();
  await trigger.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button").last().focus(); await page.keyboard.press("Tab");
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await info.attach("scope", { contentType: "text/plain", body: "Isolated browser timedout abort; no real outage or production request timeout configuration tested. No admin write sent." });
  expect(mock.unexpected).toEqual([]);
});

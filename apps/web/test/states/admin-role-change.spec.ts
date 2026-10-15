import { test, expect } from "@playwright/test";
import { api, sample, failure } from "./api";

test("role change shows the exact target and stops on MFA failure; pending input is locked", async ({ page }) => {
  const mock = await api(page);
  const user = sample("admin.users.get").data;
  let denyMfa = true;
  let mutations = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  mock.handlers.set("me.mfa.stepup", route => denyMfa
    ? route.fulfill({ status: 403, json: failure("FORBIDDEN") })
    : route.fulfill({ json: sample("me.mfa.stepup") }));
  mock.handlers.set("admin.roles.put", async route => {
    mutations++;
    expect(route.request().postDataJSON()).toEqual({ role: "SUPER_ADMIN", reason: "İkinci yönetici tarafından onaylandı", approvalId: "01998b9a-0000-7000-8000-000000000099" });
    await pending;
    await route.fulfill({ status: 403, json: failure("FORBIDDEN") });
  });
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Hesabı yönet", exact: true }).first().click();
  await page.getByRole("button", { name: "Yetkilendir / rolü değiştir" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`Hedef: @${user.username}`);
  await dialog.getByRole("combobox", { name: /^Rol/ }).selectOption("SUPER_ADMIN");
  await expect(dialog).toContainText("Yeni rol: SUPER_ADMIN");
  await expect(dialog).toContainText("en yüksek yönetim yetkisini değiştirir");
  await dialog.getByLabel("İkinci yönetici onay numarası").fill("01998b9a-0000-7000-8000-000000000099");
  await dialog.getByLabel("Gerekçe", { exact: true }).fill("İkinci yönetici tarafından onaylandı");
  await dialog.getByLabel("Doğrulayıcı kodun", { exact: true }).fill("111111");
  await dialog.getByRole("button", { name: "Uygula", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(mutations).toBe(0);
  await expect(dialog.getByLabel("Doğrulayıcı kodun", { exact: true })).toHaveValue("");
  denyMfa = false;
  await dialog.getByLabel("Doğrulayıcı kodun", { exact: true }).fill("123456");
  await dialog.getByRole("button", { name: "Uygula", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: /^Rol/ })).toBeDisabled();
  await expect(dialog.getByRole("textbox", { name: "Gerekçe", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(mutations).toBe(1);
  release();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: /^Rol/ })).toBeEnabled();
  expect(mock.unexpected).toEqual([]);
});

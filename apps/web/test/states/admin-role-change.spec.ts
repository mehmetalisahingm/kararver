import { test, expect } from "@playwright/test";
import { api, sample, failure } from "./api";

test("role change shows the exact target and stops on MFA failure; pending input is locked", async ({ page }) => {
  const mock = await api(page);
  const user = sample("admin.users.get").data;
  // Existing SUPER_ADMIN's demotion still requires the critical-operation risk flow.
  user.roles = ["SUPER_ADMIN"];
  mock.handlers.set("admin.users.get", route => route.fulfill({ json: { data: user } }));
  let denyMfa = true;
  let mutations = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  mock.handlers.set("me.mfa.stepup", route => denyMfa
    ? route.fulfill({ status: 403, json: failure("FORBIDDEN") })
    : route.fulfill({ json: sample("me.mfa.stepup") }));
  mock.handlers.set("admin.roles.put", async route => {
    mutations++;
    expect(route.request().postDataJSON()).toEqual({ role: "ADMIN", reason: "İkinci yönetici tarafından onaylandı", approvalId: "01998b9a-0000-7000-8000-000000000099" });
    await pending;
    await route.fulfill({ status: 403, json: failure("FORBIDDEN") });
  });
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Hesabı yönet", exact: true }).first().click();
  await page.getByRole("button", { name: "Yetkilendir / rolü değiştir" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`Hedef: @${user.username}`);
  await dialog.getByRole("combobox", { name: /^Rol/ }).selectOption("ADMIN");
  await expect(dialog).toContainText("İstenen rol: ADMIN");
  await expect(dialog).toContainText("Kritik işlem: mevcut SUPER_ADMIN rolünü değiştirmek");
  await dialog.getByLabel("İkinci yönetici onay numarası").fill("01998b9a-0000-7000-8000-000000000099");
  await dialog.getByLabel("Gerekçe", { exact: true }).fill("İkinci yönetici tarafından onaylandı");
  await dialog.getByLabel("Doğrulayıcı kodun", { exact: true }).fill("111111");
  await dialog.getByRole("button", { name: "Uygula", exact: true }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Bu işlem için yetkin yok." })).toBeVisible();
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
  await expect(dialog.getByRole("alert").filter({ hasText: "Bu işlem için yetkin yok." })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: /^Rol/ })).toBeEnabled();
  expect(mock.unexpected).toEqual([]);
});

test("single owner: regular user cannot be promoted to SUPER_ADMIN from admin UI", async ({ page }) => {
  const mock = await api(page);
  let attemptedPromotion = 0;
  mock.handlers.set("admin.roles.put", route => {
    if (route.request().postDataJSON().role === "SUPER_ADMIN") attemptedPromotion++;
    return route.fulfill({ status: 403, json: failure("FORBIDDEN") });
  });
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Hesabı yönet", exact: true }).first().click();
  await page.getByRole("button", { name: "Yetkilendir / rolü değiştir" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("option", { name: "SUPER_ADMIN" })).toHaveCount(0);
  await expect(dialog.getByRole("option", { name: "ADMIN" })).toHaveCount(1);
  await expect(dialog).toContainText("Tek süper admin politikası");
  await expect(dialog.getByLabel("İkinci yönetici onay numarası")).toHaveCount(0);
  await expect(dialog.getByLabel("Doğrulayıcı kodun")).toHaveCount(0);
  expect(attemptedPromotion).toBe(0);
  expect(mock.unexpected).toEqual([]);
});

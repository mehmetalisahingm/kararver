import { test, expect } from "@playwright/test";
import { api, sample, failure } from "./api";

test("MFA enrollment shows recovery codes once and recovery failures can retry", async ({ page }) => {
  const mock = await api(page);
  let enabled = false;
  let failRecovery = true;
  let recoveryRequests = 0;
  mock.handlers.set("me.mfa.status", route => route.fulfill({ json: { data: { enabled, stepUpExpiresAt: null } } }));
  mock.handlers.set("me.mfa.confirm", route => {
    enabled = true;
    return route.fulfill({ json: sample("me.mfa.confirm") });
  });
  mock.handlers.set("me.mfa.recover", route => {
    recoveryRequests++;
    return failRecovery ? route.fulfill({ status: 403, json: failure("FORBIDDEN") }) : route.fulfill({ json: sample("me.mfa.recover") });
  });
  await page.goto("/hesap/guvenlik");
  await page.getByLabel("Mevcut şifren", { exact: true }).fill("correct-password123");
  await page.getByRole("button", { name: "Doğrulayıcı kurulumunu başlat" }).click();
  await expect(page.getByText("Doğrulayıcı uygulama anahtarı", { exact: true })).toBeVisible();
  await page.getByLabel("Doğrulama kodu", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Kurulumu doğrula", exact: true }).click();
  await expect(page.getByRole("region", { name: "Kurtarma kodların" })).toBeVisible();
  await expect(page.getByText("Doğrulayıcı uygulama anahtarı", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Kodları sakladım, gizle" }).click();
  await expect(page.getByRole("region", { name: "Kurtarma kodların" })).toHaveCount(0);
  await page.getByRole("button", { name: "Doğrulayıcıma erişemiyorum" }).click();
  await page.getByLabel("Kurtarma için mevcut şifren").fill("correct-password123");
  await page.getByLabel("Kurtarma kodun", { exact: true }).fill("abcdef0123456789abcdef0123456789");
  await page.getByRole("button", { name: "Kurtarma kodunu kullan", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "İstek tamamlanamadı." })).toBeVisible();
  failRecovery = false;
  await page.getByRole("button", { name: "Kurtarma kodunu kullan", exact: true }).click();
  await expect(page.getByText("Kurtarma kodu kullanıldı.", { exact: false })).toBeVisible();
  expect(recoveryRequests).toBe(2);
  expect(mock.unexpected).toEqual([]);
});

test("independent role approval is reviewed before approving", async ({ page }) => {
  const mock = await api(page);
  const approval = sample("admin.roleApprovals.get");
  approval.data.initiatorId = "0199a000-0000-7000-8000-000000000099";
  approval.data.userId = "0199a000-0000-7000-8000-000000000098";
  approval.data.expiresAt = new Date(Date.now() + 600000).toISOString();
  let approved = false;
  mock.handlers.set("admin.roleApprovals.get", route => route.fulfill({ json: { data: { ...approval.data, status: approved ? "APPROVED" : "PENDING" } } }));
  mock.handlers.set("admin.roleApprovals.approve", route => {
    approved = true;
    return route.fulfill({ json: sample("admin.roleApprovals.approve") });
  });
  await page.goto("/hesap/guvenlik");
  await expect(page.getByRole("region", { name: "Kritik rol onayları" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bağımsız incelemeyi MFA ile onayla" })).toHaveCount(0);
  await page.getByLabel("İncelenecek onay numarası").fill(approval.data.id);
  await page.getByRole("button", { name: "Onay talebini incele", exact: true }).click();
  await expect(page.getByRole("region", { name: "Onay talebi ayrıntıları" })).toContainText(approval.data.reason);
  await page.getByRole("button", { name: "Bağımsız incelemeyi MFA ile onayla" }).click();
  await expect(page.getByRole("region", { name: "Onay talebi ayrıntıları" })).toContainText("APPROVED");
  expect(mock.unexpected).toEqual([]);
});

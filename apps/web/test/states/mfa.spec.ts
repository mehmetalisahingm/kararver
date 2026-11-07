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


test("single SUPER_ADMIN: approval form cannot request promotion or approve a legacy promotion", async ({ page }) => {
  const mock = await api(page);
  let requests = 0;
  mock.handlers.set("admin.roleApprovals.request", route => {
    requests++;
    return route.fulfill({ status: 403, json: failure("FORBIDDEN") });
  });
  const target = sample("admin.users.get").data;
  const old = sample("admin.roleApprovals.get");
  old.data.role = "SUPER_ADMIN";
  old.data.expectedRole = "USER";
  old.data.initiatorId = "0199a000-0000-7000-8000-000000000099";
  old.data.userId = "0199a000-0000-7000-8000-000000000098";
  old.data.expiresAt = new Date(Date.now() + 600000).toISOString();
  mock.handlers.set("admin.roleApprovals.get", route => route.fulfill({ json: old }));
  await page.goto("/hesap/guvenlik");
  const rolePanel = page.getByRole("region", { name: "Kritik rol onayları" });
  await expect(rolePanel.getByRole("option", { name: "SUPER_ADMIN" })).toHaveCount(0);
  await expect(rolePanel.getByRole("option", { name: "ADMIN" })).toHaveCount(1);
  await rolePanel.getByLabel("Hedef kullanıcı numarası").fill(old.data.userId);
  await rolePanel.getByLabel("Rol değişimi gerekçesi").fill("Gerekçeli yetki talebi");
  await rolePanel.getByRole("button", { name: "İkinci yöneticiye onay talebi oluştur" }).click();
  await expect(rolePanel.getByRole("alert")).toContainText("yalnız mevcut bir SUPER_ADMIN rolünü düşürmek");
  expect(requests).toBe(0);
  await rolePanel.getByLabel("İncelenecek onay numarası").fill(old.data.id);
  await rolePanel.getByRole("button", { name: "Onay talebini incele" }).click();
  await expect(rolePanel.getByRole("alert")).toContainText("Eski bir SUPER_ADMIN yükseltme talebi");
  await expect(rolePanel.getByRole("button", { name: "Bağımsız incelemeyi MFA ile onayla" })).toHaveCount(0);
  expect(mock.unexpected).toEqual([]);
});

test("authenticator re-enrollment needs step-up, keeps the old authenticator on a wrong code and shows new recovery codes once", async ({ page }) => {
  const mock = await api(page);
  let stepUpExpiresAt: string | null = null;
  let begins = 0;
  let wrongCode = true;
  mock.handlers.set("me.mfa.status", route => route.fulfill({ json: { data: { enabled: true, stepUpExpiresAt } } }));
  mock.handlers.set("me.mfa.stepup", route => {
    stepUpExpiresAt = new Date(Date.now() + 300000).toISOString();
    return route.fulfill({ json: sample("me.mfa.stepup") });
  });
  mock.handlers.set("me.mfa.reenroll.begin", route => {
    begins++;
    if (!stepUpExpiresAt) return route.fulfill({ status: 403, json: failure("FORBIDDEN") });
    stepUpExpiresAt = null;
    return route.fulfill({ json: sample("me.mfa.reenroll.begin") });
  });
  mock.handlers.set("me.mfa.reenroll.confirm", route =>
    wrongCode ? route.fulfill({ status: 403, json: failure("FORBIDDEN") }) : route.fulfill({ json: sample("me.mfa.reenroll.confirm") }));
  await page.goto("/hesap/guvenlik");
  await page.getByRole("button", { name: "Doğrulayıcıyı yenile", exact: true }).click();
  await expect(page.getByText("Bu oturumda geçerli bir yeniden doğrulama yok.")).toBeVisible();
  await page.getByLabel("Yenileme için mevcut şifren").fill("correct-password123");
  await page.getByRole("button", { name: "Yenilemeyi başlat", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "İstek tamamlanamadı." })).toBeVisible();
  await page.getByLabel("Kritik işlem için kodun").fill("123456");
  await page.getByRole("button", { name: "Yeniden doğrula", exact: true }).click();
  await expect(page.getByText("Bu oturumda geçerli bir yeniden doğrulama yok.")).toHaveCount(0);
  await page.getByLabel("Yenileme için mevcut şifren").fill("correct-password123");
  await page.getByRole("button", { name: "Yenilemeyi başlat", exact: true }).click();
  await expect(page.getByText("Yeni doğrulayıcı anahtarı", { exact: true })).toBeVisible();
  await page.getByLabel("Yeni doğrulayıcı kodu", { exact: true }).fill("654321");
  await page.getByRole("button", { name: "Yeni doğrulayıcıyı onayla", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "İstek tamamlanamadı." })).toBeVisible();
  await expect(page.getByText("Yeni doğrulayıcı anahtarı", { exact: true })).toBeVisible();
  wrongCode = false;
  await page.getByRole("button", { name: "Yeni doğrulayıcıyı onayla", exact: true }).click();
  await expect(page.getByRole("region", { name: "Kurtarma kodların" })).toBeVisible();
  await expect(page.getByText("Doğrulayıcın yenilendi.", { exact: false })).toBeVisible();
  await expect(page.getByText("Yeni doğrulayıcı anahtarı", { exact: true })).toHaveCount(0);
  expect(begins).toBe(2);
  expect(mock.unexpected).toEqual([]);
});

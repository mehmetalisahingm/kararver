import { test, expect, type Page } from "@playwright/test";
import { api, failure, sample } from "./api";

async function signIn(page: Page) {
  await page.goto("/giris?returnTo=%2Fadmin");
  await page.getByLabel("E-posta", {exact: true}).fill("root@example.test");
  await page.getByLabel("Şifre", {exact: true}).fill("test-password");
  await page.getByRole("button", {name: "Giriş yap", exact: true}).click();
  await expect(page).toHaveURL(/\/admin$/);
}

for (const status of [401, 403] as const) {
  test(`admin role refresh HTTP ${status} never shows privileged content`, async ({page}) => {
    const mock = await api(page);
    let signedIn = false;
    let roleChecks = 0;
    let privilegedReads = 0;
    mock.handlers.set("auth.login", route => {
      signedIn = true;
      const response = sample("auth.login");
      response.data.roles = ["SUPER_ADMIN"];
      return route.fulfill({json: response});
    });
    mock.handlers.set("me.get", route => {
      if (!signedIn) return route.fulfill({status: 401, json: failure("UNAUTHENTICATED")});
      roleChecks++;
      return route.fulfill({status, json: failure(status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN")});
    });
    for (const endpoint of ["admin.metrics.get", "admin.ops.status"]) {
      mock.handlers.set(endpoint, route => {
        privilegedReads++;
        return route.fulfill({json: sample(endpoint)});
      });
    }

    await signIn(page);
    if (status === 401) {
      await expect(page.getByRole("heading", {name: "Oturumun sona erdi."})).toBeVisible();
      await expect(page.getByRole("link", {name: "Yeniden giriş yap"}))
        .toHaveAttribute("href", "/giris?returnTo=%2Fadmin");
    } else {
      await expect(page.getByRole("heading", {name: "Yönetim erişimi gerekli"})).toBeVisible();
      await expect(page.getByText(/erişimini reddetti \(403\)/)).toBeVisible();
    }
    await expect(page.getByRole("complementary", {name: "Yönetim navigasyonu"})).toHaveCount(0);
    await expect(page.getByText("Gerçek veriler yükleniyor…")).toHaveCount(0);
    expect(roleChecks).toBeGreaterThan(0);
    expect(privilegedReads).toBe(0);
    expect(mock.unexpected).toEqual([]);
  });
}

for (const fault of ["server", "network"] as const) {
  test(`admin role refresh ${fault} failure can retry without showing privileged content`, async ({page}) => {
    const mock = await api(page);
    let signedIn = false;
    let failing = true;
    let privilegedReads = 0;
    mock.handlers.set("auth.login", route => {
      signedIn = true;
      const response = sample("auth.login");
      response.data.roles = ["SUPER_ADMIN"];
      return route.fulfill({json: response});
    });
    mock.handlers.set("me.get", route => {
      if (!signedIn) return route.fulfill({status: 401, json: failure("UNAUTHENTICATED")});
      if (failing) return fault === "network" ? route.abort("failed") : route.fulfill({status: 500, json: failure()});
      const response = sample("me.get");
      response.data.roles = ["SUPER_ADMIN"];
      response.data.avatarUrl = null;
      return route.fulfill({json: response});
    });
    for (const endpoint of ["admin.metrics.get", "admin.ops.status"]) {
      mock.handlers.set(endpoint, route => {
        privilegedReads++;
        return route.fulfill({json: sample(endpoint)});
      });
    }
    await signIn(page);
    await expect(page.getByRole("heading", {name: "Yönetim açılamadı."})).toBeVisible();
    await expect(page.getByRole("complementary", {name: "Yönetim navigasyonu"})).toHaveCount(0);
    expect(privilegedReads).toBe(0);
    failing = false;
    await page.getByRole("button", {name: "Yetkiyi tekrar kontrol et", exact: true}).click();
    await expect(page.getByRole("heading", {name: "Yönetim merkezi", exact: true})).toBeVisible();
    await expect(page.getByRole("complementary", {name: "Yönetim navigasyonu"})).toBeVisible();
    await expect.poll(() => privilegedReads).toBeGreaterThan(0);
    expect(mock.unexpected).toEqual([]);
  });
}

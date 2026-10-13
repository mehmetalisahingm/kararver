import { test, expect } from "@playwright/test";
import { api, failure, sample } from "./api";

for (const status of [401, 403] as const) {
  test(`admin role refresh HTTP ${status} never shows privileged content`, async ({page}) => {
    const mock = await api(page);
    let calls = 0;
    mock.handlers.set("me.get", route => {
      calls += 1;
      if (calls === 1) {
        const signedIn = sample("me.get");
        signedIn.data.roles = ["SUPER_ADMIN"];
        return route.fulfill({json: signedIn});
      }
      return route.fulfill({status, json: failure(status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN")});
    });

    await page.goto("/admin");
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
    expect(mock.unexpected).toEqual([]);
  });
}

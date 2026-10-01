import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("Demo e-posta", { exact: true }).fill(email);
  await page.getByLabel("Demo şifre", { exact: true }).fill("Demo12345!");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
}

test("SUPER_ADMIN sees complete admin navigation and shared patterns", async ({ page }) => {
  await login(page, "umit@example.test");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Yönetim merkezi" })).toBeVisible();
  const nav = page.getByRole("complementary", { name: "Yönetim navigasyonu" });
  for (const label of ["Dashboard", "Kullanıcılar", "İçerikler", "Yorumlar", "Raporlar", "Medya", "Kategoriler", "Topluluklar", "Öne çıkarılanlar", "Ayarlar", "Audit"]) {
    await expect(nav.getByRole("link", { name: new RegExp(label) })).toBeVisible();
  }
  await nav.getByRole("link", { name: /Raporlar/ }).click();
  await expect(page).toHaveURL(/\/admin\/reports$/);
  await expect(page.getByRole("heading", { name: "Raporlar" })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "Örnek işlem" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Vazgeç" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("normal user cannot see admin navigation; backend RBAC remains authority", async ({ page }) => {
  await login(page, "deniz@example.test");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Yönetim erişimi gerekli" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Yönetim navigasyonu" })).toHaveCount(0);
});

test("admin shell is responsive and accessible", async ({ page }) => {
  await login(page, "umit@example.test");
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin/categories");
    await expect(page.getByRole("heading", { name: "Kategoriler" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const report = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(report.violations).toEqual([]);
  }
});

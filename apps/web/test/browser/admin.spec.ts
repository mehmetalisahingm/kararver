import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function loginToAdmin(
  page: import("@playwright/test").Page,
  target: string,
  email: string,
) {
  await page.goto(target);
  await page.locator("main").getByRole("link", { name: "Giriş yap", exact: true }).click();
  await page.getByLabel("Demo e-posta", { exact: true }).fill(email);
  await page.getByLabel("Demo şifre", { exact: true }).fill("Demo12345!");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${target.replaceAll("/", "\\/")}$`));
}

test("SUPER_ADMIN sees complete admin navigation and shared patterns", async ({ page }) => {
  await loginToAdmin(page, "/admin", "umit@example.test");
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
  await loginToAdmin(page, "/admin", "deniz@example.test");
  await expect(page.getByRole("heading", { name: "Yönetim erişimi gerekli" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Yönetim navigasyonu" })).toHaveCount(0);
});

test("admin shell is responsive and accessible", async ({ page }) => {
  await loginToAdmin(page, "/admin/categories", "umit@example.test");
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "Kategoriler" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const report = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(report.violations).toEqual([]);
  }
});

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
async function login(page: Page, email = "umit@example.test") {
  await page.getByLabel("Demo e-posta", { exact: true }).fill(email);
  await page.getByLabel("Demo şifre", { exact: true }).fill("Demo12345!");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
}
test("guest can read; cancel gate stays put; login returns without automatically voting", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Senin için" })).toBeVisible();
  await expect(page.locator("dialog")).not.toBeVisible();
  await page
    .getByRole("link", { name: "Anketi incele", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Sonuçlar oy verdikten sonra görünür."),
  ).toBeVisible();
  await page.getByLabel("Uzaktan çalışma", { exact: true }).check();
  await page.getByRole("button", { name: "Oyumu onayla" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Şimdilik gezinmeye devam et" })
    .click();
  await expect(page).toHaveURL(/\/karar\/calisma-sekli$/);
  await expect(
    page.getByLabel("Uzaktan çalışma", { exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Oyumu onayla" }).click();
  await page.getByRole("link", { name: "Girişe devam et" }).click();
  await login(page);
  await expect(page).toHaveURL(/\/karar\/calisma-sekli$/);
  await expect(
    page.getByRole("button", { name: "Oyumu onayla" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sonuçlar", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Oyumu onayla" }).click();
  await expect(
    page.getByRole("heading", { name: "Sonuçlar", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Toplam 101 oy")).toBeVisible();
});
test("draft survives auth and publish error; explicit confirm debits once", async ({
  page,
}) => {
  await page.goto("/olustur");
  await page
    .getByLabel("Sorun", { exact: true })
    .fill("Bu hafta sonu hangi etkinliğe gitmeliyim?");
  await page.getByLabel("1. seçenek", { exact: true }).fill("Konser");
  await page.getByLabel("2. seçenek", { exact: true }).fill("Tiyatro");
  await page.getByRole("button", { name: "Yayın önizlemesi" }).click();
  await page.getByRole("link", { name: "Girişe devam et" }).click();
  await login(page);
  await expect(page).toHaveURL(/\/olustur$/);
  await expect(page.getByLabel("Sorun", { exact: true })).toHaveValue(
    "Bu hafta sonu hangi etkinliğe gitmeliyim?",
  );
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.locator(".demo-controls summary").click();
  await page.getByRole("button", { name: "Yayın hatası", exact: true }).click();
  await page.getByRole("button", { name: "Yayın önizlemesi" }).click();
  await page.getByRole("button", { name: "10 puan ile yayımla" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "işlem tamamlanamadı",
  );
  await expect(page.locator(".balance")).toHaveText("20 puan");
  await expect(page.getByLabel("1. seçenek", { exact: true })).toHaveValue(
    "Konser",
  );
  await page.getByRole("button", { name: "Yayın önizlemesi" }).click();
  await page.getByRole("button", { name: "10 puan ile yayımla" }).click();
  await expect(page).toHaveURL(/\/karar\/karar-/);
  await expect(page.locator(".balance")).toHaveText("10 puan");
  await expect(
    page.getByRole("heading", {
      name: "Bu hafta sonu hangi etkinliğe gitmeliyim?",
    }),
  ).toBeVisible();
  const createdPath = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "Çıkış", exact: true }).click();
  await expect(page).toHaveURL("/");
  await page
    .getByRole("link", {
      name: "Bu hafta sonu hangi etkinliğe gitmeliyim?",
      exact: true,
    })
    .click();
  await page.getByLabel("Konser", { exact: true }).check();
  await page.getByRole("button", { name: "Oyumu onayla" }).click();
  await page.getByRole("link", { name: "Girişe devam et" }).click();
  await login(page, "deniz@example.test");
  await expect(page).toHaveURL(createdPath);
  await page.getByRole("button", { name: "Oyumu onayla" }).click();
  await expect(page.getByText("Toplam 1 oy")).toBeVisible();
  await expect(page.locator(".balance")).toHaveText("20 puan");
});
test("discussion needs no options; closed and locked voting unavailable", async ({
  page,
}) => {
  await page.goto("/olustur");
  await page.getByLabel("Tartışma / soru", { exact: true }).check();
  await expect(
    page.getByLabel("1. seçenek", { exact: true }),
  ).not.toBeVisible();
  await page
    .getByLabel("Sorun", { exact: true })
    .fill("İlk bisikletim için hangi modeli önerirsiniz?");
  await page.getByRole("button", { name: "Yayın önizlemesi" }).click();
  await page.getByRole("link", { name: "Girişe devam et" }).click();
  await login(page);
  await page.getByRole("button", { name: "Yayın önizlemesi" }).click();
  await page.getByRole("button", { name: "10 puan ile yayımla" }).click();
  await expect(
    page.getByRole("heading", {
      name: "İlk bisikletim için hangi modeli önerirsiniz?",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Oyumu onayla" }),
  ).not.toBeVisible();
  for (const id of ["kapali-anket", "kilitli-anket"]) {
    await page.goto(`/karar/${id}`);
    await expect(page.getByRole("radio").first()).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Oyumu onayla" }),
    ).not.toBeVisible();
  }
});
test("registration verification and password reset flow", async ({ page }) => {
  await page.goto("/kayit");
  await page.getByLabel("Görünen ad").fill("Test Kullanıcı");
  await page.getByLabel("Demo e-posta").fill("yeni@example.test");
  await page.getByLabel("Demo şifre", { exact: true }).fill("Demo12345!");
  await page.getByRole("button", { name: "Demo hesabı oluştur" }).click();
  await page.getByLabel("Demo kodu").fill("000000");
  await page.getByRole("button", { name: "Kodu doğrula" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "geçersiz",
  );
  await page.getByLabel("Demo kodu").fill("123456");
  await page.getByRole("button", { name: "Kodu doğrula" }).click();
  await page
    .locator("main")
    .getByRole("link", { name: "Giriş yap", exact: true })
    .click();
  await page.getByRole("link", { name: "Şifremi unuttum" }).click();
  await page.getByRole("button", { name: "Sıfırlama isteği oluştur" }).click();
  await page.getByRole("link", { name: "Sıfırlama ekranına geç" }).click();
  await page.getByLabel("Yeni demo şifre").fill("NewDemo123!");
  await page.getByLabel("Demo kodu").fill("123456");
  await page.getByRole("button", { name: "Demo şifreyi yenile" }).click();
  await page
    .locator("main")
    .getByRole("link", { name: "Giriş yap", exact: true })
    .click();
  await page.getByLabel("Demo şifre", { exact: true }).fill("NewDemo123!");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.locator(".balance")).toHaveText("20 puan");
});
test("mobile and desktop key screens pass axe; modal Escape and focus return", async ({
  page,
}) => {
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      "/",
      "/giris",
      "/kayit",
      "/dogrula",
      "/sifremi-unuttum",
      "/sifre-yenile",
      "/olustur",
      "/karar/calisma-sekli",
    ]) {
      await page.goto(route);
      await expect(page.locator("main h1").first()).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const report = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(report.violations).toEqual([]);
    }
  }
  await page.getByLabel("Uzaktan çalışma", { exact: true }).check();
  await page.getByRole("button", { name: "Oyumu onayla" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Oyumu onayla" }),
  ).toBeFocused();
});

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

async function login(page: Page, email = "umit@example.test") {
  await page.getByLabel("Demo e-posta", { exact: true }).fill(email);
  await page.getByLabel("Demo şifre", { exact: true }).fill("Demo12345!");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.locator(".balance")).toHaveText("20 puan");
}
async function fail(page: Page, name: string) {
  await page.locator(".demo-controls").evaluate((el: HTMLDetailsElement) => {
    el.open = true;
  });
  await page.getByRole("button", { name, exact: true }).click();
}
async function startSignedIn(page: Page, route = "/karar/ilk-bisiklet") {
  await page.goto(route);
  await page
    .locator("header")
    .getByRole("link", { name: "Giriş yap", exact: true })
    .click();
  await login(page);
  await expect(page.getByLabel("Yorumun", { exact: true })).toBeVisible();
}

test("guest comment survives cancel/login; failed optimistic create rolls back; explicit retry publishes once", async ({
  page,
}) => {
  await page.goto("/karar/ilk-bisiklet");
  await page
    .getByLabel("Yorumun", { exact: true })
    .fill("Kadro boyunu deneyerek seçmeni öneririm.");
  await page.getByRole("button", { name: "Paylaş", exact: true }).click();
  await page
    .getByRole("button", { name: "Şimdilik gezinmeye devam et" })
    .click();
  await expect(page.getByLabel("Yorumun", { exact: true })).toHaveValue(
    "Kadro boyunu deneyerek seçmeni öneririm.",
  );
  await page.getByRole("button", { name: "Paylaş", exact: true }).click();
  await page.getByRole("link", { name: "Girişe devam et" }).click();
  await login(page);
  await expect(page).toHaveURL(/\/karar\/ilk-bisiklet$/);
  await expect(page.getByLabel("Yorumun", { exact: true })).toHaveValue(
    "Kadro boyunu deneyerek seçmeni öneririm.",
  );
  await expect(
    page.getByRole("article", { name: "Ümit yorumu", exact: true }),
  ).toHaveCount(0);
  await fail(page, "Yorum gönderme hatası");
  await page.getByRole("button", { name: "Paylaş", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "geri alındı",
  );
  await expect(
    page.getByRole("article", { name: "Ümit yorumu", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Yorumun", { exact: true })).toHaveValue(
    "Kadro boyunu deneyerek seçmeni öneririm.",
  );
  await page.getByRole("button", { name: "Paylaş", exact: true }).click();
  await expect(page.getByLabel("Yorumun", { exact: true })).toHaveValue("");
  await expect(
    page.getByRole("article", { name: "Ümit yorumu", exact: true }),
  ).toHaveCount(1);
  await expect(page.locator(".balance")).toHaveText("20 puan");
});

test("post/comment reaction rollback, one-level replies, edit and delete failure preserve content", async ({
  page,
}) => {
  await startSignedIn(page);
  const reactions = page.getByRole("group", {
    name: "Gönderiye tepki",
    exact: true,
  });
  await reactions.getByRole("button", { name: "Beğen 0", exact: true }).click();
  await expect(
    reactions.getByRole("button", { name: "Beğen 1", exact: true }),
  ).toBeEnabled();
  await fail(page, "Tepki hatası");
  await reactions
    .getByRole("button", { name: "Beğenme 0", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "geri alındı",
  );
  await expect(
    reactions.getByRole("button", { name: "Beğen 1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await reactions
    .getByRole("button", { name: "Beğenme 0", exact: true })
    .click();
  await expect(
    reactions.getByRole("button", { name: "Beğenme 1", exact: true }),
  ).toBeEnabled();
  await reactions
    .getByRole("button", { name: "Beğenme 1", exact: true })
    .click();
  await expect(
    reactions.getByRole("button", { name: "Beğenme 0", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Yorumun", { exact: true })
    .fill("Önce kısa bir test sürüşü yap.");
  await page.getByRole("button", { name: "Paylaş", exact: true }).click();
  const own = page.getByRole("article", { name: "Ümit yorumu", exact: true });
  await expect(
    own.getByRole("button", { name: "Düzenle", exact: true }),
  ).toBeEnabled();
  await own.getByRole("button", { name: "Yanıtla", exact: true }).click();
  await page
    .getByLabel("Yanıtın", { exact: true })
    .fill("Frenleri de kontrol et.");
  await page.getByRole("button", { name: "Paylaş", exact: true }).click();
  await expect(page.locator(".social-reply")).toContainText(
    "Frenleri de kontrol et.",
  );
  await expect(
    page
      .locator(".social-reply")
      .getByRole("button", { name: "Yanıtla", exact: true }),
  ).toHaveCount(0);
  const root = page
    .locator(".social-comment")
    .filter({ hasText: "Önce kısa bir test sürüşü yap." });
  await root.getByRole("button", { name: "Beğen 0", exact: true }).click();
  await expect(
    root.getByRole("button", { name: "Beğen 1", exact: true }),
  ).toBeEnabled();
  await root.getByRole("button", { name: "Düzenle", exact: true }).click();
  await page
    .getByLabel("Yorumu düzenle", { exact: true })
    .fill("Uzun bir test sürüşü yap.");
  await fail(page, "Yorum düzenleme hatası");
  await page.getByRole("button", { name: "Değişikliği kaydet" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "geri alındı",
  );
  await expect(page.getByLabel("Yorumu düzenle", { exact: true })).toHaveValue(
    "Uzun bir test sürüşü yap.",
  );
  await page.getByRole("button", { name: "Değişikliği kaydet" }).click();
  await expect(page.getByLabel("Yorumu düzenle", { exact: true })).toHaveCount(
    0,
  );
  const edited = page
    .locator(".social-comment")
    .filter({ hasText: "Uzun bir test sürüşü yap." });
  await edited.getByRole("button", { name: "Sil", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Yorumu silmek istiyor musun?" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    edited.getByRole("button", { name: "Sil", exact: true }),
  ).toBeFocused();
  await fail(page, "Yorum silme hatası");
  await edited.getByRole("button", { name: "Sil", exact: true }).click();
  await page.getByRole("button", { name: "Yorumu sil", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "geri alındı",
  );
  await expect(edited).toBeVisible();
  await edited.getByRole("button", { name: "Sil", exact: true }).click();
  await page.getByRole("button", { name: "Yorumu sil", exact: true }).click();
  await expect(
    page.getByText("Bu yorum silindi.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".social-reply")).toContainText(
    "Frenleri de kontrol et.",
  );
});

test("alternatives are separate; account changes hide ownership and another account's unsent draft", async ({
  page,
}) => {
  await startSignedIn(page);
  await page
    .getByRole("button", { name: "Alternatif öner", exact: true })
    .click();
  await page
    .getByLabel("Alternatif önerin", { exact: true })
    .fill("Önce bir bisiklet kiralamayı deneyebilirsin.");
  await page.getByRole("button", { name: "Paylaş", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Alternatifler (1)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("article", { name: "Ümit yorumu", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Yorumun", { exact: true })
    .fill("Bu taslak sadece Ümit hesabında görünmeli.");
  await page.getByRole("button", { name: "Çıkış", exact: true }).click();
  await page
    .locator("header")
    .getByRole("link", { name: "Giriş yap", exact: true })
    .click();
  await login(page, "deniz@example.test");
  await page
    .locator(".app-aside")
    .getByRole("link", { name: "İlk bisikletini seçerken", exact: true })
    .click();
  await expect(page.getByLabel("Yorumun", { exact: true })).toHaveValue("");
  await page
    .getByRole("button", { name: "Alternatifler (1)", exact: true })
    .click();
  const other = page.getByRole("article", { name: "Ümit yorumu", exact: true });
  await expect(
    other.getByRole("button", { name: "Düzenle", exact: true }),
  ).toHaveCount(0);
  await expect(
    other.getByRole("button", { name: "Sil", exact: true }),
  ).toHaveCount(0);
});

test("gallery keyboard controls, load retry, locked and closed states, mobile/light accessibility", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/karar/tatil-rotasi");
    await expect(
      page.getByRole("heading", { name: "Galeri ve bilgiler" }),
    ).toBeVisible();
    await expect(page.getByLabel("Yorumun", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Sonraki görsel", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".gallery-stage figcaption")).toContainText(
      "2 / 4",
    );
    await page
      .getByRole("button", {
        name: "3. görsel: İncelemedeki fotoğraf",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Görsel inceleniyor.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".gallery-stage img")).toHaveCount(0);
    await page
      .getByRole("button", {
        name: "4. görsel: Kaldırılan fotoğraf",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Bu görsel kaldırıldı.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "1. görsel: Kıyı kasabası ve deniz manzarası",
        exact: true,
      })
      .click();
    for (const theme of ["dark", "light"]) {
      if (theme === "light")
        await page
          .getByRole("button", { name: "Açık temaya geç", exact: true })
          .click();
      await expect(page.locator(".product")).toHaveAttribute(
        "data-theme",
        theme,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
    }
  }
  await page.goto("/karar/kilitli-anket");
  await expect(
    page.getByText(
      "Bu içerik kilitli; yorumlar okunabilir, etkileşimler kapalı.",
    ),
  ).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "Gönderiye tepki", exact: true })
      .getByRole("button")
      .first(),
  ).toBeDisabled();
  await page.goto("/karar/kapali-anket");
  await expect(
    page.getByRole("heading", { name: "Sonuçlar", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Yorumun", { exact: true })).toBeEnabled();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".result").first()).toHaveCSS(
    "animation-name",
    "none",
  );
  await fail(page, "Yorum yükleme hatası");
  await page
    .locator(".app-aside")
    .getByRole("link", { name: "İlk bisikletini seçerken", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Yorumlar yüklenemedi." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Yorumları tekrar yükle" }).click();
  await expect(page.getByLabel("Yorumun", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

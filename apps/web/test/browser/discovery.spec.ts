import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
test.use({ hasTouch: true });

async function fail(page: Page, label: string) {
  await page.locator(".demo-controls").evaluate((el: HTMLDetailsElement) => {
    el.open = true;
  });
  await page.getByRole("button", { name: label, exact: true }).click();
}
async function search(page: Page, text: string, type = "polls") {
  await page
    .getByLabel("Ne hakkında düşünüyorsun?", { exact: true })
    .fill(text);
  await page.getByLabel("Arama alanı", { exact: true }).selectOption(type);
  await page.getByRole("button", { name: "Ara", exact: true }).click();
}

test("feed pagination retries preserve items; expired cursor restarts; filters and history reset pages", async ({
  page,
}) => {
  await page.goto("/kesfet");
  const cards = page.locator(".discovery-results > article");
  await expect(cards).toHaveCount(3);
  await fail(page, "Liste devamı hatası");
  await page
    .getByRole("button", { name: "Daha fazla göster", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "işlem tamamlanamadı",
  );
  await expect(cards).toHaveCount(3);
  await page.getByRole("button", { name: "Tekrar dene", exact: true }).click();
  await expect(cards).toHaveCount(6);
  const titles = await cards.locator("h2").allTextContents();
  expect(new Set(titles).size).toBe(6);
  await fail(page, "Liste süresini doldur");
  await page
    .getByRole("button", { name: "Daha fazla göster", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Listeyi baştan yükle", exact: true }),
  ).toBeVisible();
  await expect(cards).toHaveCount(6);
  await page
    .getByRole("button", { name: "Listeyi baştan yükle", exact: true })
    .click();
  await expect(cards).toHaveCount(3);
  await page
    .getByRole("navigation", { name: "Akış sıralaması" })
    .getByRole("link", { name: "Yeni", exact: true })
    .click();
  await expect(cards.first()).toContainText(
    "Spor yapmak için sabah mı akşam mı?",
  );
  await expect(page).toHaveURL(/tab=new/);
  await page
    .getByRole("navigation", { name: "Akış sıralaması" })
    .getByRole("link", { name: "En Çok Oy", exact: true })
    .click();
  await expect(cards.first()).toContainText(
    "Şehir içi ulaşımda bisiklet mi toplu taşıma mı?",
  );
  await page.getByLabel("Kategori", { exact: true }).selectOption("teknoloji");
  await expect(page).toHaveURL(/category=teknoloji/);
  await expect(cards.first()).toContainText(
    "Akşam çalışırken sıcak ışık mı soğuk ışık mı?",
  );
  await expect(cards).toHaveCount(3);
  for (const author of await cards.locator(".author small").allTextContents())
    expect(author).toContain("Teknoloji");
  await expect(page.locator("#main")).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Daha fazla göster", exact: true }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(page.getByLabel("Kategori", { exact: true })).toHaveValue("");
  await expect(cards).toHaveCount(3);
});

test("Turkish search, result types, empty state and category navigation", async ({
  page,
}) => {
  await page.goto("/kesfet");
  await search(page, "a");
  await expect(page.locator("main").getByRole("alert")).toContainText("2–100");
  await search(page, "sicak isik");
  await expect(page.locator(".discovery-results > article")).toHaveCount(1);
  await expect(page.locator(".discovery-results")).toContainText(
    "Akşam çalışırken sıcak ışık mı soğuk ışık mı?",
  );
  await search(page, "isik", "users");
  await expect(
    page.getByRole("heading", { name: "Işık", exact: true }),
  ).toBeVisible();
  await search(page, "rota", "communities");
  await expect(
    page.getByRole("heading", { name: "Rota Arkadaşları", exact: true }),
  ).toBeVisible();
  await search(page, "egitim", "categories");
  await page
    .locator(".discovery-results")
    .getByRole("link", { name: "Eğitim", exact: true })
    .click();
  await expect(page).toHaveURL(/\/kategori\/egitim$/);
  await expect(
    page.getByRole("heading", { name: "Eğitim", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".discovery-results > article")).toHaveCount(1);
  await page.goBack();
  await expect(
    page.getByLabel("Ne hakkında düşünüyorsun?", { exact: true }),
  ).toHaveValue("egitim");
  await search(page, "hiçbulunmayacakbirifade");
  await expect(
    page.getByRole("heading", { name: "Burada henüz bir eşleşme yok." }),
  ).toBeVisible();
  await page.goto("/kategori/bilinmeyen");
  await expect(
    page.getByRole("heading", { name: "Kategori bulunamadı." }),
  ).toBeVisible();
});

test("five trends differ; hidden counts stay hidden; movement has exact dated table and insufficient-history state", async ({
  page,
}) => {
  await page.goto("/yukselenler");
  await expect(page.locator(".trend-results > article")).toHaveCount(3);
  await expect(page.locator(".trend-results > article").first()).toContainText(
    "Sonuçlar gizli.",
  );
  await expect(
    page.locator(".trend-results > article").first().getByRole("img"),
  ).toHaveCount(0);
  const firstTitles = [];
  for (const [value, firstTitle] of [
    ["DAILY_RISING", "Uzaktan mı, ofisten mi daha verimli çalışıyorsun?"],
    ["WEEKLY_RISING", "Bir sonraki tatil için hangi rotayı seçerdin?"],
    ["WEEKLY_MOST_VOTED", "Şehir içi ulaşımda bisiklet mi toplu taşıma mı?"],
    [
      "WEEKLY_MOST_DISCUSSED",
      "İlk bisikletimi alırken nelere dikkat etmeliyim?",
    ],
  ]) {
    await page
      .getByLabel("Trend görünümü", { exact: true })
      .selectOption(value);
    await expect(page).toHaveURL(new RegExp(`format=${value}`));
    await expect(page.locator(".trend-results h2").first()).toHaveText(
      firstTitle,
    );
    await expect(page.locator(".trend-results > article")).toHaveCount(3);
    firstTitles.push(
      await page.locator(".trend-results h2").first().textContent(),
    );
  }
  expect(new Set(firstTitles).size).toBe(4);
  await expect(page.locator(".trend-results > article").first()).toContainText(
    "Bu bir tartışma gönderisi",
  );
  await page
    .getByLabel("Trend görünümü", { exact: true })
    .selectOption("WEEKLY_MOVERS");
  await expect(page.locator(".trend-results > article")).toHaveCount(2);
  const movement = page.locator(".trend-results > article").first();
  await expect(movement).toContainText("+20 yüzde puan");
  await expect(page.locator(".trend-results > article").nth(1)).toContainText(
    "-10 yüzde puan",
  );
  await movement.getByRole("button", { name: "Tablo", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(movement.getByRole("table")).toContainText("21 Eyl 2026");
  await expect(movement.getByRole("table")).toContainText("28 Eyl 2026");
  await expect(movement.getByRole("table")).toContainText("%35");
  await expect(movement.getByRole("table")).toContainText("300");
  await movement.getByRole("button", { name: "Grafik", exact: true }).tap();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(movement.locator(".chart-bar").first()).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.getByLabel("Kategori", { exact: true }).selectOption("seyahat");
  await expect(
    page.getByRole("heading", {
      name: "Karşılaştırma için yeterli geçmiş yok.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("img")).toHaveCount(0);
  await page
    .getByLabel("Trend görünümü", { exact: true })
    .selectOption("DAILY_RISING");
  await page.getByLabel("Kategori", { exact: true }).selectOption("spor");
  await expect(
    page.getByRole("heading", { name: "Bu kategoride henüz trend yok." }),
  ).toBeVisible();
});

test("category, search and trend errors retry without resetting the selected query", async ({
  page,
}) => {
  await page.goto("/kesfet");
  await expect(page.locator(".discovery-results > article")).toHaveCount(3);
  await fail(page, "Kategori hatası");
  await page
    .getByRole("navigation", { name: "Keşif bölümleri" })
    .getByRole("link", { name: "Kategoriler", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Kategorileri tekrar yükle" }).click();
  await expect(page.locator(".category-tile")).toHaveCount(6);
  await page
    .getByRole("navigation", { name: "Keşif bölümleri" })
    .getByRole("link", { name: "Keşfet", exact: true })
    .click();
  await fail(page, "Arama hatası");
  await search(page, "bisiklet");
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(
    page.getByLabel("Ne hakkında düşünüyorsun?", { exact: true }),
  ).toHaveValue("bisiklet");
  await page.getByRole("button", { name: "Tekrar dene", exact: true }).click();
  await expect(page.locator(".discovery-results > article")).toHaveCount(2);
  await fail(page, "Trend hatası");
  await page
    .getByRole("navigation", { name: "Keşif bölümleri" })
    .getByRole("link", { name: "Yükselenler", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Tekrar dene", exact: true }).click();
  await expect(page.locator(".trend-results > article")).toHaveCount(3);
});

test("discovery screens support mobile/desktop, both themes and accessible charts", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const routes = [
    "/kesfet",
    "/kategoriler",
    "/kategori/teknoloji",
    "/kesfet?q=sicak+isik&type=polls",
    ...[
      "DAILY_RISING",
      "WEEKLY_RISING",
      "WEEKLY_MOST_VOTED",
      "WEEKLY_MOST_DISCUSSED",
      "WEEKLY_MOVERS",
    ].map((f) => `/yukselenler?format=${f}`),
  ];
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of routes) {
      await page.goto(route);
      await expect(
        page.locator(".discovery-results, .category-grid, .trend-results"),
      ).toBeVisible();
      for (const theme of ["dark", "light"]) {
        // UI-V2 defaults to light and persists a chosen theme. Tests must verify
        // both modes regardless of the current persisted browser preference.
        if (await page.locator(".product").getAttribute("data-theme") !== theme) {
          await page.getByRole("button", { name: /temaya geç/ }).click();
        }
        await expect(page.locator(".product")).toHaveAttribute(
          "data-theme",
          theme,
        );
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
  }
  expect(errors).toEqual([]);
});

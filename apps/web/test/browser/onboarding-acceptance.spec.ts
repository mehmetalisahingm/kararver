import { test, expect, type Page, type TestInfo, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";

// Keep successful recordings too: these are the #144 visual acceptance artifacts.
test.use({ video: "on", trace: "on" });

async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 30; count++) {
    if (await target.evaluate(element => element === document.activeElement)) {
      await expect(target).toBeFocused();
      const outline = await target.evaluate(element => getComputedStyle(element).outlineStyle);
      expect(outline).not.toBe("none");
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error("Onboarding control was not reachable within 30 Tab presses");
}

async function capture(page: Page, info: TestInfo, scene: string, reduced: boolean) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity
    ).map(animation => animation.finished.catch(() => {})));
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), scene).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations, scene).toEqual([]);
  if (reduced && scene !== "06-login") {
    expect(await page.locator("main").evaluate(element =>
      element.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length
    )).toBe(0);
  }
  const path = info.outputPath(`${scene}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(scene, { path, contentType: "image/png" });
  const layout = await page.evaluate(() => (window as Window & { welcomeLayout?: { supported: boolean; value: number } }).welcomeLayout);
  const evidencePath = info.outputPath(`${scene}-layout.json`);
  await writeFile(evidencePath, JSON.stringify({ scene, viewport: page.viewportSize(), reducedMotion: reduced, layoutShift: layout, browser: page.context().browser()?.version(), environment: "local/CI demo UI, not physical device or staging API acceptance" }, null, 2));
  await info.attach(`${scene}-layout`, { path: evidencePath, contentType: "application/json" });
  if (layout?.supported) expect(layout.value, `${scene}: unexpected layout shift`).toBeLessThanOrEqual(0.1);
}

for (const width of [1440, 360]) {
  for (const reduced of [false, true]) {
    test(`visual acceptance ${width}px ${reduced ? "reduced" : "full"} motion, complete keyboard journey`, async ({ page, browser }, info) => {
      test.setTimeout(120_000);
      info.annotations.push({ type: "environment", description: `${browser.browserType().name()} ${browser.version()}, viewport emulation ${width}px; not a physical device` });
      await page.setViewportSize({ width, height: width === 360 ? 800 : 1000 });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await page.addInitScript(() => {
        const layout = { supported: PerformanceObserver.supportedEntryTypes.includes("layout-shift"), value: 0 };
        (window as Window & { welcomeLayout?: typeof layout }).welcomeLayout = layout;
        if (layout.supported) new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
            if (!shift.hadRecentInput) layout.value += shift.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto("/basla");
      await expect(page.getByRole("button", { name: "Bir karar verelim" })).toBeEnabled();
      await capture(page, info, "01-intro", reduced);
      await tabTo(page, page.getByRole("button", { name: "Bir karar verelim" }));
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "Kararsız kaldığında yalnız değilsin." })).toBeFocused();
      await capture(page, info, "02-value", reduced);
      await tabTo(page, page.getByRole("button", { name: "Kendin dene" }));
      await page.keyboard.press("Enter");
      await capture(page, info, "03-poll", reduced);
      const choice = reduced ? "Yazarım" : "Beklerim";
      await tabTo(page, page.getByRole("button", { name: choice, exact: false }));
      await page.keyboard.press("Space");
      await expect(page.getByText(`SENİN SEÇİMİN · ${choice}`)).toBeVisible();
      await expect(page.getByText("%68", { exact: true })).toBeVisible();
      await expect(page.getByText("%32", { exact: true })).toBeVisible();
      await capture(page, info, "04-result", reduced);
      await tabTo(page, page.getByRole("button", { name: "Keşfetmeye devam et", exact: false }));
      await page.keyboard.press("Enter");
      const interest = page.getByRole("button", { name: /Teknoloji/ });
      await tabTo(page, interest);
      await page.keyboard.press("Space");
      await expect(interest).toHaveAttribute("aria-pressed", "true");
      await capture(page, info, "05-interests", reduced);
      await tabTo(page, page.getByRole("link", { name: /Sana göre olan kararları/ }));
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/giris\?onboarding=1/);
      await expect(page.getByRole("heading", { name: "Fikrin burada bir yer bulsun." })).toBeVisible();
      await expect(page.getByLabel("Demo e-posta", { exact: true })).toBeVisible();
      await capture(page, info, "06-login", reduced);
    });
  }
}

test("skip and signup are keyboard reachable; back preserves interest selection", async ({ page }) => {
  await page.goto("/basla");
  await expect(page.getByRole("button", { name: "Bir karar verelim" })).toBeEnabled();
  await tabTo(page, page.getByRole("link", { name: /Zaten üye misin/ }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/giris\?onboarding=1/);
  await page.goto("/basla");
  await page.getByRole("button", { name: "Bir karar verelim" }).click();
  await page.getByRole("button", { name: "Kendin dene" }).click();
  await page.getByRole("button", { name: "Yazarım", exact: false }).click();
  await page.getByRole("button", { name: /Keşfetmeye devam et/ }).click();
  await page.getByRole("button", { name: /Teknoloji/ }).click();
  await page.getByRole("button", { name: /Geri/ }).click();
  await expect(page.getByText("SENİN SEÇİMİN · Yazarım")).toBeVisible();
  await page.getByRole("button", { name: /Keşfetmeye devam et/ }).click();
  await expect(page.getByRole("button", { name: /Teknoloji/ })).toHaveAttribute("aria-pressed", "true");
  await tabTo(page, page.getByRole("link", { name: "Yeni hesap oluştur", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/kayit\?onboarding=1/);
  await expect(page.getByRole("heading", { name: "Fikrin burada bir yer bulsun." })).toBeVisible();
});

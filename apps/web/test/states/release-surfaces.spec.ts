import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { api, failure } from "./api";

test("release surfaces: keyboard, reduced motion, names, contrast and responsive layout", async ({ page, browser }, info) => {
  test.setTimeout(180000);
  const mock = await api(page);
  mock.handlers.set("me.get", r => r.fulfill({ status: 401, json: failure("UNAUTHENTICATED") }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  const paths = ["/giris", "/kayit", "/kesfet", "/karar/01998b9a-0000-7000-8000-000000000020", "/missing-release", "/yasal"];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    const theme = page.getByRole("button", { name: /temaya geç/ });
    if (await theme.count()) await expect(theme).toHaveAttribute("aria-disabled", "false");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
    const smallTargets = await page.locator("main .kv-button, main button, main input.kv-input, main select").evaluateAll(controls => controls.flatMap(control => {
      const rect = control.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(control).visibility === "hidden") return [];
      return rect.width < 44 || rect.height < 44 ? [{ name: control.getAttribute("aria-label") || control.textContent?.trim(), width: rect.width, height: rect.height }] : [];
    }));
    expect(smallTargets, `${path}: 44px primary control targets`).toEqual([]);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations, path).toEqual([]);
    // Infinite decorative motion must not continue when the user requests less motion.
    expect(await page.locator("main").evaluate(main => main.getAnimations({ subtree: true }).filter(a =>
      a.playState === "running" && a.effect?.getTiming().iterations === Infinity && Number(a.effect.getTiming().duration) > 1).length), path).toBe(0);
    await page.screenshot({ path: info.outputPath(`${path.replaceAll("/", "-") || "home"}.png`), fullPage: true });
  }
  await info.attach("environment", { contentType: "application/json", body: JSON.stringify({ browser: browser.version(), viewport: page.viewportSize(), fixture: true, physicalDevice: false, liveStaging: false }) });
  expect(mock.unexpected).toEqual([]);
});

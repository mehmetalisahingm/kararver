import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

// Playwright's JSX transform targets component testing, not React server rendering.
// Compile the source with React's JSX runtime, as in error-boundaries.test.mjs.
const source = readFileSync(new URL("../../src/app/global-error.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
const compiled = { exports: {} as { default?: (props: { retry: () => void }) => React.ReactNode } };
new Function("require", "module", "exports", outputText)(createRequire(import.meta.url), compiled, compiled.exports);
const GlobalError = compiled.exports.default!;

test("root failure stays usable without the app layout, provider or stylesheet", async ({ page }, info) => {
  // Render the actual fallback document in isolation. This is not a live server 500 test.
  const html = renderToStaticMarkup(createElement(GlobalError, { retry: () => {} }));
  const fixtureUrl = "https://fallback.kararver.test/";
  await page.route(fixtureUrl, route => route.fulfill({ contentType: "text/html", body: `<!doctype html>${html}` }));
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    // A real document origin makes the relative home link navigable (unlike about:blank).
    await page.goto(fixtureUrl);
    await expect(page).toHaveTitle("Kararver yüklenemedi");
    await expect(page.getByRole("alert")).toHaveText("Kararver yüklenemedi.");
    const retry = page.getByRole("button", { name: "Tekrar dene", exact: true });
    const home = page.getByRole("link", { name: "Ana sayfaya dön", exact: true });
    await expect(home).toHaveAttribute("href", "/");
    for (const target of [retry, home]) {
      const box = await target.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press("Tab");
    await expect(retry).toBeFocused();
    await expect(retry).toHaveCSS("outline-style", "solid");
    await expect(retry).toHaveCSS("outline-width", "3px");
    await page.keyboard.press("Tab");
    await expect(home).toBeFocused();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`root-failure-${colorScheme}.png`), fullPage: true });
  }
});

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement as h, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { legalFixture } from "../fixtures/legal";
import { activateLegalBundle, legalLinks, legalRevision } from "../../src/features/legal/model";
import { api, failure } from "./api";

test.use({ actionTimeout: 15000 });

// The approved-content fixture is isolated from published.ts and all app bundles.
const source = readFileSync(new URL("../../src/features/legal/views.tsx", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const compiled = { exports: {} as Record<string, React.ComponentType<any>> };
const require = createRequire(import.meta.url);
new Function("require", "module", "exports", output)((name: string) => name === "./model" ? { legalLinks } : require(name), compiled, compiled.exports);
const { PublicLegalShell, LegalDocumentView, LegalFooter, RegistrationLegalNotice } = compiled.exports;
const css = readFileSync(new URL("../../src/app/legal.css", import.meta.url), "utf8");

test("approved document rendering: versions, contact, keyboard, themes and 2x CSS zoom", async ({ page, context }, info) => {
  const bundle = activateLegalBundle(legalFixture(), new Date("2026-11-01T12:00:00Z"))!;
  await context.route("https://legal.kararver.test/**", route => {
    const parts = new URL(route.request().url()).pathname.split("/");
    const resolved = legalRevision(bundle, parts[2], parts[3]);
    const document = resolved ? h(PublicLegalShell, null, h(LegalDocumentView, { bundle, resolved })) : null;
    const html = renderToStaticMarkup(h(Fragment, null, document, h(LegalFooter, { links: legalLinks(bundle) })));
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Yasal bilgi testi</title><style>body{margin:0}${css}</style></head><body>${html}</body></html>` });
  });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("https://legal.kararver.test/yasal/gizlilik");
    await expect(page.getByRole("heading", { name: "Gizlilik bilgisi", exact: true })).toBeVisible();
    await expect(page.getByText("Sürüm 2.0 · Yayın:", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "legal@example.test", exact: true })).toHaveAttribute("href", "mailto:legal@example.test");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "İçeriğe geç", exact: true })).toBeFocused();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.getByRole("link", { name: "Sürüm 1.0 · 2026-09-01", exact: true }).click();
    await expect(page.getByText("Bu önceki sürümdür.", { exact: false })).toBeVisible();
    await page.getByRole("link", { name: "Güncel metni oku", exact: true }).click();
    await expect(page.getByText("Bu önceki sürümdür.", { exact: false })).toHaveCount(0);
    // Layout emulation only; physical browser zoom and pointer behavior are separate acceptance.
    await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
    expect(await page.evaluate(() => document.querySelector("main")!.getBoundingClientRect().right <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`legal-${colorScheme}-css-zoom-2.png`), fullPage: true });
  }
});

test("registration information links preserve the draft and returnTo in the original tab", async ({ page, context }) => {
  const links = legalLinks(activateLegalBundle(legalFixture(), new Date("2026-11-01T12:00:00Z"))!);
  await context.route("https://legal.kararver.test/**", route => {
    const html = renderToStaticMarkup(h(Fragment, null,
      h(RegistrationLegalNotice, { links }), h("label", null, "Adın", h("input", { id: "draft", defaultValue: "" }))));
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Kayıt testi</title><style>${css}</style></head><body>${html}</body></html>` });
  });
  await page.goto("https://legal.kararver.test/kayit?returnTo=%2Fhesap");
  await page.getByLabel("Adın", { exact: true }).fill("Taslağım korunuyor");
  const popupReady = page.waitForEvent("popup");
  await page.getByRole("link", { name: /Gizlilik bilgisi/ }).click();
  const popup = await popupReady;
  await expect(popup).toHaveURL("https://legal.kararver.test/yasal/gizlilik");
  await expect(page.getByLabel("Adın", { exact: true })).toHaveValue("Taslağım korunuyor");
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/hesap");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await popup.close();
});

test.describe("server-rendered legal document fixture", () => {
  test.use({ javaScriptEnabled: false });
  test("current and historical information stays readable without scripts", async ({ page, context }) => {
    const bundle = activateLegalBundle(legalFixture(), new Date("2026-11-01T12:00:00Z"))!;
    await context.route("https://legal.kararver.test/**", route => {
      const parts = new URL(route.request().url()).pathname.split("/");
      const resolved = legalRevision(bundle, parts[2], parts[3])!;
      const html = renderToStaticMarkup(h(PublicLegalShell, null, h(LegalDocumentView, { bundle, resolved })));
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Statik metin testi</title><style>${css}</style></head><body>${html}</body></html>` });
    });
    await page.goto("https://legal.kararver.test/yasal/gizlilik");
    await expect(page.getByRole("heading", { name: "Gizlilik bilgisi", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Sürüm 1.0 · 2026-09-01", exact: true }).click();
    await expect(page.getByText("Bu önceki sürümdür.", { exact: false })).toBeVisible();
    await page.getByRole("link", { name: "Güncel metni oku", exact: true }).click();
    await expect(page.getByText("Bu önceki sürümdür.", { exact: false })).toHaveCount(0);
  });
});

test.describe("public legal access independent of session API", () => {
  test("unconfigured package stays unpublished rather than rendering draft legal text", async ({ page }) => {
    const mock = await api(page); let sessions = 0;
    mock.handlers.set("me.get", async route => { sessions++; await route.fulfill({ status: 500, json: failure() }); });
    const response = await page.goto("/yasal");
    // Next's parent loading boundary returns 200 for streamed not-found responses.
    expect([200, 404]).toContain(response!.status());
    await expect(page.getByRole("heading", { name: "Bu sayfayı bulamadık.", exact: true })).toBeVisible();
    await expect(page.getByText("Oturum kontrol ediliyor…", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Yasal bilgiler", exact: true })).toHaveCount(0);
    expect(await page.content()).not.toContain("legal@example.test");
    expect(await page.locator('meta[name="robots"][content*="noindex"]').count()).toBeGreaterThan(0);
    expect(sessions).toBe(0);
  });
});

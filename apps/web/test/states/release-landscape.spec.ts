import { test, expect } from "@playwright/test";
import { api, failure } from "./api";

for (const orientation of ["portrait", "landscape"]) {
  for (const theme of ["light", "dark"]) test(`capsule choices fit ${orientation} ${theme}`, async ({page}, info) => {
    const width = info.project.use.viewport!.width;
    const height = width === 390 ? 844 : width === 360 ? 800 : width === 768 ? 1024 : 1000;
    const viewport = orientation === "landscape" ? {width:height,height:width} : {width,height};
    await page.setViewportSize(viewport);
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.addInitScript(value => localStorage.setItem("kararver:theme", value), theme);
    // Exercise the real shell and CSS without starting a WebGL simulation.
    await page.route("**/experiences/cabin/index.html?embed=1", r => r.fulfill({contentType:"text/html",body:"<!doctype html><title>Test cabin</title>"}));
    const mock = await api(page);
    mock.handlers.set("me.get", r => r.fulfill({status:401,json:failure("UNAUTHENTICATED")}));
    await page.goto("/#decision-capsules");
    await expect(page.locator(".product")).toHaveAttribute("data-theme",theme);
    const bay = page.locator(".decision-bay");
    await bay.scrollIntoViewIfNeeded();
    const bounds = await bay.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    const choices = page.locator(".decision-path");
    await expect(choices).toHaveCount(2);
    for (let i=0; i<2; i++) {
      const choice = choices.nth(i);
      await expect(choice).toHaveAttribute("href", i===0?"/kesfet":"/olustur");
      // Focusing the previous card may scroll the document on Chromium.
      const currentBounds = (await bay.boundingBox())!;
      const box = await choice.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(currentBounds.x - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(currentBounds.x + currentBounds.width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(currentBounds.y + currentBounds.height + 1);
      for (const selector of [".decision-number", ".decision-path-title", ".decision-action"]) {
        const text = await choice.locator(selector).boundingBox();
        expect(text!.x).toBeGreaterThanOrEqual(box!.x);
        expect(text!.x + text!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
      }
      // Wait for the opening overlay and require an unobstructed click target.
      await choice.click({trial:true});
      await choice.focus();
      await expect(choice).toBeFocused();
    }
    await page.locator("#decision-capsules").screenshot({path:info.outputPath("capsule-layout.png")});
    expect(mock.unexpected).toEqual([]);
  });
}

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { api, failure, sample } from "./api";

const pollId = sample("polls.get").data.id;

test("report dialog returns focus after pointer opening, Escape and cancel", async ({ page }, info) => {
  const mock = await api(page);
  await page.goto(`/karar/${pollId}`);
  const trigger = page.getByRole("button", { name: "Bu içeriği raporla", exact: true });
  for (const theme of ["light", "dark"]) {
    if (await page.locator(".product").getAttribute("data-theme") !== theme)
      await page.getByRole("button", { name: /temaya geç/ }).click();
    for (const closeWith of ["escape", "cancel"]) {
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "İçeriği raporla", exact: true });
      await expect(dialog).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`report-${theme}-${closeWith}.png`), fullPage: true });
      if (closeWith === "escape") await page.keyboard.press("Escape");
      else await dialog.getByRole("button", { name: "Vazgeç", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
    }
  }
  expect(mock.unexpected).toEqual([]);
});

test("report failure retains the reason and note, retries once and returns focus on success", async ({ page }) => {
  const mock = await api(page);
  let attempts = 0;
  mock.handlers.set("reports.create", async route => {
    attempts++;
    await route.fulfill(attempts === 1
      ? { status: 500, json: failure() }
      : { status: 202, json: sample("reports.create") });
  });
  await page.goto(`/karar/${pollId}`);
  const trigger = page.getByRole("button", { name: "Bu içeriği raporla", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "İçeriği raporla", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: "Neden", exact: true }).selectOption("MISLEADING");
  await dialog.getByLabel("Not (isteğe bağlı)", { exact: true }).fill("Kaynakla uyuşmayan bir bilgi var.");
  await dialog.getByRole("button", { name: "Raporu gönder", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Neden", exact: true })).toHaveValue("MISLEADING");
  await expect(dialog.getByLabel("Not (isteğe bağlı)", { exact: true })).toHaveValue("Kaynakla uyuşmayan bir bilgi var.");
  await dialog.getByRole("button", { name: "Raporu gönder", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(attempts).toBe(2);
  expect(mock.unexpected).toEqual([]);
});

test("guest report opens sign-in with the content destination and returns focus without submitting", async ({ page }) => {
  const mock = await api(page);
  let submissions = 0;
  mock.handlers.set("me.get", route => route.fulfill({ status: 401, json: failure("UNAUTHENTICATED") }));
  mock.handlers.set("reports.create", async route => {
    submissions++;
    await route.fulfill({ status: 202, json: sample("reports.create") });
  });
  await page.goto(`/karar/${pollId}`);
  const trigger = page.getByRole("button", { name: "Bu içeriği raporla", exact: true });
  await trigger.click();
  const gate = page.getByRole("dialog", { name: "Katılmak için giriş yap.", exact: true });
  await expect(gate).toBeVisible();
  await expect(page.getByRole("dialog", { name: "İçeriği raporla", exact: true })).not.toBeVisible();
  const href = await gate.getByRole("link", { name: "Girişe devam et", exact: true }).getAttribute("href");
  expect(new URL(href!, "http://127.0.0.1:3003").searchParams.get("returnTo")).toBe(`/karar/${pollId}`);
  await page.keyboard.press("Escape");
  await expect(gate).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(submissions).toBe(0);
  expect(mock.unexpected).toEqual([]);
});

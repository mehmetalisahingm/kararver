import { test, expect } from "@playwright/test";
import { api } from "./api";

test("composer discloses V1 sensitive respondent restrictions before publication", async ({ page }) => {
  const mock = await api(page);
  await page.goto("/olustur");
  const note = page.getByRole("note");
  await expect(note).toContainText("siyasi görüşünü");
  await expect(note).toContainText("sağlık durumunu");
  await expect(note).toContainText("Genel ürün ve hizmet");
  expect(mock.unexpected).toEqual([]);
});

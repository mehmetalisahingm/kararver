import { test, expect } from "@playwright/test";
import { api, sample } from "./api";

test("a single moderation decision can be undone from the history after a preview; undone decisions offer no second undo", async ({ page }) => {
  const mock = await api(page);
  let undone = 0;
  mock.handlers.set("admin.moderation.actions.undo", route => {
    undone++;
    const body = route.request().postDataJSON();
    expect(body.reason).toBe("Yanlış karar: yorumlar yeniden açılıyor");
    expect(body.digest).toHaveLength(64);
    return route.fulfill({ json: sample("admin.moderation.actions.undo", "ok") });
  });
  await page.goto("/admin/polls");
  await page.getByRole("button", { name: /geçmiş/i }).first().click();
  const history = page.getByRole("dialog");
  const timeline = history.getByRole("list", { name: "Geçmiş, en yeni önce" });
  await expect(timeline).toContainText("geri alındı");
  // Yalnız geri alınmamış, geri alınabilir karar için düğme vardır (örnekte ikisinden biri).
  await expect(timeline.getByRole("button", { name: "Geri al…" })).toHaveCount(1);
  await timeline.getByRole("button", { name: "Geri al…" }).click();
  const dialog = page.getByRole("dialog").last();
  await expect(dialog.getByRole("status")).toContainText("telafi kararı: Yorumları aç");
  await dialog.getByLabel("Gerekçe", { exact: true }).fill("Yanlış karar: yorumlar yeniden açılıyor");
  await dialog.getByRole("button", { name: "Geri al", exact: true }).click();
  await expect(page.getByText(/Karar geri alındı/)).toBeVisible();
  expect(undone).toBe(1);
  expect(mock.unexpected).toEqual([]);
});

test("a blocked decision explains why and cannot be submitted", async ({ page }) => {
  const mock = await api(page);
  let undone = 0;
  mock.handlers.set("admin.moderation.actions.undoPreview", route => route.fulfill({ json: sample("admin.moderation.actions.undoPreview", "superseded") }));
  mock.handlers.set("admin.moderation.actions.undo", route => { undone++; return route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR", message: "x", details: [] }, requestId: "t" } }); });
  await page.goto("/admin/polls");
  await page.getByRole("button", { name: /geçmiş/i }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Geri al…" }).click();
  const dialog = page.getByRole("dialog").last();
  await expect(dialog.getByRole("alert")).toContainText("İçeriğin durumu karardan sonra değişti");
  await dialog.getByLabel("Gerekçe", { exact: true }).fill("Yanlış karar: geri alınıyor");
  await dialog.getByRole("button", { name: "Geri al", exact: true }).click();
  await expect(dialog.getByRole("alert").last()).toContainText("geri alınamıyor");
  expect(undone).toBe(0);
  expect(mock.unexpected).toEqual([]);
});

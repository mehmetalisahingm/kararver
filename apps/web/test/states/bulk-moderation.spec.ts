import { test, expect } from "@playwright/test";
import { api, sample } from "./api";

const DIGEST = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

test("bulk moderation needs a preview, binds the confirmation to its digest and reports a partial failure", async ({ page }) => {
  const mock = await api(page);
  let applied = 0;
  mock.handlers.set("admin.moderation.polls.bulk", route => {
    applied++;
    const body = route.request().postDataJSON();
    expect(body.digest).toBe(DIGEST);
    expect(body.reason).toBe("Toplu moderasyon incelemesi");
    expect(body.action).toBe("HIDE");
    return route.fulfill({ json: sample("admin.moderation.polls.bulk", "ok") });
  });
  await page.goto("/admin/polls");
  await page.getByRole("checkbox", { name: /^Seç:/ }).first().check();
  await expect(page.getByText(/1 anket seçili/)).toBeVisible();
  await page.getByRole("button", { name: /Seçilenlere toplu işlem/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Gerekçe", { exact: true }).fill("Toplu moderasyon incelemesi");
  await dialog.getByRole("button", { name: "Uygula", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("önce önizleme al");
  expect(applied).toBe(0);
  await dialog.getByRole("button", { name: "Önizleme al", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("1 kayıt değişecek");
  await expect(dialog.getByText("Kapsam dışı", { exact: false }).first()).toBeVisible();
  await dialog.getByRole("button", { name: "Uygula", exact: true }).click();
  await expect(page.getByText(/1 uygulandı, 1 değişmedi, 1 başarısız/)).toBeVisible();
  expect(applied).toBe(1);
  expect(mock.unexpected).toEqual([]);
});

test("a stale preview is rejected and must be refreshed before applying again", async ({ page }) => {
  const mock = await api(page);
  let applied = 0;
  mock.handlers.set("admin.moderation.polls.bulk", route => {
    applied++;
    return route.fulfill({ status: 409, json: sample("admin.moderation.polls.bulk", "stale") });
  });
  await page.goto("/admin/polls");
  await page.getByRole("checkbox", { name: /^Seç:/ }).first().check();
  await page.getByRole("button", { name: /Seçilenlere toplu işlem/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Önizleme al", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("1 kayıt değişecek");
  await dialog.getByLabel("Gerekçe", { exact: true }).fill("Toplu moderasyon incelemesi");
  await dialog.getByRole("button", { name: "Uygula", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("önizlemeden sonra değişti");
  expect(applied).toBe(1);
  await expect(dialog.getByRole("button", { name: "Önizleme al", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Uygula", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("önce önizleme al");
  expect(applied).toBe(1);
  expect(mock.unexpected).toEqual([]);
});

test("a batch can be undone from the history: the preview explains blocked decisions and the undo reports the result", async ({ page }) => {
  const mock = await api(page);
  let undone = 0;
  mock.handlers.set("admin.moderation.batches.undo", route => {
    undone++;
    const body = route.request().postDataJSON();
    expect(body.digest).toBe("b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1");
    expect(body.reason).toBe("Yanlış pozitif: kararlar geri alınıyor");
    return route.fulfill({ json: sample("admin.moderation.batches.undo", "ok") });
  });
  await page.goto("/admin/polls");
  await page.getByText("Toplu işlem geçmişi", { exact: true }).click();
  await page.getByRole("button", { name: "Geri al…", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("status").filter({ hasText: "geri alınacak" })).toContainText("1 karar geri alınacak");
  await expect(dialog.getByText(/Araya daha yeni bir karar|İçeriğin durumu sonradan değişti/).first()).toBeVisible();
  await dialog.getByLabel("Gerekçe", { exact: true }).fill("Yanlış pozitif: kararlar geri alınıyor");
  await dialog.getByRole("button", { name: "Geri al", exact: true }).click();
  await expect(page.getByText(/1 karar geri alındı, 0 değişmedi, 1 geri alınamadı/)).toBeVisible();
  expect(undone).toBe(1);
  expect(mock.unexpected).toEqual([]);
});

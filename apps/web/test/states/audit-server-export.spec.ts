import { test, expect, type Page } from "@playwright/test";
import { api, sample } from "./api";

// #185 sunucu export'u: yalnız SUPER_ADMIN görür; tarih aralığı (≤ 31 gün) ister; doğrulayıcı kodu ve gerekçe ister.
const exportFile = { format: "csv", filename: "kararver-audit-2026-10-01_2026-10-16.csv", contentType: "text/csv;charset=utf-8", count: 2, generatedAt: "2026-10-16T09:00:00.000Z", content: "﻿\"id\"\r\n\"a\"\r\n\"b\"" };

async function applyRange(page: Page, from: string, to: string) {
  const form = page.getByRole("search", { name: "Audit süzgeçleri" });
  await form.getByLabel("Başlangıç").fill(from);
  await form.getByLabel("Bitiş").fill(to);
  await form.getByLabel("İşlem", { exact: true }).fill("user.sanction");
  await form.getByRole("button", { name: "Süz" }).click();
}

test("SUPER_ADMIN sunucu export'u: aralık ister, kod ve gerekçeyle indirir, süzgeçleri gönderir", async ({ page }) => {
  const mock = await api(page);
  const calls: string[] = [];
  let exportBody: Record<string, unknown> | null = null;
  mock.handlers.set("me.mfa.stepup", (r) => { calls.push("stepup"); return r.fulfill({ json: sample("me.mfa.stepup") }); });
  mock.handlers.set("admin.audit.export", (r) => { calls.push("export"); exportBody = r.request().postDataJSON(); return r.fulfill({ json: { data: exportFile } }); });
  await page.goto("/admin/audit");

  const group = page.getByRole("group", { name: "Sunucudan audit dışa aktarma" });
  const start = group.getByRole("button", { name: "Süzülen aralığın tamamını sunucudan indir" });
  await expect(start).toBeDisabled();
  await expect(group).toContainText("başlangıç ve bitiş tarihiyle süz");

  await applyRange(page, "2026-09-01", "2026-10-15");
  await expect(start).toBeDisabled();
  await expect(group).toContainText("en çok 31 günlük aralıkta");

  await applyRange(page, "2026-10-01", "2026-10-15");
  await expect(start).toBeEnabled();
  await start.click();
  const dialog = page.getByRole("dialog", { name: "Audit kayıtlarını sunucudan dışa aktar" });
  await expect(dialog).toBeVisible();

  // Kod girilmeden istek gitmez.
  await dialog.getByLabel("Gerekçe").fill("Çeyrek audit denetimi");
  await dialog.getByRole("button", { name: "Doğrula ve indir" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Doğrulayıcı kodunu");
  expect(calls).toEqual([]);

  await dialog.getByLabel("Doğrulayıcı kodun").fill("123456");
  const [file] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Doğrula ve indir" }).click()]);
  expect(file.suggestedFilename()).toBe(exportFile.filename);
  expect(calls).toEqual(["stepup", "export"]);
  expect(exportBody).toMatchObject({ format: "csv", reason: "Çeyrek audit denetimi", action: "user.sanction" });
  expect(Object.keys(exportBody!).sort()).toEqual(["action", "format", "from", "reason", "to"]);
  await expect(dialog).toBeHidden();
  await expect(group.getByRole("status")).toContainText("2 kayıt indirildi");
  expect(mock.unexpected).toEqual([]);
});

test("step-up süresi dolmuşsa hata gösterilir ve kod yeniden istenir; çok kayıt uyarısı okunur", async ({ page }) => {
  const mock = await api(page);
  const forbidden = { error: { code: "FORBIDDEN", message: "Önce doğrulayıcı kodunla kimliğini doğrula.", details: [{ code: "stepup_required" }] }, requestId: "kv185" };
  const tooMany = { error: { code: "VALIDATION_ERROR", message: "Bu aralıkta 10000'den fazla kayıt var; aralığı daralt.", details: [{ code: "too_many_rows" }] }, requestId: "kv185" };
  let reply = tooMany;
  mock.handlers.set("admin.audit.export", (r) => r.fulfill({ status: reply === tooMany ? 400 : 403, json: reply }));
  await page.goto("/admin/audit");
  await applyRange(page, "2026-10-01", "2026-10-15");
  await page.getByRole("button", { name: "Süzülen aralığın tamamını sunucudan indir" }).click();
  const dialog = page.getByRole("dialog", { name: "Audit kayıtlarını sunucudan dışa aktar" });
  await dialog.getByLabel("Gerekçe").fill("Çeyrek audit denetimi");
  await dialog.getByLabel("Doğrulayıcı kodun").fill("123456");
  await dialog.getByRole("button", { name: "Doğrula ve indir" }).click();
  await expect(dialog.getByRole("alert")).toContainText("aralığı daralt");
  // Çok kayıtta step-up harcanmadı: kod yeniden sorulmaz.
  await expect(dialog.getByText("Kod doğrulandı")).toBeVisible();

  reply = forbidden;
  await dialog.getByRole("button", { name: "Doğrula ve indir" }).click();
  await expect(dialog.getByRole("alert")).toContainText("doğrulayıcı kodunla");
  await expect(dialog.getByLabel("Doğrulayıcı kodun")).toHaveValue("");
  expect(mock.unexpected).toEqual([]);
});

test("ADMIN sunucu export'unu görmez; yüklenen kayıt export'u kalır", async ({ page }) => {
  const mock = await api(page);
  mock.handlers.set("me.get", (r) => { const body = sample("me.get"); body.data.avatarUrl = null; body.data.roles = ["ADMIN"]; return r.fulfill({ json: body }); });
  await page.goto("/admin/audit");
  await expect(page.getByRole("group", { name: "Audit dışa aktarma" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Sunucudan audit dışa aktarma" })).toHaveCount(0);
  expect(mock.unexpected).toEqual([]);
});

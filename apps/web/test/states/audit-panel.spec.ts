import { test, expect } from "@playwright/test";
import { api, sample } from "./api";

// #185: kayıt alanları (gerekçe, önce/sonra) yönetici dışından gelen metin içerebilir; ekran HTML yorumlamaz.
const SCRIPT = "<script>window.__xss=1</script>";
const IMG = '<img src=x onerror="window.__xss=2">';

test("audit gerekçesi ve önce/sonra XSS içeriği metin olarak görünür, çalışmaz; fark tablosu erişilebilir", async ({ page }) => {
  const mock = await api(page);
  const body = sample("admin.audit.list");
  body.data[0] = { ...body.data[0], reason: `Spam ${SCRIPT} ${IMG}`, before: { status: "ACTIVE", note: SCRIPT, removedField: "eski" }, after: { status: "SUSPENDED", note: IMG, profile: { bio: IMG } } };
  mock.handlers.set("admin.audit.list", (r) => r.fulfill({ json: body }));
  const dialogs: string[] = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });

  await page.goto("/admin/audit");
  const table = page.getByRole("table", { name: "Audit kayıtları, en yeni önce" });
  await expect(table.getByText(`Spam ${SCRIPT} ${IMG}`)).toBeVisible();
  await table.getByRole("button", { name: "Göster" }).first().click();

  const diff = page.getByRole("table", { name: "Önce ve sonra arasındaki alan farkları" });
  await expect(diff.getByRole("columnheader")).toHaveText(["Alan", "Değişim", "Önce", "Sonra"]);
  const row = (path: string) => diff.getByRole("row").filter({ has: page.getByRole("rowheader", { name: path }) });
  await expect(row("status")).toContainText("Değişti");
  await expect(row("status")).toContainText("ACTIVE");
  await expect(row("status")).toContainText("SUSPENDED");
  await expect(row("removedField")).toContainText("Kaldırıldı");
  await expect(row("profile.bio")).toContainText("Eklendi");
  await expect(row("note").getByRole("cell").nth(1)).toHaveText(SCRIPT);
  await expect(row("note").getByRole("cell").nth(2)).toHaveText(IMG);

  // Ham JSON de metin; yük hiçbir yerde çalışmadı ve DOM'a eleman olarak girmedi.
  await page.getByText("Önce/sonra JSON").click();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(await page.locator("main img[src='x'], main script").count()).toBe(0);
  expect(dialogs).toEqual([]);
  expect(mock.unexpected).toEqual([]);
});

test("gerekçede ara: tarih aralığı yoksa uyarı verir ve istek göndermez; aralıkla requestId ve reasonContains gider", async ({ page }) => {
  const mock = await api(page);
  const queries: URLSearchParams[] = [];
  mock.handlers.set("admin.audit.list", (r, url) => { queries.push(url.searchParams); return r.fulfill({ json: sample("admin.audit.list") }); });
  await page.goto("/admin/audit");
  await expect(page.getByRole("table", { name: "Audit kayıtları, en yeni önce" })).toBeVisible();
  const form = page.getByRole("search", { name: "Audit süzgeçleri" });
  const before = queries.length;

  await form.getByLabel("Gerekçede ara").fill("spam");
  await form.getByRole("button", { name: "Süz" }).click();
  await expect(form.getByRole("alert")).toContainText("başlangıç ve bitiş tarihi");
  await expect(form.getByLabel("Gerekçede ara")).toHaveAttribute("aria-invalid", "true");
  expect(queries.length).toBe(before);

  await form.getByLabel("Başlangıç").fill("2026-10-01");
  await form.getByLabel("Bitiş").fill("2026-10-15");
  await form.getByLabel("İstek kimliği").fill("req-185");
  await form.getByRole("button", { name: "Süz" }).click();
  await expect.poll(() => queries.length).toBeGreaterThan(before);
  const last = queries[queries.length - 1]!;
  expect([last.get("reasonContains"), last.get("requestId"), !!last.get("from"), !!last.get("to")]).toEqual(["spam", "req-185", true, true]);
  await expect(form.getByRole("alert")).toHaveCount(0);
  expect(mock.unexpected).toEqual([]);
});

// #185: tarayıcı başka saat dilimindeyken de gün sınırları seçilen dilime göre hesaplanır.
test.describe("sonuç ve zaman dilimi süzgeci", () => {
  test.use({ timezoneId: "America/New_York" });

  test("outcome gider; gün sınırları ve saatler seçilen dilimde (tarayıcı diliminden bağımsız)", async ({ page }) => {
    const mock = await api(page);
    const queries: URLSearchParams[] = [];
    const body = sample("admin.audit.list");
    body.data[0] = { ...body.data[0], action: "account.mfa", operation: "deny", outcome: "DENIED", createdAt: "2026-10-24T12:00:00.000Z" };
    mock.handlers.set("admin.audit.list", (r, url) => { queries.push(url.searchParams); return r.fulfill({ json: body }); });
    await page.goto("/admin/audit");
    const table = page.getByRole("table", { name: "Audit kayıtları, en yeni önce" });
    await expect(table.getByRole("columnheader", { name: "Zaman (TR)" })).toBeVisible();
    await expect(table.getByRole("row").nth(1)).toContainText("15:00 TR");
    await expect(table.getByRole("row").nth(1)).toContainText("Engellendi");

    const form = page.getByRole("search", { name: "Audit süzgeçleri" });
    await form.getByLabel("Sonuç").selectOption({ label: "Engellendi" });
    await form.getByLabel("Başlangıç").fill("2026-10-24");
    await form.getByLabel("Bitiş").fill("2026-10-24");
    const before = queries.length;
    await form.getByRole("button", { name: "Süz" }).click();
    await expect.poll(() => queries.length).toBeGreaterThan(before);
    let last = queries[queries.length - 1]!;
    expect([last.get("outcome"), last.get("from"), last.get("to")]).toEqual(["DENIED", "2026-10-23T21:00:00.000Z", "2026-10-24T21:00:00.000Z"]);

    await form.getByLabel("Zaman dilimi").selectOption("UTC");
    const beforeUtc = queries.length;
    await form.getByRole("button", { name: "Süz" }).click();
    await expect.poll(() => queries.length).toBeGreaterThan(beforeUtc);
    last = queries[queries.length - 1]!;
    expect([last.get("from"), last.get("to")]).toEqual(["2026-10-24T00:00:00.000Z", "2026-10-25T00:00:00.000Z"]);
    await expect(table.getByRole("columnheader", { name: "Zaman (UTC)" })).toBeVisible();
    await expect(table.getByRole("row").nth(1)).toContainText("12:00 UTC");
    expect(mock.unexpected).toEqual([]);
  });
});

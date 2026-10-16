import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { api, sample, failure } from "./api";

test("operations: error retry, unknown data, keyboard table and permission failure", async ({ page }, info) => {
  const mock = await api(page);
  mock.handlers.set("admin.ops.status", r => r.fulfill({ status: 500, json: failure() }));
  await page.goto("/admin");
  const panel = page.getByRole("region", { name: "Operasyon durumu", exact: true });
  await expect(panel.getByRole("alert")).toContainText("Operasyon verileri yüklenemedi");
  const body = sample("admin.ops.status");
  body.data.components.database = { status: "unknown", latencyMs: null, version: null };
  body.data.http.errorRate = null;
  body.data.http.latencyMs = null;
  mock.handlers.set("admin.ops.status", r => r.fulfill({ json: body }));
  await panel.getByRole("button", { name: "Operasyonu tekrar dene" }).click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.getByRole("article").filter({ has: page.getByRole("heading", { name: "Veritabanı", exact: true }) })).toContainText("Gecikme: Ölçüm yok");
  await expect(panel.getByRole("article").filter({ has: page.getByRole("heading", { name: "API hata oranı", exact: true }) })).toContainText("Ölçüm yok");
  const security = panel.getByRole("article").filter({ has: page.getByRole("heading", { name: "Güvenlik olayları (bütün sunucular)", exact: true }) });
  await expect(security).toContainText("Şu an kilitli giriş: 1 e-posta · 0 IP");
  await expect(security.getByRole("row", { name: /user\.sanction apply 3/ })).toBeVisible();
  const table = panel.getByRole("region", { name: "İş kuyrukları tablosu" });
  await table.focus();
  await expect(table).toBeFocused();
  expect((await new AxeBuilder({ page }).include('[aria-label="Operasyon durumu"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("operations-verified.png"), fullPage: true });
  mock.handlers.set("admin.ops.status", r => r.fulfill({ status: 403, json: failure("FORBIDDEN") }));
  await panel.getByRole("button", { name: "Operasyon verilerini yenile" }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.getByRole("region", { name: "İş kuyrukları tablosu" })).toHaveCount(0);
  expect(mock.unexpected).toEqual([]);
});

test("ADMIN dashboard never requests SUPER_ADMIN operations", async ({ page }) => {
  const mock = await api(page);
  const user = sample("me.get");
  user.data.roles = ["ADMIN"];
  user.data.avatarUrl = null;
  mock.handlers.set("me.get", r => r.fulfill({ json: user }));
  let requests = 0;
  mock.handlers.set("admin.ops.status", r => { requests++; return r.fulfill({ status: 403, json: failure("FORBIDDEN") }); });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Yönetim merkezi" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Günlük oy hareketi", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Operasyon durumu", exact: true })).toHaveCount(0);
  expect(requests).toBe(0);
});

test("operations: older API responses keep the panel usable without new security fields", async ({ page }) => {
  const mock = await api(page);
  const body = sample("admin.ops.status");
  delete body.data.security.lockedLogins;
  delete body.data.security.adminActions24h;
  mock.handlers.set("admin.ops.status", r => r.fulfill({ json: body }));
  await page.goto("/admin");
  const panel = page.getByRole("region", { name: "Operasyon durumu", exact: true });
  const security = panel.getByRole("article").filter({ hasText: "Güvenlik olayları (bütün sunucular)" });
  await expect(security).toContainText("Şu an kilitli giriş: Ölçüm yok");
  await expect(security).toContainText("Kritik yönetici işlemleri: Ölçüm yok");
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.getByRole("region", { name: "İş kuyrukları tablosu" })).toBeVisible();
  expect(mock.unexpected).toEqual([]);
});

test("operations: security events without DB data say unknown, not zero", async ({ page }) => {
  const mock = await api(page);
  const body = sample("admin.ops.status");
  body.data.security.lockedLogins = null;
  body.data.security.adminActions24h = null;
  mock.handlers.set("admin.ops.status", r => r.fulfill({ json: body }));
  await page.goto("/admin");
  const security = page.getByRole("region", { name: "Operasyon durumu", exact: true }).getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Güvenlik olayları (bütün sunucular)", exact: true }) });
  await expect(security).toContainText("Şu an kilitli giriş: Ölçüm yok");
  await expect(security).toContainText("Kritik yönetici işlemleri: Ölçüm yok");
  await expect(security.getByRole("table")).toHaveCount(0);
  expect(mock.unexpected).toEqual([]);
});

test("operations: emergency switches show state, last change and propagation; unknown without data", async ({ page }) => {
  const mock = await api(page);
  const body = sample("admin.ops.status");
  mock.handlers.set("admin.ops.status", r => r.fulfill({ json: body }));
  await page.goto("/admin");
  const panel = page.getByRole("region", { name: "Operasyon durumu", exact: true });
  const table = panel.getByRole("region", { name: "Acil durum anahtarları tablosu" });
  await expect(table.getByRole("row", { name: /Yorumlar Kapalı \(acil durum\)/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /Bakım modu Kapalı Hiç değiştirilmedi/ })).toBeVisible();
  await expect(panel).toContainText("en geç 5 sn içinde bütün sunuculara yayılır");
  await table.focus();
  await expect(table).toBeFocused();

  body.data.switches = null;
  await panel.getByRole("button", { name: "Operasyon verilerini yenile" }).click();
  await expect(panel).toContainText("Anahtar durumu: Ölçüm yok");
  await expect(panel.getByRole("region", { name: "Acil durum anahtarları tablosu" })).toHaveCount(0);
  expect(mock.unexpected).toEqual([]);
});

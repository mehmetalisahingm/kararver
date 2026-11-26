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

test("#185 güvenlik alarmları: açık önce, önem/durum metinle, kapsam ve ilk adım; alarm yoksa ve ölçüm yoksa ayrı metin", async ({ page }) => {
  const mock = await api(page);
  const body = sample("admin.ops.status");
  body.data.security.alerts = [
    { id: "0192f0e0-0000-7000-8000-0000000000a2", rule: "mfa.lock.wave", severity: "HIGH", status: "RESOLVED", actor: null, peakCount: 6, openedAt: "2026-10-26T09:00:00.000Z", lastSeenAt: "2026-10-26T09:05:00.000Z", resolvedAt: "2026-10-26T09:20:00.000Z" },
    { id: "0192f0e0-0000-7000-8000-0000000000a1", rule: "role.change.burst", severity: "CRITICAL", status: "OPEN", actor: { id: "0192f0e0-0000-7000-8000-000000000001", username: "deniz", displayName: "Deniz", avatarUrl: null }, peakCount: 4, openedAt: "2026-10-26T12:00:00.000Z", lastSeenAt: "2026-10-26T12:05:00.000Z", resolvedAt: null },
  ];
  mock.handlers.set("admin.ops.status", r => r.fulfill({ json: body }));
  await page.goto("/admin#guvenlik-alarmlari");
  const panel = page.getByRole("region", { name: "Operasyon durumu", exact: true });
  const card = panel.getByRole("article", { name: "Güvenlik alarmları" });
  await expect(card.getByRole("status")).toHaveText("1 açık alarm var.");
  const rows = card.getByRole("region", { name: "Güvenlik alarmları tablosu" }).getByRole("row");
  await expect(rows.nth(1)).toContainText("Kısa sürede çok rol değişikliği");
  await expect(rows.nth(1)).toContainText("Kritik");
  await expect(rows.nth(1)).toContainText("Açık");
  await expect(rows.nth(1)).toContainText("Deniz @deniz");
  await expect(rows.nth(1)).toContainText("4 (eşik 3 / 15 dk)");
  await expect(rows.nth(1)).toContainText("oturumlarını kapatıp rolleri geri al");
  await expect(rows.nth(2)).toContainText("Çok hesapta MFA kilitlenmesi");
  await expect(rows.nth(2)).toContainText("Kapandı");
  await expect(rows.nth(2)).toContainText("Genel");
  expect((await new AxeBuilder({ page }).include("#guvenlik-alarmlari").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);

  body.data.security.alerts = [];
  await panel.getByRole("button", { name: "Operasyon verilerini yenile" }).click();
  await expect(card.getByRole("status")).toHaveText("Açık alarm yok.");
  await expect(card.getByRole("region", { name: "Güvenlik alarmları tablosu" })).toHaveCount(0);

  body.data.security.alerts = null;
  await panel.getByRole("button", { name: "Operasyon verilerini yenile" }).click();
  await expect(card).toContainText("Alarm durumu: Ölçüm yok");
  expect(mock.unexpected).toEqual([]);
});

test("#185 dilim 2: alarm gerekçeyle incelendi olarak işaretlenir; işaret metinle görünür, alarm açık kalır", async ({ page }) => {
  const mock = await api(page);
  const body = sample("admin.ops.status");
  const deniz = { id: "0192f0e0-0000-7000-8000-000000000001", username: "deniz", displayName: "Deniz", avatarUrl: null };
  const root = { id: "0192f0e0-0000-7000-8000-000000000009", username: "mehmet", displayName: "Mehmet", avatarUrl: null };
  const open = { id: "0192f0e0-0000-7000-8000-0000000000b1", rule: "admin.forbidden.burst", severity: "HIGH", status: "OPEN", actor: deniz, peakCount: 12, openedAt: "2026-10-29T12:00:00.000Z", lastSeenAt: "2026-10-29T12:05:00.000Z", resolvedAt: null, acknowledgedAt: null, acknowledgedBy: null };
  body.data.security.alerts = [open];
  mock.handlers.set("admin.ops.status", r => r.fulfill({ json: body }));
  const acks: unknown[] = [];
  mock.handlers.set("admin.securityAlerts.ack", (r, url) => {
    acks.push({ path: url.pathname, body: r.request().postDataJSON() });
    const acked = { ...open, acknowledgedAt: "2026-10-29T12:10:00.000Z", acknowledgedBy: root };
    body.data.security.alerts = [acked];
    return r.fulfill({ json: { data: acked } });
  });
  await page.goto("/admin");
  const card = page.getByRole("region", { name: "Operasyon durumu", exact: true }).getByRole("article", { name: "Güvenlik alarmları" });
  await expect(card).toContainText("Bir hesap yetkisi olmayan yönetici uçlarını deniyor");
  await card.getByRole("button", { name: "İncelendi olarak işaretle: Bir hesap yetkisi olmayan yönetici uçlarını deniyor" }).click();
  const dialog = page.getByRole("dialog", { name: "Alarmı incelendi olarak işaretle" });
  await expect(dialog).toContainText("İşaret alarmı kapatmaz");
  await dialog.getByLabel("Gerekçe").fill("Destek ekibi rol testini doğruladı");
  await dialog.getByRole("button", { name: "İncelendi olarak işaretle" }).click();
  await expect(page.getByRole("region", { name: "Operasyon durumu", exact: true }).getByRole("status").filter({ hasText: "Alarm incelendi olarak işaretlendi." })).toBeVisible();
  const row = card.getByRole("region", { name: "Güvenlik alarmları tablosu" }).getByRole("row").nth(1);
  await expect(row).toContainText("İncelendi: Mehmet");
  await expect(row).toContainText("Açık");
  await expect(card.getByRole("button", { name: /İncelendi olarak işaretle/ })).toHaveCount(0);
  expect(acks).toEqual([{ path: "/v1/admin/security-alerts/0192f0e0-0000-7000-8000-0000000000b1/ack", body: { reason: "Destek ekibi rol testini doğruladı" } }]);
  expect(mock.unexpected).toEqual([]);
});

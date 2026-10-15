// #187: yönetim ekranı rol × bölüm matrisi, panel başına 500/retry ve klavye. Menüyü gizlemek güvenlik değildir;
// backend yetki matrisi apps/api/test/permission-matrix.test.ts'tedir. Mobil (360px) proje aynı testleri tekrar koşar.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { endpoints } from "@kararver/contracts";
import { examples } from "@kararver/contracts/fixtures";
import { api, empty, failure, sample } from "./api";

type Role = "USER" | "MODERATOR" | "ADMIN" | "SUPER_ADMIN";
const ALL = ["Dashboard", "Kullanıcılar", "İçerikler", "Yorumlar", "Raporlar", "Medya", "Kategoriler", "Topluluklar", "Öne çıkarılanlar", "Ayarlar", "Audit"];
const MODERATION = ["İçerikler", "Yorumlar", "Raporlar", "Medya", "Topluluklar"];
const SECTIONS = ["/admin", "/admin/users", "/admin/polls", "/admin/comments", "/admin/reports", "/admin/media", "/admin/categories", "/admin/communities", "/admin/featured", "/admin/settings", "/admin/audit"];
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();

async function as(page: Page, role: Role) {
  const mock = await api(page);
  mock.handlers.set("me.get", (r) => {
    const body = sample("me.get");
    body.data.avatarUrl = null;
    body.data.roles = [role];
    return r.fulfill({ json: body });
  });
  const requested: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.port === "4012" && request.method() !== "OPTIONS") requested.push(`${request.method()} ${url.pathname}`);
  });
  return { ...mock, requested };
}

const nav = (page: Page) => page.getByRole("complementary", { name: "Yönetim navigasyonu" });
const navLabels = (page: Page) => nav(page).getByRole("link").locator("strong").allTextContents();

test("USER: yönetim menüsü yok, erişim gerekli ekranı", async ({ page }) => {
  await as(page, "USER");
  for (const path of ["/admin", "/admin/settings"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Yönetim erişimi gerekli" })).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
  }
});

for (const [role, expected] of [["MODERATOR", MODERATION], ["ADMIN", ALL], ["SUPER_ADMIN", ALL]] as const) {
  test(`${role}: yalnız yetkili menüyü görür`, async ({ page }) => {
    await as(page, role);
    await page.goto("/admin/reports");
    await expect(page.getByRole("heading", { name: "Raporlar" })).toBeVisible();
    await expect.poll(() => navLabels(page)).toEqual([...expected]);
    await expect(nav(page).getByText(`Rol: ${role}`)).toBeVisible();
  });
}

test("operasyon paneli yalnız SUPER_ADMIN dashboard'unda", async ({ page }) => {
  const mock = await as(page, "ADMIN");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Yönetim merkezi" })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Operasyon durumu" })).toHaveCount(0);
  expect(mock.requested.filter((r) => r.endsWith("/v1/admin/ops"))).toEqual([]);

  const root = await as(page, "SUPER_ADMIN");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Operasyon durumu" })).toBeVisible();
  // İstek başlık çizildikten sonra useEffect içinde gider; yavaş tarayıcıda kayıt birkaç ms gecikebilir.
  await expect.poll(() => root.requested.some((r) => r.endsWith("/v1/admin/ops"))).toBe(true);
});

test("MODERATOR yetkisiz bölüme URL ile gelirse erişim reddi görür; bölüm verisi istenmez", async ({ page }) => {
  const mock = await as(page, "MODERATOR");
  for (const [path, label] of [["/admin/settings", "Ayarlar"], ["/admin/users", "Kullanıcılar"], ["/admin", "Dashboard"]] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Bu bölüm için yetkin yok" })).toBeVisible();
    await expect(page.getByText(`${label} bölümü rolüne açık değil.`)).toBeVisible();
    await expect.poll(() => navLabels(page)).toEqual(MODERATION);
  }
  expect((await axe(page)).violations).toEqual([]);
  expect(mock.requested.filter((r) => /\/v1\/admin\/(settings|users|metrics|ops)/.test(r))).toEqual([]);

  await page.getByRole("link", { name: "İçerikler bölümüne git" }).click();
  await expect(page).toHaveURL(/\/admin\/polls$/);
  await expect(page.getByRole("heading", { name: "İçerikler" })).toBeVisible();
});

test("topluluklar: MODERATOR salt okunur, ADMIN yönetim düğmelerini görür", async ({ page }) => {
  await as(page, "MODERATOR");
  await page.goto("/admin/communities");
  await expect(page.getByText("Topluluk açma ve düzenleme yalnız yöneticilere açıktır.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Topluluk aç" })).toHaveCount(0);

  await as(page, "ADMIN");
  await page.goto("/admin/communities");
  await expect(page.getByRole("button", { name: "Topluluk aç" })).toBeVisible();
});

/** Bölüm panellerinin GET ile yüklediği yönetim uçları ve topluluk listesi. */
const panelReads = endpoints.filter((e) => e.method === "GET" && (e.id.startsWith("admin.") || e.id === "communities.list"));
const ok = (id: string) => (examples.some((e) => e.endpoint === id && e.status >= 200 && e.status < 300) ? sample(id) : empty());

for (const path of SECTIONS) {
  test(`${path}: 500 hatası görünür, tekrar dene ile toparlanır`, async ({ page }) => {
    // Bilinen eksik (#187 PR-4 bulgusu): topluluk başvuru kuyruğu (community-request-queue.tsx) 500'de "Başvurular
    // yüklenemedi." gösterir ama tekrar dene düğmesi yok, hata sonraki başarılı yüklemede de temizlenmez ve aynı anda
    // "Bu durumda başvuru yok." der. Düzeltilince fixme kaldırılır.
    test.fixme(path === "/admin/communities", "topluluk başvuru kuyruğunda retry yok ve hata temizlenmiyor");
    const mock = await as(page, "SUPER_ADMIN");
    let failing = true;
    for (const endpoint of panelReads) {
      mock.handlers.set(endpoint.id, (r) => (failing ? r.fulfill({ status: 500, json: failure() }) : r.fulfill({ json: ok(endpoint.id) })));
    }
    await page.goto(path);
    const main = page.locator("main");
    await expect(main.getByRole("alert").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Yönetim açılamadı." })).toHaveCount(0);
    expect((await axe(page)).violations).toEqual([]);

    failing = false;
    const retry = main.getByRole("button", { name: /tekrar dene/i });
    for (let i = 0; i < 10 && (await retry.count()) > 0; i++) {
      const previousCount = await retry.count();
      await retry.first().click();
      await expect(retry).toHaveCount(previousCount - 1);
      await expect(main.locator('[aria-busy="true"]')).toHaveCount(0);
    }
    await expect(main.getByRole("alert")).toHaveCount(0);
    expect(mock.unexpected).toEqual([]);
  });
}

test("klavye: menü Tab ile gezilir, Enter bölüm açar, etkin bölüm aria-current taşır", async ({ page }) => {
  await as(page, "ADMIN");
  await page.goto("/admin/reports");
  await expect(page.getByRole("heading", { name: "Raporlar" })).toBeVisible();
  await expect(nav(page).getByRole("link", { name: /Raporlar/ })).toHaveAttribute("aria-current", "page");

  const target = nav(page).getByRole("link", { name: /Kategoriler/ });
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await target.evaluate((el) => el === document.activeElement);
  }
  expect(reached, "Kategoriler bağlantısına Tab ile ulaşılmalı").toBe(true);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/categories$/);
  await expect(nav(page).getByRole("link", { name: /Kategoriler/ })).toHaveAttribute("aria-current", "page");
  await expect(nav(page).getByRole("link", { name: /Raporlar/ })).not.toHaveAttribute("aria-current", "page");
});

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { api, sample, failure } from "./api";

const path = "/hesap/yas-beyani?returnTo=%2Folustur";
test("enforced declaration leaves bookmarks, reporting and community membership open", async ({ page }, info) => {
  const mock = await api(page); let saved = 0; let reported = 0; let joined = false;
  mock.handlers.set("me.get", r => { const body = sample("me.get"); body.data.adultDeclarationRequired = true; body.data.adultDeclarationEnforced = true; return r.fulfill({json:body}); });
  mock.handlers.set("bookmarks.list", r => r.fulfill({json:{data:[],page:{hasMore:false,nextCursor:null}}}));
  mock.handlers.set("bookmarks.put", r => { saved++; return r.fulfill({json:sample("bookmarks.put")}); });
  mock.handlers.set("reports.create", r => { reported++; return r.fulfill({status:202,json:sample("reports.create")}); });
  const community = sample("communities.get");
  mock.handlers.set("communities.get", r => { const body = structuredClone(community); body.data.viewer = joined ? {role:"MEMBER"} : null; return r.fulfill({json:body}); });
  mock.handlers.set("communities.join", r => { joined = true; return r.fulfill({json:sample("communities.join")}); });
  const pollId = sample("polls.get").data.id;
  await page.goto(`/karar/${pollId}`);
  await page.getByRole("button", {name:"Kaydet",exact:true}).click();
  await expect(page.getByRole("button", {name:"Kaydı kaldır",exact:true})).toBeVisible();
  await page.getByRole("button", {name:"Bu içeriği raporla",exact:true}).click();
  await page.getByRole("dialog").getByRole("button", {name:"Raporu gönder",exact:true}).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(saved).toBe(1); expect(reported).toBe(1);
  await page.goto(`/topluluk/${community.data.slug}`);
  await page.getByRole("button", {name:"Topluluğa katıl",exact:true}).click();
  await expect(page.getByRole("button", {name:"Topluluktan ayrıl",exact:true})).toBeVisible();
  await page.goto("/olustur");
  await expect(page.getByRole("heading", {name:"Katılım için 18+ beyanı gerekiyor."})).toBeVisible();
  await page.screenshot({path:info.outputPath("declaration-scope.png"),fullPage:true});
  expect(mock.unexpected).toEqual([]);
});

test("disabled enforcement allows login and composing while offering a non-blocking declaration", async ({ page }, info) => {
  const mock = await api(page); let signedIn = false;
  const me = () => { const body = sample("me.get"); body.data.adultDeclarationRequired = true; body.data.adultDeclarationEnforced = false; return body; };
  mock.handlers.set("me.get", r => signedIn ? r.fulfill({json:me()}) : r.fulfill({status:401,json:failure("UNAUTHENTICATED")}));
  mock.handlers.set("auth.login", r => {signedIn = true; return r.fulfill({json:me()});});
  await page.goto("/giris?returnTo=%2Folustur");
  await page.getByLabel("E-posta",{exact:true}).fill("legacy-flag-off@example.test");
  await page.getByLabel("Şifre",{exact:true}).fill("synthetic-test-password");
  await page.getByRole("button",{name:"Giriş yap",exact:true}).click();
  await expect(page).toHaveURL(/\/olustur$/);
  await expect(page.getByRole("heading",{name:"Aklında ne var?"})).toBeVisible();
  await page.getByRole("link",{name:"Yaş beyanını tamamla",exact:true}).click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(page.getByRole("link",{name:"Şimdilik işlemime devam et",exact:true})).toHaveAttribute("href","/olustur");
  await page.screenshot({path:info.outputPath("declaration-flag-off.png"),fullPage:true});
  expect(mock.unexpected).toEqual([]);
});

test("expired declaration login preserves the community continuation", async ({ page }) => {
  const mock = await api(page); let signedIn = false; let declared = false;
  mock.handlers.set("me.get", r => { if(!signedIn) return r.fulfill({status:401,json:failure("UNAUTHENTICATED")}); const body=sample("me.get"); body.data.adultDeclarationRequired=!declared; return r.fulfill({json:body}); });
  mock.handlers.set("auth.login", r => { signedIn=true; const body=sample("auth.login"); body.data.adultDeclarationRequired=!declared; return r.fulfill({json:body}); });
  mock.handlers.set("me.adultDeclaration.confirm", r => { declared=true; return r.fulfill({json:{data:{declaredAt:"2026-11-10T12:00:00Z"}}}); });
  await page.goto("/hesap/yas-beyani?returnTo=%2Ftopluluk%2Fyazilim");
  await page.getByRole("link",{name:"Yeniden giriş yap",exact:true}).click();
  await page.getByLabel("E-posta",{exact:true}).fill("legacy-return@example.test");
  await page.getByLabel("Şifre",{exact:true}).fill("synthetic-test-password");
  await page.getByRole("button",{name:"Giriş yap",exact:true}).click();
  await page.getByRole("checkbox",{name:/18 yaşımı doldurduğumu/}).check();
  await page.getByRole("button",{name:"18+ beyanını kaydet ve devam et",exact:true}).click();
  await expect(page).toHaveURL(/\/hesap\/yas-beyani\?returnTo=%2Ftopluluk%2Fyazilim$/);
  await expect(page.getByRole("link",{name:"İşlemime dön",exact:true})).toHaveAttribute("href","/topluluk/yazilim");
  expect(mock.unexpected).toEqual([]);
});
for (const expired of [false, true]) test(`login declaration preserves onboarding continuation, expiry=${expired}`, async ({ page }) => {
  const mock = await api(page); let signedIn = false; let declared = false; let writes = 0;
  const categoryId = sample("categories.list").data[0].id;
  await page.addInitScript(categoryId => localStorage.setItem("kv-welcome-draft-v1", JSON.stringify({ version: 1, categoryIds: [categoryId], demoChoice: "write", returnTo: "/olustur" })), categoryId);
  mock.handlers.set("auth.login", r => { signedIn = true; const body = sample("auth.login"); body.data.adultDeclarationRequired = true; return r.fulfill({ json: body }); });
  mock.handlers.set("me.get", r => { if (!signedIn || (expired && declared)) return r.fulfill({ status: 401, json: failure("UNAUTHENTICATED") }); const body = sample("me.get"); body.data.adultDeclarationRequired = !declared; return r.fulfill({ json: body }); });
  mock.handlers.set("interests.get", r => r.fulfill({ json: { data: { categoryIds: [] } } }));
  mock.handlers.set("interests.put", r => { writes++; expect(r.request().postDataJSON()).toEqual({ categoryIds: [categoryId] }); return r.fulfill({ json: { data: { categoryIds: [categoryId] } } }); });
  mock.handlers.set("me.adultDeclaration.confirm", r => { declared = true; return r.fulfill({ json: { data: { declaredAt: "2026-11-10T12:00:00Z" } } }); });
  await page.goto("/giris?returnTo=%2Folustur&onboarding=1");
  await page.getByLabel("E-posta", { exact: true }).fill("legacy-onboarding@example.test");
  await page.getByLabel("Şifre", { exact: true }).fill("synthetic-test-password");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  const checkbox = page.getByRole("checkbox", { name: /18 yaşımı doldurduğumu beyan ediyorum/ });
  await expect(checkbox).toBeFocused(); await page.keyboard.press("Space");
  await page.getByRole("button", { name: "18+ beyanını kaydet ve devam et" }).click();
  if (expired) {
    await expect(page.getByRole("button", { name: "Giriş yap", exact: true })).toBeVisible();
    await expect(page.locator("main").getByRole("alert")).toContainText("Oturumun sona erdi");
    expect(await page.evaluate(() => localStorage.getItem("kv-welcome-draft-v1"))).not.toBeNull();
    expect(writes).toBe(0);
  } else {
    await expect(page).toHaveURL(/\/olustur$/);
    expect(writes).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem("kv-welcome-draft-v1"))).toBeNull();
  }
  expect(mock.unexpected).toEqual([]);
});
for (const fault of ["server", "network", "forbidden"] as const) test(`restored legacy account ${fault}, retry and verified returnTo`, async ({ page }, info) => {
  const mock = await api(page); let declared = false; let failing = true; let writes = 0;
  mock.handlers.set("me.get", r => { const body = sample("me.get"); body.data.adultDeclarationRequired = !declared; return r.fulfill({ json: body }); });
  mock.handlers.set("me.adultDeclaration.confirm", r => {
    writes++; expect(r.request().postDataJSON()).toEqual({ adultConfirmed: true });
    if (failing) return fault === "network" ? r.abort("failed") : r.fulfill({ status: fault === "forbidden" ? 403 : 500, json: failure(fault === "forbidden" ? "FORBIDDEN" : "INTERNAL_ERROR") });
    declared = true; return r.fulfill({ json: { data: { declaredAt: "2026-11-10T12:00:00Z" } } });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/olustur");
  await expect(page.getByRole("heading", { name: "Katılım için 18+ beyanı gerekiyor." })).toBeVisible();
  await page.getByRole("link", { name: "Yaş beyanına git" }).click();
  await expect(page).toHaveURL(new RegExp(path.replace("?", "\\?")));
  const checkbox = page.getByRole("checkbox", { name: "18 yaşımı doldurduğumu beyan ediyorum.", exact: true });
  const submit = page.getByRole("button", { name: "Beyanı kaydet ve devam et", exact: true });
  await expect(checkbox).not.toBeChecked(); await expect(submit).toBeDisabled();
  const touchTarget = checkbox.locator("..");
  const targetBox = await touchTarget.boundingBox();
  expect(targetBox).not.toBeNull();
  expect(targetBox!.width).toBeGreaterThanOrEqual(44);
  expect(targetBox!.height).toBeGreaterThanOrEqual(44);
  await touchTarget.click({ position: { x: targetBox!.width - 6, y: targetBox!.height - 6 } });
  await expect(checkbox).toBeChecked();
  await checkbox.focus(); await page.keyboard.press("Space");
  await expect(checkbox).not.toBeChecked();
  await checkbox.focus(); await page.keyboard.press("Space"); await submit.click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(checkbox).toBeChecked(); await expect(page).toHaveURL(/yas-beyani/);
  expect(writes).toBe(1);
  expect((await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`adult-${fault}.png`), fullPage: true });
  failing = false; await submit.click();
  await expect(page).toHaveURL(/\/olustur$/);
  await expect(page.getByRole("heading", { name: "Aklında ne var?" })).toBeVisible();
  expect(writes).toBe(2); expect(mock.unexpected).toEqual([]);
});

test("expiry after successful declaration never shows a successful participation redirect", async ({ page }) => {
  const mock = await api(page); let expired = false;
  mock.handlers.set("me.get", r => { if (expired) return r.fulfill({ status: 401, json: failure("UNAUTHENTICATED") }); const body = sample("me.get"); body.data.adultDeclarationRequired = true; return r.fulfill({ json: body }); });
  mock.handlers.set("me.adultDeclaration.confirm", r => { expired = true; return r.fulfill({ json: { data: { declaredAt: "2026-11-10T12:00:00Z" } } }); });
  await page.goto(path);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Beyanı kaydet ve devam et", exact: true }).click();
  await expect(page.getByRole("link", { name: "Yeniden giriş yap", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/yas-beyani/);
});

test("another tab declaration is re-read from API without another write", async ({ page, context }) => {
  let declared = false; let writes = 0;
  const other = await context.newPage();
  for (const tab of [page, other]) {
    const mock = await api(tab);
    mock.handlers.set("me.get", r => { const body = sample("me.get"); body.data.adultDeclarationRequired = !declared; return r.fulfill({ json: body }); });
    mock.handlers.set("me.adultDeclaration.confirm", r => { writes++; declared = true; return r.fulfill({ json: { data: { declaredAt: "2026-11-10T12:00:00Z" } } }); });
    await tab.goto(path);
  }
  await other.getByRole("checkbox").check();
  await other.getByRole("button", { name: "Beyanı kaydet ve devam et", exact: true }).click();
  await expect(other).toHaveURL(/\/olustur$/);
  await page.getByRole("button", { name: "Durumu tekrar kontrol et" }).click();
  await expect(page.getByRole("status").filter({ hasText: "yeni bir yaş beyanı gerekmiyor" })).toBeVisible();
  expect(writes).toBe(1); await other.close();
});

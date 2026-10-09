import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("forms wait for delayed hydration and preserve the first input", async ({ page }) => {
  for (const form of [
    {path:"/olustur",first:"Sorun",value:"Hafta sonu hangi etkinliğe gidelim?",second:"1. seçenek"},
    {path:"/kayit",first:"Görünen ad",value:"Test Kullanıcı",second:"Demo e-posta"},
  ]) {
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    await page.route("**/_next/**",async route=>{
      if(route.request().resourceType()==="script") await gate;
      await route.continue();
    });
    try {
      await page.goto(form.path,{waitUntil:"commit"});
      await expect(page.getByRole("heading",{name:"Oturum kontrol ediliyor…"})).toBeVisible();
      await expect(page.getByLabel(form.first,{exact:true})).toHaveCount(0);
    } finally { release(); }
    await page.getByLabel(form.first,{exact:true}).fill(form.value);
    await page.getByLabel(form.second,{exact:true}).fill("test@example.test");
    await expect(page.getByLabel(form.first,{exact:true})).toHaveValue(form.value);
    await page.unrouteAll({behavior:"wait"});
  }
});

test("KV-46: missing page, skip link and mobile navigation remain accessible", async ({ page }, testInfo) => {
  for (const width of [360, 1440]) {
    await page.setViewportSize({width, height:900});
    await page.goto("/bulunmayan-kv46-sayfasi");
    await expect(page.getByRole("heading", {name:"Bu sayfayı bulamadık."})).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", {name:"İçeriğe geç"})).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({path:testInfo.outputPath(`404-${width}.png`),fullPage:true});
    await page.getByRole("link", {name:"Akışa dön",exact:true}).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("#main")).toBeFocused();
  }
});

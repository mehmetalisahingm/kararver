import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const width of [1440, 360]) test(`premium onboarding ${width}px: choice, results, interests and auth gate`, async ({page}, info) => {
  await page.setViewportSize({width,height:1000});
  await page.goto("/basla");
  await expect(page.getByRole("heading", {name:"İnsanlar gerçekten ne düşünüyor?"})).toBeVisible();
  await page.getByRole("button", {name:"Bir karar verelim"}).click();
  await page.getByRole("button", {name:"Kendin dene"}).click();
  await page.getByRole("button", {name:"Beklerim",exact:false}).click();
  await expect(page.getByText("SENİN SEÇİMİN · Beklerim")).toBeVisible();
  await expect(page.getByText("%68", {exact:true})).toBeVisible();
  await expect(page.getByText("Oranlar demo için hazırlanmıştır", {exact:false})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await page.screenshot({path:info.outputPath(`result-${width}.png`),fullPage:true});
  await page.getByRole("button", {name:"Keşfetmeye devam et"}).click();
  await page.getByRole("button", {name:/Teknoloji/}).click();
  await expect(page.getByRole("button", {name:/Teknoloji/})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("link", {name:/Sana göre olan kararları/}).click();
  await expect(page).toHaveURL(/\/giris\?onboarding=1/);
  await expect(page.getByRole("heading",{name:"Fikrin burada bir yer bulsun."})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Tekrar hoş geldin."})).toBeVisible();
});

test("onboarding keyboard and reduced motion",async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto("/basla");
  await expect(page.getByRole("button",{name:"Bir karar verelim"})).toBeEnabled();
  await page.getByRole("button",{name:"Bir karar verelim"}).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading",{name:"Kararsız kaldığında yalnız değilsin."})).toBeFocused();
  expect(await page.getByRole("heading",{name:"Kararsız kaldığında yalnız değilsin."}).evaluate(el=>getComputedStyle(el.parentElement!).animationName)).toBe("none");
});

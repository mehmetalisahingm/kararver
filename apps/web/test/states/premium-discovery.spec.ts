import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {api,empty,sample} from "./api";

test("premium discovery, community, profile and notification surfaces support both themes",async({page},info)=>{
  const mock=await api(page);
  for(const path of ["/","/kesfet","/kategoriler","/yukselenler","/topluluklar","/profil/deniz","/hesap","/bildirimler","/admin"]){
    await page.goto(path);await expect(page.locator("main h1").first()).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    for(const theme of ["light","dark"]){
      if(await page.locator(".product").getAttribute("data-theme")!==theme)await page.getByRole("button",{name:/temaya geç/}).click();
      if (["/kesfet", "/topluluklar"].includes(path)) {
        await expect(page.locator(".mission-copy > p")).toHaveCSS("color", "rgb(215, 216, 205)");
        await expect(page.locator(".mission-effects")).toHaveCount(1);
      }
      if (["/kategoriler", "/yukselenler"].includes(path)) {
        await expect(page.locator(".kv-hero-copy > p")).toHaveCSS("color", theme === "light" ? "rgb(83, 99, 77)" : "rgb(180, 189, 184)");
        expect(await page.locator(".kv-immersive-hero").evaluate(element =>
          element.getAnimations({ subtree: true }).some(animation => animation.effect?.getTiming().iterations === Infinity)
        )).toBe(false);
      }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${path} ${theme}`).toBe(true);
      if(path==="/admin") {
        const width=await page.locator(".app-main").evaluate(element=>element.getBoundingClientRect().width);
        expect(width,"admin content retains the available page width").toBeGreaterThan(page.viewportSize()!.width*.7);
        // #368: admin field foreground and background must agree before the axe audit.
        const themeField=page.locator("select.kv-input").first();
        await expect(themeField).toHaveCSS("background-color",theme==="light"?"rgb(228, 228, 215)":"rgb(36, 41, 41)");
        await expect(themeField).toHaveCSS("color",theme==="light"?"rgb(32, 40, 31)":"rgb(241, 240, 231)");
      }
      expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations,`${path} ${theme}`).toEqual([]);
      await page.screenshot({path:info.outputPath(`${path.slice(1).replaceAll("/","-")}-${theme}.png`)});
    }
  }
  expect(mock.unexpected).toEqual([]);
});

test("user search opens the actual profile and empty notifications offer discovery",async({page})=>{
  const mock=await api(page);
  const search=sample("search.query");
  search.data=[{type:"user",user:{id:sample("me.get").data.id,username:"deniz",displayName:"Deniz",avatarUrl:null}}];
  search.page={hasMore:false,nextCursor:null};
  mock.handlers.set("search.query",r=>r.fulfill({json:search}));
  await page.goto("/kesfet?q=deniz&type=users");
  const profile=page.locator(".discovery-results").getByRole("link",{name:"Deniz",exact:true});
  await expect(profile).toHaveAttribute("href","/profil/deniz");
  await profile.click();await expect(page).toHaveURL(/\/profil\/deniz$/);
  await expect(page.getByRole("heading",{name:"Gönderiler",exact:true})).toBeVisible();
  mock.handlers.set("notifications.list",r=>r.fulfill({json:empty()}));
  await page.goto("/bildirimler");
  await expect(page.getByRole("heading",{name:"Henüz bildirimin yok.",exact:true})).toBeVisible();
  await page.getByRole("link",{name:"Konuları keşfet",exact:true}).click();
  await expect(page).toHaveURL(/\/kesfet$/);
  await page.goto("/topluluklar");
  const communities=page.locator(".mission-community-list > article");
  await expect(communities).toHaveCount(sample("communities.list").data.length);
  await page.getByRole("searchbox",{name:"Yüklenen topluluklarda ara"}).fill("zzzz-nonexistent");
  await expect(communities).toHaveCount(0);
  await page.getByRole("button",{name:"Aramayı temizle",exact:true}).click();
  await expect(communities).toHaveCount(sample("communities.list").data.length);
  expect(mock.unexpected).toEqual([]);
});

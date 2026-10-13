import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {api,empty,sample} from "./api";

test("premium discovery, community, profile and notification surfaces support both themes",async({page},info)=>{
  const mock=await api(page);
  for(const path of ["/kesfet","/kategoriler","/yukselenler","/topluluklar","/profil/deniz","/hesap","/bildirimler"]){
    await page.goto(path);await expect(page.locator("main h1").first()).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    for(const theme of ["light","dark"]){
      if(await page.locator(".product").getAttribute("data-theme")!==theme)await page.getByRole("button",{name:/temaya geç/}).click();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${path} ${theme}`).toBe(true);
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
  expect(mock.unexpected).toEqual([]);
});

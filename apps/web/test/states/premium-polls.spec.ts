import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {api,sample} from "./api";

for(const scenario of ["hidden","public","locked"] as const) test(`premium poll card: ${scenario} API results and cover recovery`,async({page},info)=>{
  const mock=await api(page);const body=sample("feed.list");const card=body.data[0];
  card.coverImage.url="https://cover.test/design.png";
  if(scenario==="public")card.results={visible:true,total:20,options:[]};
  else card.results={visible:false};
  if(scenario==="locked")card.status="LOCKED";
  body.data=[card];body.page={hasMore:false,nextCursor:null};
  mock.handlers.set("feed.list",r=>r.fulfill({json:body}));
  let fail=true;
  await page.route("https://cover.test/**",r=>fail?r.abort():r.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#82796c"/></svg>'}));
  await page.goto("/kesfet");const article=page.locator(".discovery-results > article");
  await expect(article).toHaveCount(1);
  await expect(article.getByRole("button",{name:"Kapak görselini tekrar yükle"})).toBeVisible();
  if(scenario==="public")await expect(article.getByText("20 oy",{exact:true})).toBeVisible();
  else {await expect(article.getByText("Sonuçlar oy verdikten sonra görünür.")).toBeVisible();await expect(article.getByRole("progressbar")).toHaveCount(0);}
  if(scenario==="locked")await expect(article.getByText("Kilitli",{exact:true})).toBeVisible();
  fail=false;await article.getByRole("button",{name:"Kapak görselini tekrar yükle"}).click();
  await expect(article.getByText("Anket görseli yükleniyor…")).toHaveCount(0);
  await expect(article.getByRole("img")).toBeVisible();
  for(const theme of ["light","dark"]){
    if(await page.locator(".product").getAttribute("data-theme")!==theme)await page.getByRole("button",{name:/temaya geç/}).click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
    await article.screenshot({path:info.outputPath(`${scenario}-${theme}.png`)});
  }
  expect(mock.unexpected).toEqual([]);
});

test("guided composer keeps draft and previews settings before explicit publication",async({page},info)=>{
  const mock=await api(page);let publishes=0;
  mock.handlers.set("polls.create",async r=>{publishes++;await r.fulfill({status:201,json:sample("polls.get")});});
  await page.goto("/olustur");
  await page.getByLabel("Sorun",{exact:true}).fill("Yeni tasarım için hangi renk daha iyi?");
  await page.getByLabel("1. seçenek",{exact:true}).fill("Şampanya");
  await page.getByLabel("2. seçenek",{exact:true}).fill("Antrasit");
  await page.getByRole("button",{name:"2 · Yayını düzenle",exact:true}).click();
  await expect(page.locator("#compose-settings")).toBeFocused();
  await page.getByLabel("Kategori",{exact:true}).selectOption({label:"Otomobil"});
  await page.getByLabel("Anket süresi",{exact:true}).selectOption({label:"7 gün"});
  await page.getByLabel("Sonuç görünürlüğü",{exact:true}).selectOption({label:"Herkese açık"});
  await page.getByRole("button",{name:"Yayın önizlemesi",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Yayımlamaya hazır mısın?"});
  await expect(dialog.getByRole("list",{name:"Yayımlanacak seçenekler"})).toContainText("Şampanya");
  await expect(dialog).toContainText("7 gün");await expect(dialog).toContainText("Herkese açık");
  expect(publishes).toBe(0);
  expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({path:info.outputPath("publish-preview.png")});
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button",{name:"Yayın önizlemesi",exact:true})).toBeFocused();
  await expect(page.getByLabel("1. seçenek",{exact:true})).toHaveValue("Şampanya");
  expect(mock.unexpected).toEqual([]);
});

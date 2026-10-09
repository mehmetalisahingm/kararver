import { test,expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { api, sample, empty, failure } from "./api";

test.beforeEach(async ({browser},info)=>{
  info.annotations.push({type:"browser-version",description:browser.version()});
  info.annotations.push({type:"device",description:`${info.project.name}: emulation, not a physical device`});
});
test.afterEach(async ({page},info)=>{
  if(info.status==="passed") await page.screenshot({path:info.outputPath("verified-state.png"),fullPage:true});
});

for(const scenario of [
  {path:"/kesfet",endpoint:"feed.list",loading:"Akış yükleniyor",retry:"Tekrar dene",body:empty()},
  {path:"/kesfet?q=otomobil",endpoint:"search.query",loading:"Arama sonuçları yükleniyor",retry:"Tekrar dene",body:empty()},
  {path:"/kategoriler",endpoint:"categories.list",loading:"Kategoriler yükleniyor",retry:"Kategorileri tekrar yükle",body:{data:[]}},
  {path:"/yukselenler",endpoint:"trends.list",loading:"Trendler yükleniyor",retry:"Tekrar dene",body:{...empty(),meta:null,reason:"INSUFFICIENT_HISTORY"}},
]) test(`${scenario.endpoint}: loading, 500, retry and empty state`,async({page})=>{
  const {handlers}=await api(page);let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  handlers.set(scenario.endpoint,async r=>{await gate;await r.fulfill({status:500,json:failure()});});
  await page.goto(scenario.path);
  await expect(page.getByRole("status").filter({hasText:scenario.loading})).toBeVisible();
  release();await expect(page.locator("main").getByRole("alert")).toBeVisible();
  handlers.set(scenario.endpoint,r=>r.fulfill({json:scenario.body}));
  await page.getByRole("button",{name:scenario.retry,exact:true}).click();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
});

test("all implemented routes: light/dark, overflow, landmarks and accessible names",async({page},info)=>{
  test.setTimeout(240000);
  const mock=await api(page);
  const paths=["/","/kesfet","/kategoriler","/kategori/otomobil","/yukselenler","/giris","/kayit","/dogrula","/sifremi-unuttum","/sifre-yenile","/olustur","/karar/01998b9a-0000-7000-8000-000000000020","/profil/deniz","/hesap","/ilgi-alanlari","/bildirimler","/missing-kv46",...['','users','polls','comments','reports','media','categories','communities','featured','settings','audit'].map(p=>`/admin${p?'/'+p:''}`)];
  for(const theme of ["dark","light"]) {
    for(const [index,path] of paths.entries()) {
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
      // Toggle through the product control, preserving its own theme semantics.
      if(await page.locator(".product").getAttribute("data-theme")!==theme) await page.getByRole("button",{name:/tema/i}).click();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${theme} ${path}`).toBe(true);
      const report=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();
      expect(report.violations,`${theme} ${path}`).toEqual([]);
      if([12,13,14,16,17].includes(index)) await page.screenshot({path:info.outputPath(`${theme}-${index}.png`),fullPage:true});
    }
  }
  expect(mock.unexpected).toEqual([]);
});

test("profile: loading, offline/500 retry, empty, 404 and failed pagination preserve content",async({page})=>{
  const {handlers}=await api(page);
  let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  handlers.set("profiles.get",async r=>{await gate;await r.fulfill({status:500,json:failure()});});
  await page.goto("/profil/deniz");
  await expect(page.getByRole("status").filter({hasText:"Profil yükleniyor"})).toBeVisible();
  release();await expect(page.getByRole("heading",{name:"Profil açılamadı."})).toBeVisible();
  handlers.set("profiles.get",r=>r.abort("failed"));
  await page.getByRole("button",{name:"Profili tekrar yükle"}).click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  handlers.delete("profiles.get");handlers.set("profiles.polls",r=>r.fulfill({json:empty()}));handlers.set("profiles.comments",r=>r.fulfill({json:empty()}));
  await page.getByRole("button",{name:"Profili tekrar yükle"}).click();
  await expect(page.getByText("Henüz görünür gönderi yok.")).toBeVisible();
  await expect(page.getByText("Henüz görünür yorum yok.")).toBeVisible();
  handlers.set("profiles.get",r=>r.fulfill({status:404,json:failure("NOT_FOUND")}));
  await page.goto("/profil/yok");await expect(page.getByRole("heading",{name:"Profil bulunamadı."})).toBeVisible();
  handlers.delete("profiles.get");let fail=true;
  handlers.set("profiles.polls",async(r,url)=>{
    if(url.searchParams.has("cursor")){await r.fulfill(fail?{status:500,json:failure()}:{json:empty()});return;}
    const body=sample("profiles.polls");body.page={hasMore:true,nextCursor:"next"};await r.fulfill({json:body});
  });
  await page.goto("/profil/deniz");const more=page.getByRole("button",{name:"Daha fazla gönderi"});
  await more.click();await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("link",{name:"Bu araba bu fiyata alınır mı?"})).toBeVisible();
  fail=false;await more.click();await expect(more).toHaveCount(0);
  handlers.set("profiles.comments",async(r,url)=>{
    if(url.searchParams.has("cursor")){await r.fulfill({status:500,json:failure()});return;}
    const body=sample("profiles.comments");body.page={hasMore:true,nextCursor:"comments-next"};await r.fulfill({json:body});
  });
  await page.reload();await page.getByRole("button",{name:"Daha fazla yorum"}).click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.getByText("Boyalı parça fiyatı düşürür, pazarlık payı var.")).toBeVisible();
  handlers.set("profiles.comments",r=>r.fulfill({json:empty()}));
  await page.getByRole("button",{name:"Daha fazla yorum"}).click();await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});

test("onboarding: empty, load retry, save error preserves selection and success",async({page})=>{
  const {handlers}=await api(page);
  handlers.set("categories.list",r=>r.fulfill({status:500,json:failure()}));
  await page.goto("/ilgi-alanlari");await expect(page.locator("main").getByRole("alert")).toBeVisible();
  handlers.set("categories.list",r=>r.fulfill({json:{data:[]}}));handlers.set("communities.list",r=>r.fulfill({json:empty()}));
  await page.getByRole("button",{name:"Tekrar dene",exact:true}).click();
  await expect(page.getByText("Şu an seçilebilecek kategori yok. Bu adımı atlayabilirsin.")).toBeVisible();
  handlers.delete("categories.list");await page.reload();
  await expect(page.getByRole("button",{name:"Otomobil",exact:true})).toHaveAttribute("aria-pressed","true");
  handlers.set("interests.put",r=>r.fulfill({status:500,json:failure()}));
  await page.getByRole("button",{name:"Seçimlerimi kaydet"}).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Seçimlerin korundu");
  await expect(page.getByRole("button",{name:"Otomobil",exact:true})).toHaveAttribute("aria-pressed","true");
  handlers.set("interests.put",r=>r.fulfill({json:sample("interests.get")}));
  await page.getByRole("button",{name:"Seçimlerimi kaydet"}).click();await expect(page.getByText("Tercihin işlendi.")).toBeVisible();
});

test("account: failed initial load is not empty, retry and failed save retain draft",async({page})=>{
  const {handlers}=await api(page);
  handlers.set("bookmarks.list",r=>r.fulfill({status:500,json:failure()}));
  await page.goto("/hesap");await expect(page.getByRole("button",{name:"Kaydedilenleri tekrar yükle"})).toBeVisible();
  await expect(page.getByText("Henüz bir gönderi kaydetmedin.")).toHaveCount(0);
  handlers.set("bookmarks.list",r=>r.fulfill({json:empty()}));
  await page.getByRole("button",{name:"Kaydedilenleri tekrar yükle"}).click();await expect(page.getByText("Henüz bir gönderi kaydetmedin.")).toBeVisible();
  handlers.set("me.update",r=>r.fulfill({status:500,json:failure()}));
  await page.getByLabel("Biyografi").fill("Kaybolmaması gereken taslak");await page.getByRole("button",{name:"Profili kaydet"}).click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();await expect(page.getByLabel("Biyografi")).toHaveValue("Kaybolmaması gereken taslak");
  handlers.delete("bookmarks.list");await page.reload();
  handlers.set("bookmarks.delete",r=>r.fulfill({status:500,json:failure()}));
  await page.getByRole("button",{name:"Kaydı kaldır"}).first().click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button",{name:"Kaydı kaldır"}).first()).toBeEnabled();
});

test("admin: connection failure differs from permission denial; modal names, Escape and focus",async({page})=>{
  const {handlers}=await api(page);
  handlers.set("me.get",async r=>{
    const checking = await page.getByRole("status").filter({hasText:"Yönetim yetkisi kontrol ediliyor"}).count();
    await r.fulfill(checking ? {status:500,json:failure()} : {json:sample("me.get")});
  });
  await page.goto("/admin");await expect(page.getByRole("heading",{name:"Yönetim açılamadı."})).toBeVisible();
  handlers.set("me.get",r=>r.fulfill({json:sample("me.get")}));
  await page.getByRole("button",{name:"Yetkiyi tekrar kontrol et"}).click();await expect(page.getByRole("heading",{name:"Yönetim erişimi gerekli"})).toBeVisible();
  handlers.delete("me.get");await page.reload();
  const trigger=page.getByRole("button",{name:"Örnek işlem"});await trigger.click();
  await expect(page.getByRole("dialog",{name:"Yönetim işlemi"})).toBeVisible();
  expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);await expect(trigger).toBeFocused();
  const rowTrigger=page.getByRole("button",{name:"İncele",exact:true}).last();
  await rowTrigger.click();
  await page.getByRole("button",{name:"Vazgeç",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(rowTrigger).toBeFocused();
});

test("session outage retry and anonymous permission states",async({page})=>{
  const {handlers}=await api(page);handlers.set("me.get",r=>r.abort("failed"));
  await page.goto("/hesap");await expect(page.getByRole("heading",{name:"Bağlantı kurulamadı."})).toBeVisible();
  handlers.set("me.get",r=>r.fulfill({status:401,json:failure("UNAUTHENTICATED")}));
  await page.getByRole("button",{name:"Tekrar dene",exact:true}).click();await expect(page.getByRole("heading",{name:"Hesabınla katıl."})).toBeVisible();
  await page.goto("/ilgi-alanlari");await expect(page.getByRole("heading",{name:"Akışını kişiselleştirmek için giriş yap."})).toBeVisible();
});

test("expired account session removes private content and login restores the requested page",async({page})=>{
  const mock=await api(page);
  await page.goto("/hesap");
  await expect(page.getByLabel("Biyografi")).toBeVisible();
  mock.handlers.set("me.update",r=>r.fulfill({status:401,json:failure("UNAUTHENTICATED")}));
  await page.getByLabel("Biyografi").fill("Expired session must not save this change");
  await page.getByRole("button",{name:"Profili kaydet"}).click();
  await expect(page.getByRole("heading",{name:"Hesabınla katıl."})).toBeVisible();
  await expect(page.getByLabel("Biyografi")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Kaydı kaldır"})).toHaveCount(0);
  const login=page.locator("main").getByRole("link",{name:"Giriş yap",exact:true});
  await expect(login).toHaveAttribute("href","/giris?returnTo=%2Fhesap");
  mock.handlers.set("me.get",r=>r.fulfill({status:401,json:failure("UNAUTHENTICATED")}));
  await page.reload();
  await expect(page.getByRole("heading",{name:"Hesabınla katıl."})).toBeVisible();
  await login.click();
  await page.getByLabel("E-posta",{exact:true}).fill("session-recovery@example.test");
  await page.getByLabel("Şifre",{exact:true}).fill("test-password");
  await page.getByRole("button",{name:"Giriş yap",exact:true}).click();
  await expect(page).toHaveURL(/\/hesap$/);
  await expect(page.getByLabel("Biyografi")).toBeVisible();
  expect(mock.unexpected).toEqual([]);
});

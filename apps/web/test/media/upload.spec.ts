import { test,expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { api,sample,failure } from "./api";
const ids=["01998b9a-0000-7000-8000-000000000090","01998b9a-0000-7000-8000-000000000091"];
const file={name:"foto.png",mimeType:"image/png",buffer:Buffer.from("PNG-test")};
const view=(id:string,status="PENDING")=>({id,purpose:"POLL",status,url:status==="APPROVED"?`https://cdn.kararver.test/${id}.png`:null,preview:null,width:800,height:530,createdAt:"2026-10-01T09:00:00.000Z"});

test("real-adapter gallery shows loading, image retry and ordered keyboard navigation",async({page})=>{
  const {handlers}=await api(page);const poll=sample("polls.get");
  poll.data.media=ids.map(id=>({id,url:`https://gallery.test/${id}.png`,width:800,height:530}));
  handlers.set("polls.get",r=>r.fulfill({json:poll}));
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let fail=true;
  await page.route("https://gallery.test/**",async r=>{await gate;if(fail)await r.abort();else await r.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="530"><rect width="800" height="530" fill="#777"/></svg>'});});
  await page.goto(`/karar/${poll.data.id}`,{waitUntil:"domcontentloaded"});
  await expect(page.getByText("Görsel yükleniyor…",{exact:true})).toBeVisible();release();
  await expect(page.getByText("Görsel yüklenemedi.",{exact:true})).toBeVisible();
  fail=false;await page.getByRole("button",{name:"Görseli tekrar yükle"}).click();
  await expect(page.getByText("Görsel yükleniyor…",{exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Sonraki görsel",exact:true}).focus();await page.keyboard.press("Enter");
  await expect(page.locator(".gallery-stage figcaption")).toContainText("2 / 2");
  expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
});

test("media upload/complete retry, ordered publication and failed publish retain selection",async({page})=>{
  const {handlers}=await api(page);const keys:string[]=[];let uploads=0,completes=0,puts=0,publishes=0;const bodies:any[]=[];
  handlers.set("media.uploads.create",async r=>{
    keys.push(r.request().headers()["idempotency-key"]);uploads++;
    const id=uploads<=2?ids[0]:ids[1];
    await r.fulfill({status:201,json:{data:{mediaId:id,upload:{method:"PUT",url:`https://storage.test/${id}`,headers:{"Content-Type":"image/png"},expiresAt:"2030-01-01T00:00:00.000Z"}}}});
  });
  await page.route("https://storage.test/**",async r=>{puts++;if(puts===1)await r.abort();else await r.fulfill({status:200});});
  handlers.set("media.complete",async(r,url)=>{completes++;await r.fulfill(completes===1?{status:500,json:failure()}:{status:202,json:{data:view(url.pathname.split("/").at(-2)!,"APPROVED")}});});
  handlers.set("polls.create",async r=>{bodies.push(r.request().postDataJSON());publishes++;await r.fulfill(publishes===1?{status:500,json:failure()}:{status:201,json:sample("polls.get")});});
  await page.goto("/olustur");
  await page.getByLabel("Sorun",{exact:true}).fill("Fotoğraflı anket hangi seçenek?");
  await page.getByLabel("1. seçenek",{exact:true}).fill("Birinci");await page.getByLabel("2. seçenek",{exact:true}).fill("İkinci");
  await page.getByLabel("Kategori",{exact:true}).selectOption({label:"Otomobil"});
  await page.getByLabel("Görsel ekle",{exact:true}).setInputFiles(file);
  await expect(page.getByRole("alert").filter({hasText:"Dosya yüklenemedi"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Yayın önizlemesi"})).toBeDisabled();
  await page.getByRole("button",{name:"Yüklemeyi tekrar dene"}).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("İstek tamamlanamadı");
  await page.getByRole("button",{name:"Yüklemeyi tekrar dene"}).click();
  await expect(page.getByText("Görsel onaylandı.",{exact:true})).toBeVisible();
  expect(uploads).toBe(2);expect(puts).toBe(2);expect(keys[0]).toBe(keys[1]);
  await page.getByLabel("Görsel ekle",{exact:true}).setInputFiles({...file,name:"ikinci.png"});
  await expect(page.getByText("Görsel onaylandı.",{exact:true})).toHaveCount(2);
  await page.getByRole("button",{name:"2. görseli önceye taşı"}).click();
  expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(let n=0;n<2;n++) {
    await page.getByRole("button",{name:"Yayın önizlemesi"}).click();await page.getByRole("button",{name:/puan ile yayımla$/i}).click();
    if(n===0){await expect(page.locator("main").getByRole("alert")).toBeVisible();await expect(page.getByText("Görsel onaylandı.",{exact:true})).toHaveCount(2);}
  }
  await expect(page).toHaveURL(/\/karar\//);
  expect(bodies.map(b=>b.mediaIds)).toEqual([[ids[1],ids[0]],[ids[1],ids[0]]]);
});

test("media validation, private pending/quarantine, status retry and rejection",async({page})=>{
  const {handlers}=await api(page);let status="PENDING",fail=false,leaks=0;
  handlers.set("media.uploads.create",r=>r.fulfill({status:201,json:{data:{mediaId:ids[0],upload:{method:"PUT",url:"https://storage.test/upload",headers:{"Content-Type":"image/png"},expiresAt:"2030-01-01T00:00:00.000Z"}}}}));
  await page.route("https://storage.test/**",r=>r.fulfill({status:200}));
  await page.route("https://private.test/**",async r=>{leaks++;await r.abort();});
  handlers.set("media.complete",r=>r.fulfill({status:202,json:{data:{...view(ids[0]),preview:{url:"https://private.test/signed",expiresAt:"2030-01-01T00:00:00.000Z"}}}}));
  handlers.set("media.get",r=>r.fulfill(fail?{status:500,json:failure()}:{json:{data:view(ids[0],status)}}));
  await page.goto("/olustur");
  await page.getByLabel("Görsel ekle",{exact:true}).setInputFiles({...file,mimeType:"image/svg+xml",name:"unsafe.svg"});
  await expect(page.locator("main").getByRole("alert")).toContainText("JPEG");
  await page.getByLabel("Görsel ekle",{exact:true}).setInputFiles(file);
  await expect(page.getByText("Görsel işleniyor.",{exact:false})).toBeVisible();
  status="QUARANTINED";await page.getByRole("button",{name:"Durumu tekrar kontrol et"}).click();
  await expect(page.getByText("Görsel incelemede.",{exact:false})).toBeVisible();
  fail=true;await page.getByRole("button",{name:"Durumu tekrar kontrol et"}).click();await expect(page.locator("main").getByRole("alert")).toBeVisible();
  fail=false;status="REJECTED";await page.getByRole("button",{name:"Durumu tekrar kontrol et"}).click();
  await expect(page.getByText("Görsel reddedildi.",{exact:false})).toBeVisible();
  await expect(page.getByRole("button",{name:"Yayın önizlemesi"})).toBeDisabled();
  await page.getByRole("button",{name:"Listeden kaldır"}).click();await expect(page.getByText("foto.png",{exact:false})).toHaveCount(0);
  expect(leaks).toBe(0);
});

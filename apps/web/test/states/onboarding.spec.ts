import {test,expect} from "@playwright/test";
import {api,failure,sample} from "./api";

test("first guest visit shows onboarding; returning guest gets login continuation, not the intro again",async({page})=>{
  const mock=await api(page);
  mock.handlers.set("me.get",r=>r.fulfill({status:401,json:failure("UNAUTHENTICATED")}));
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"İnsanlar gerçekten ne düşünüyor?"})).toBeVisible();
  await page.getByRole("link",{name:/Zaten üye misin/}).click();
  await expect(page).toHaveURL(/\/giris\?onboarding=1/);
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"Kararlarını kişiselleştirmek için hesabınla devam et."})).toBeVisible();
  await expect(page.getByRole("heading",{name:"İnsanlar gerçekten ne düşünüyor?"})).toHaveCount(0);
  expect(mock.unexpected).toEqual([]);
});

test("authenticated first visit goes directly to feed",async({page})=>{
  await api(page);
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"Senin için"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"İnsanlar gerçekten ne düşünüyor?"})).toHaveCount(0);
});

test("premium onboarding saves real category ids once after login and never casts a demo vote",async({page})=>{
  const mock=await api(page);
  let interestWrites=0;
  let voteWrites=0;
  let savedIds:string[]=[];
  mock.handlers.set("me.get",r=>r.fulfill({status:401,json:failure("UNAUTHENTICATED")}));
  mock.handlers.set("interests.get",r=>r.fulfill({json:{data:{categoryIds:[]}}}));
  mock.handlers.set("interests.put",async r=>{
    interestWrites++;
    savedIds=(await r.request().postDataJSON()).categoryIds;
    await r.fulfill({json:{data:{categoryIds:savedIds}}});
  });
  mock.handlers.set("votes.put",async r=>{
    voteWrites++;
    await r.fulfill({json:sample("votes.put")});
  });

  await page.goto("/");
  await page.getByRole("button",{name:"Bir karar verelim"}).click();
  await page.getByRole("button",{name:"Kendin dene"}).click();
  await page.getByRole("button",{name:"Beklerim",exact:false}).click();
  await page.getByRole("button",{name:"Keşfetmeye devam et"}).click();
  const firstInterest=page.locator('button[aria-pressed="false"]').first();
  await expect(firstInterest).toBeVisible();
  await firstInterest.click();
  await page.getByRole("link",{name:/Sana göre olan kararları/}).click();

  await page.getByLabel("E-posta",{exact:true}).fill("welcome@example.test");
  await page.getByLabel("Şifre",{exact:true}).fill("test-password");
  await page.getByRole("button",{name:"Giriş yap",exact:true}).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading",{name:"Senin için"})).toBeVisible();
  expect(interestWrites).toBe(1);
  expect(savedIds.length).toBe(1);
  expect(voteWrites).toBe(0);
  expect(mock.unexpected).toEqual([]);
});

test("existing interests are preserved instead of being silently overwritten",async({page})=>{
  const mock=await api(page);
  const existingCategoryId="01998b9a-0000-7000-8000-000000000001";
  const draftedCategoryId="01998b9a-0000-7000-8000-000000000099";
  let interestWrites=0;
  mock.handlers.set("me.get",r=>r.fulfill({status:401,json:failure("UNAUTHENTICATED")}));
  mock.handlers.set("interests.get",r=>r.fulfill({json:{data:{categoryIds:[existingCategoryId]}}}));
  mock.handlers.set("interests.put",async r=>{
    interestWrites++;
    await r.fulfill({json:{data:{categoryIds:(await r.request().postDataJSON()).categoryIds}}});
  });

  await page.addInitScript(({categoryId})=>{
    localStorage.setItem("kv-welcome-v1","1");
    localStorage.setItem("kv-welcome-draft-v1",JSON.stringify({
      version:1,
      categoryIds:[categoryId],
      demoChoice:"wait",
      returnTo:"/",
    }));
  },{categoryId:draftedCategoryId});

  await page.goto("/giris?onboarding=1&returnTo=%2F");
  await page.getByLabel("E-posta",{exact:true}).fill("existing@example.test");
  await page.getByLabel("Şifre",{exact:true}).fill("test-password");
  await page.getByRole("button",{name:"Giriş yap",exact:true}).click();

  await expect(page).toHaveURL(/\/$/);
  expect(interestWrites).toBe(0);
  expect(mock.unexpected).toEqual([]);
});

test("direct content links bypass onboarding even for first-time guests",async({page})=>{
  const mock=await api(page);
  mock.handlers.set("me.get",r=>r.fulfill({status:401,json:failure("UNAUTHENTICATED")}));
  const path=sample("polls.get").data.canonicalPath as string;
  await page.goto(path);
  await expect(page.getByRole("heading",{name:"İnsanlar gerçekten ne düşünüyor?"})).toHaveCount(0);
  await expect(page.locator("main h1").first()).toBeVisible();
  expect(mock.unexpected).toEqual([]);
});

test("post-login interests API failure keeps draft and allows retry without logging in again", async ({page}) => {
  const mock = await api(page);
  const categoryId = sample("categories.list").data[0].id as string;
  let writes = 0;
  let successfulWrites = 0;
  mock.handlers.set("me.get", r => r.fulfill({status: 401, json: failure("UNAUTHENTICATED")}));
  mock.handlers.set("interests.get", r => r.fulfill({json: {data: {categoryIds: []}}}));
  mock.handlers.set("interests.put", async r => {
    writes++;
    if (writes === 1) return r.fulfill({status: 503, json: failure("INTERNAL_ERROR")});
    successfulWrites++;
    await r.fulfill({json: {data: {categoryIds: [categoryId]}}});
  });
  await page.addInitScript(({categoryId}) => {
    localStorage.setItem("kv-welcome-v1", "1");
    localStorage.setItem("kv-welcome-draft-v1", JSON.stringify({
      version: 1, categoryIds: [categoryId], demoChoice: "wait", returnTo: "/",
    }));
  }, {categoryId});
  await page.goto("/giris?onboarding=1&returnTo=%2F");
  await page.getByLabel("E-posta", {exact: true}).fill("retry@example.test");
  await page.getByLabel("Şifre", {exact: true}).fill("test-password");
  await page.getByRole("button", {name: "Giriş yap", exact: true}).click();

  await expect(page.getByRole("alert")).toContainText("Giriş başarılı, ancak ilgi alanların kaydedilemedi");
  await expect(page.getByRole("button", {name: "İlgi alanlarını yeniden kaydet"})).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("kv-welcome-draft-v1"))).not.toBeNull();

  await page.getByRole("button", {name: "İlgi alanlarını yeniden kaydet"}).click();
  await expect(page).toHaveURL(/\/$/);
  expect(writes).toBe(2);
  expect(successfulWrites).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("kv-welcome-draft-v1"))).toBeNull();
  expect(mock.unexpected).toEqual([]);
});

import {test,expect} from "@playwright/test";
import {api,failure} from "./api";

test("first guest visit shows onboarding, returning guest keeps discovery",async({page})=>{
  const mock=await api(page);
  mock.handlers.set("me.get",r=>r.fulfill({status:401,json:failure("UNAUTHENTICATED")}));
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"İnsanlar gerçekten ne düşünüyor?"})).toBeVisible();
  await page.getByRole("link",{name:/Zaten üye misin/}).click();
  await expect(page).toHaveURL(/\/giris\?onboarding=1/);
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"Senin için"})).toBeVisible();
  expect(mock.unexpected).toEqual([]);
});

test("authenticated first visit goes directly to feed",async({page})=>{
  await api(page);
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"Senin için"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"İnsanlar gerçekten ne düşünüyor?"})).toHaveCount(0);
});

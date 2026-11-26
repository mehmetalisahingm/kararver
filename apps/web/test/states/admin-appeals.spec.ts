import { test,expect } from "@playwright/test";
import { api, sample, failure } from "./api";
test("appeal queue shows server-confirmed urgency without mutation controls",async({page})=>{
  const mock=await api(page);
  mock.handlers.set("admin.moderation.appeals.list",r=>{
    const body=sample("admin.moderation.appeals.list");
    body.data[0].urgency="OVERDUE";
    return r.fulfill({json:body});
  });
  await page.goto("/admin/appeals");
  await expect(page.getByRole("heading",{name:"Moderasyon itirazları"})).toBeVisible();
  const queue=page.getByRole("region",{name:"Bekleyen itirazlar"});
  await expect(queue.getByText("Hedef aşıldı",{exact:true})).toBeVisible();
  await expect(queue.getByRole("button",{name:/reddet|kabul et/i})).toHaveCount(0);
  expect(mock.unexpected).toEqual([]);
});
test("community moderator cannot open global appeal queue",async({page})=>{
  const mock=await api(page); let reads=0;
  mock.handlers.set("me.get",r=>{const body=sample("me.get");body.data.roles=["MODERATOR"];return r.fulfill({json:body});});
  mock.handlers.set("admin.moderation.appeals.list",r=>{reads++;return r.fulfill({status:403,json:failure("FORBIDDEN")});});
  await page.goto("/admin/appeals");
  await expect(page.getByRole("heading",{name:"Bu bölüm için yetkin yok"})).toBeVisible();
  expect(reads).toBe(0);
});

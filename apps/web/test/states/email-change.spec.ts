import { test, expect } from "@playwright/test";
import { api, sample, failure } from "./api";
const TOKEN="email-change-browser-proof-1234567890";

test("email confirmation cleans the fragment, waits for intent and retries a server failure", async ({page})=>{
  const mock=await api(page);let requests=0, failing=true;
  mock.handlers.set("auth.emailChange.confirm",route=>{
    requests++;expect(route.request().postDataJSON().token).toBe(TOKEN);
    return failing?route.fulfill({status:500,json:failure()}):route.fulfill({json:sample("auth.emailChange.confirm","applied")});
  });
  await page.goto(`/hesap/eposta-degisimi#token=${TOKEN}&step=old&action=approve`);
  await expect(page.getByRole("heading",{name:"E-posta değişikliğini onayla"})).toBeVisible();
  await expect(page).toHaveURL(/\/hesap\/eposta-degisimi$/);
  expect(requests).toBe(0);
  await page.getByRole("button",{name:"Değişikliği onayla",exact:true}).click();
  await expect(page.getByRole("alert").filter({hasText:"İşlem tamamlanamadı"})).toBeVisible();
  failing=false;
  await page.getByRole("button",{name:"Tekrar dene",exact:true}).click();
  await expect(page.getByText(/E-posta adresin değiştirildi/)).toBeVisible();
  expect(requests).toBe(2);expect(mock.unexpected).toEqual([]);
});

test("an expired email link is not applied automatically and cannot be retried",async({page})=>{
  const mock=await api(page);let requests=0;
  mock.handlers.set("auth.emailChange.confirm",route=>{requests++;return route.fulfill({status:400,json:failure("TOKEN_INVALID_OR_EXPIRED")});});
  await page.goto(`/hesap/eposta-degisimi#token=${TOKEN}&step=new&action=approve`);
  await expect(page.getByRole("heading",{name:"Yeni e-posta adresini doğrula"})).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole("button",{name:"Adresi doğrula",exact:true}).click();
  await expect(page.getByRole("alert").filter({hasText:"Bu bağlantı geçersiz"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Tekrar dene",exact:true})).toHaveCount(0);
  expect(requests).toBe(1);expect(mock.unexpected).toEqual([]);
});

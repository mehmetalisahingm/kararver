import { test, expect } from "@playwright/test";
import { api, sample, failure } from "./api";

test("erasure removes content with typed confirmation and retries a rejected MFA without sending the mutation", async ({ page }) => {
  const mock=await api(page);
  let erased=false, rejectMfa=true, mutations=0;
  mock.handlers.set("admin.users.erasure.preview",route=>{
    const response=sample("admin.users.erasure.preview");
    if(erased){response.data.anonymized=true;response.data.canAnonymize=false;response.data.anonymizedAt=new Date().toISOString();}
    return route.fulfill({json:response});
  });
  mock.handlers.set("me.mfa.stepup",route=>rejectMfa?route.fulfill({status:403,json:failure("FORBIDDEN")}):route.fulfill({json:sample("me.mfa.stepup")}));
  mock.handlers.set("admin.users.erasure.create",route=>{
    const body=route.request().postDataJSON();
    expect(body.confirmUsername).toBe("deniz");expect(body.reason).toBe("Kullanıcının doğrulanan silme talebi");
    mutations++;erased=true;
    return route.fulfill({json:sample("admin.users.erasure.create")});
  });
  await page.goto("/admin/users");
  await page.getByRole("button",{name:"Hesabı yönet",exact:true}).first().click();
  const region=page.getByRole("region",{name:"Hesap anonimleştirme (KVKK)"});
  await expect(region).toContainText("4 paylaşım");
  await expect(region).toContainText("12 yorum");
  await expect(region).toContainText("Oyların hesapla bağı kaldırılır");
  await region.getByRole("button",{name:"Hesabı anonimleştir…",exact:true}).click();
  const dialog=page.getByRole("dialog");
  await dialog.getByLabel("Gerekçe",{exact:true}).fill("Kullanıcının doğrulanan silme talebi");
  await dialog.getByLabel(/Onay için kullanıcı adını yaz/).fill("deniz");
  await dialog.getByLabel("Doğrulayıcı kodun",{exact:true}).fill("111111");
  await dialog.getByRole("button",{name:"Anonimleştir",exact:true}).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(mutations).toBe(0);
  rejectMfa=false;
  await dialog.getByLabel("Doğrulayıcı kodun",{exact:true}).fill("123456");
  await dialog.getByRole("button",{name:"Anonimleştir",exact:true}).click();
  await expect(page.getByText(/Kişisel alanlar, paylaşım ve yorum metinleri kaldırıldı/)).toBeVisible();
  expect(mutations).toBe(1);expect(mock.unexpected).toEqual([]);
});

test("legal hold prevents opening the irreversible erasure dialog", async ({ page }) => {
  const mock=await api(page);let mutations=0;
  mock.handlers.set("admin.users.erasure.preview",route=>route.fulfill({json:sample("admin.users.erasure.preview","blocked")}));
  mock.handlers.set("admin.users.erasure.create",route=>{mutations++;return route.fulfill({json:sample("admin.users.erasure.create")});});
  await page.goto("/admin/users");
  await page.getByRole("button",{name:"Hesabı yönet",exact:true}).first().click();
  const region=page.getByRole("region",{name:"Hesap anonimleştirme (KVKK)"});
  await expect(region.getByRole("button",{name:"Hesabı anonimleştir…",exact:true})).toBeDisabled();
  await expect(region.getByText(/Yasal saklama var/)).toBeVisible();
  expect(mutations).toBe(0);expect(mock.unexpected).toEqual([]);
});

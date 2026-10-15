import { test, expect } from "@playwright/test";
import { api, sample, failure } from "./api";
const TOKEN = "self-deletion-browser-proof-1234567890";

test("the deletion link cleans the fragment, waits for an explicit click and shows the result", async ({ page }) => {
  const mock = await api(page);
  let requests = 0;
  mock.handlers.set("auth.deletion.confirm", route => {
    requests++;
    expect(route.request().postDataJSON().token).toBe(TOKEN);
    return route.fulfill({ json: sample("auth.deletion.confirm", "deleted") });
  });
  await page.goto(`/hesap/silme-onayi#token=${TOKEN}&action=confirm`);
  await expect(page.getByRole("heading", { name: "Hesabını kalıcı olarak sil" })).toBeVisible();
  await expect(page).toHaveURL(/\/hesap\/silme-onayi$/);
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Hesabımı kalıcı olarak sil", exact: true }).click();
  await expect(page.getByText(/kalıcı olarak silindi/)).toBeVisible();
  expect(requests).toBe(1);
  expect(mock.unexpected).toEqual([]);
});

test("a missing or unknown action only offers cancel and an expired link cannot be retried", async ({ page }) => {
  const mock = await api(page);
  let requests = 0;
  mock.handlers.set("auth.deletion.cancel", route => {
    requests++;
    return route.fulfill({ status: 400, json: failure("TOKEN_INVALID_OR_EXPIRED") });
  });
  await page.goto(`/hesap/silme-onayi#token=${TOKEN}`);
  await expect(page.getByRole("heading", { name: "Silme talebini iptal et" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hesabımı kalıcı olarak sil" })).toHaveCount(0);
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Bu ben değilim, iptal et", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Bu bağlantı geçersiz" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tekrar dene", exact: true })).toHaveCount(0);
  expect(requests).toBe(1);
  expect(mock.unexpected).toEqual([]);
});

test("the settings request needs the password and the typed username and never deletes by itself", async ({ page }) => {
  const mock = await api(page);
  let requests = 0;
  mock.handlers.set("me.deletion.request", route => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ password: "correct-password123", confirmUsername: "deniz" });
    return route.fulfill({ status: 202, json: sample("me.deletion.request", "ok") });
  });
  await page.goto("/hesap");
  const region = page.getByRole("region", { name: "Hesabımı sil" });
  await expect(region).toBeVisible();
  const submit = region.getByRole("button", { name: /Silme talebi aç/ });
  await expect(submit).toBeDisabled();
  await region.getByLabel("Mevcut parolan").fill("correct-password123");
  await region.getByLabel(/Onay için kullanıcı adını yaz/).fill("deniz");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(region.getByText(/onay bağlantısı gönderdik/)).toBeVisible();
  expect(requests).toBe(1);
  expect(mock.unexpected).toEqual([]);
});

test("an MFA account steps up before the request and a blocked account cannot open one", async ({ page }) => {
  const mock = await api(page);
  const order: string[] = [];
  mock.handlers.set("me.deletion.preview", route => route.fulfill({ json: sample("me.deletion.preview", "pending") }));
  mock.handlers.set("me.mfa.stepup", route => { order.push("stepup"); return route.fulfill({ json: sample("me.mfa.stepup") }); });
  mock.handlers.set("me.deletion.request", route => { order.push("request"); return route.fulfill({ status: 202, json: sample("me.deletion.request", "ok") }); });
  await page.goto("/hesap");
  const region = page.getByRole("region", { name: "Hesabımı sil" });
  await expect(region.getByText(/Silme talebin açık/)).toBeVisible();
  await region.getByLabel("Mevcut parolan").fill("correct-password123");
  await region.getByLabel("Doğrulayıcı kodun").fill("123456");
  await region.getByLabel(/Onay için kullanıcı adını yaz/).fill("deniz");
  await region.getByRole("button", { name: /Yeni onay bağlantısı gönder/ }).click();
  await expect(region.getByText(/onay bağlantısı gönderdik/)).toBeVisible();
  expect(order).toEqual(["stepup", "request"]);
  expect(mock.unexpected).toEqual([]);
});

test("a legal hold blocks the request without exposing a reason", async ({ page }) => {
  const mock = await api(page);
  let requests = 0;
  mock.handlers.set("me.deletion.preview", route => route.fulfill({ json: sample("me.deletion.preview", "blocked") }));
  mock.handlers.set("me.deletion.request", route => { requests++; return route.fulfill({ status: 202, json: sample("me.deletion.request", "ok") }); });
  await page.goto("/hesap");
  const region = page.getByRole("region", { name: "Hesabımı sil" });
  await expect(region.getByText(/saklama yükümlülüğü/)).toBeVisible();
  await expect(region.getByRole("button", { name: /Silme talebi aç/ })).toBeDisabled();
  expect(requests).toBe(0);
  expect(mock.unexpected).toEqual([]);
});

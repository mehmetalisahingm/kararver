import { test, expect } from "@playwright/test";
import { api, sample } from "./api";

test("register requires an explicit 18+ declaration and transmits it to API", async ({ page }) => {
  const mock = await api(page);
  let registrations = 0;
  let declared: unknown = null;

  mock.handlers.set("auth.register", async route => {
    registrations++;
    declared = (await route.request().postDataJSON()).adultConfirmed;
    await route.fulfill({ status: 202, json: sample("auth.register") });
  });

  await page.goto("/kayit");
  const checkbox = page.getByRole("checkbox", { name: /18 yaşımı doldurduğumu beyan ediyorum/ });
  const submit = page.getByRole("button", { name: "Hesap oluştur", exact: true });
  await expect(checkbox).not.toBeChecked();
  await expect(submit).toBeDisabled();

  await page.getByLabel("Görünen ad", { exact: true }).fill("Yaş Testi");
  await page.getByLabel("Kullanıcı adı", { exact: true }).fill("yas_testi");
  await page.getByLabel("E-posta", { exact: true }).fill("yas_testi@example.test");
  await page.getByLabel("Şifre", { exact: true }).fill("Strong-test-password-18");
  await expect(submit).toBeDisabled();
  expect(registrations).toBe(0);

  await checkbox.check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect.poll(() => registrations).toBe(1);
  expect(declared).toBe(true);
});

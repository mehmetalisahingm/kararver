import { test, expect } from "@playwright/test";
import { api, failure } from "./api";

test("a session read that never responds becomes an accessible error and explicit retry recovers", async ({page}) => {
  await page.clock.install();
  const mock = await api(page);
  let requests = 0;
  let recover = false;
  const releases: (() => void)[] = [];
  mock.handlers.set("me.get", route => {
    requests++;
    if (recover) return route.fulfill({status:401,json:failure("UNAUTHENTICATED")});
    return new Promise<void>(resolve => {
      releases.push(() => { void route.fulfill({status:401,json:failure("UNAUTHENTICATED")}).catch(() => {}).finally(resolve); });
    });
  });
  try {
    await page.goto("/giris");
    await expect(page.getByRole("heading", {name:"Oturum kontrol ediliyor…"})).toBeVisible();
    await expect.poll(() => requests).toBeGreaterThan(0);
    // Advance the real application deadline; do not synthesize a network abort.
    await page.clock.fastForward(15_001);
    await expect(page.getByRole("heading", {name:"Bağlantı kurulamadı."})).toBeVisible();
    await expect(page.getByRole("alert").filter({hasText:"Sunucunun yanıtı gecikti"})).toHaveCount(1);
    // Development StrictMode may run initial restoration twice. Neither may retry itself.
    const initialReads = requests;
    await page.clock.fastForward(15_001);
    expect(requests).toBe(initialReads);
    recover = true;
    const retry = page.getByRole("button", {name:"Tekrar dene",exact:true});
    await retry.focus(); await page.keyboard.press("Enter");
    await expect(page.getByLabel("E-posta", {exact:true})).toBeVisible();
    await expect(page.getByLabel("Şifre", {exact:true})).toBeVisible();
    await expect(page.getByRole("heading", {name:"Bağlantı kurulamadı."})).toHaveCount(0);
    expect(requests).toBe(initialReads + 1);
    expect(mock.unexpected).toEqual([]);
  } finally { for (const release of releases) release(); }
});

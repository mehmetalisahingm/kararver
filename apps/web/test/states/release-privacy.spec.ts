import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { api, failure, sample } from "./api";

test("guest, registration and signed-in privacy timeline records only sanitized evidence", async ({ page, context }, info) => {
  const mock = await api(page);
  let signedIn = false;
  mock.handlers.set("me.get", r => {
    if (!signedIn) return r.fulfill({ status: 401, json: failure("UNAUTHENTICATED") });
    const body = sample("me.get"); body.data.roles = ["USER"];
    return r.fulfill({ json: body });
  });
  const requests: { origin: string; type: string }[] = [];
  page.on("request", request => requests.push({ origin: new URL(request.url()).origin, type: request.resourceType() }));
  const evidence: unknown[] = [];
  for (const path of ["/giris", "/kayit", "/hesap"]) {
    signedIn = path === "/hesap";
    await page.goto(path + "?src=019b2234-5678-7abc-8def-0123456789ab");
    const panel = page.getByRole("region", { name: "Çerez ve depolama tercihleri", exact: true });
    const trigger = panel.getByRole("button", { name: "Çerez ve depolama tercihleri", exact: true });
    const open = async () => { await expect(trigger).toHaveAttribute("aria-disabled", "false"); await trigger.click(); };
    for (const action of ["Reddet", "Kabul et", "İzni geri çek"]) {
      await open(); await panel.getByRole("button", { name: action, exact: true }).click();
      await expect(panel.getByRole("status")).toContainText(action === "Kabul et" ? "ölçümü açık" : "ölçümü kapalı");
      const storage = await page.evaluate(() => ({
        keys: Object.keys(localStorage).sort(),
        sourcePresent: localStorage.getItem("kv.share.attribution") !== null,
      }));
      expect(storage.sourcePresent).toBe(action === "Kabul et");
      evidence.push({ path, action, storage, cookies: (await context.cookies()).map(c => ({ name: c.name, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite })) });
    }
    await page.reload();
    await expect(trigger).toHaveAttribute("aria-disabled", "false");
    expect(await page.evaluate(() => localStorage.getItem("kv.share.attribution"))).toBeNull();
  }
  expect(requests.filter(r => !["http://127.0.0.1:3003", "http://127.0.0.1:4012", "https://cdn.kararver.test"].includes(r.origin))).toEqual([]);
  await info.attach("privacy-timeline", { contentType: "application/json", body: JSON.stringify({ scope: "isolated contexts, synthetic API; not provider-panel or legal acceptance", evidence, requests }) });
  expect(mock.unexpected).toEqual([]);
});

for (const mode of ["denied", "quota"] as const) test(`privacy ${mode}: failed persistence never claims consent or clears session`, async ({ page, context }, info) => {
  const mock = await api(page);
  mock.handlers.set("me.get", r => r.fulfill({ status: 401, json: failure("UNAUTHENTICATED") }));
  await context.addCookies([{ name: "release_fixture_session", value: "synthetic-not-authentication", url: "http://127.0.0.1:3003", httpOnly: true, sameSite: "Lax" }]);
  await page.addInitScript(mode => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    if (mode === "denied") Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked in isolated test", "SecurityError"); } });
    else {
      const storage = original.get!.call(window) as Storage;
      storage.setItem("kararver:theme", "light");
      Object.defineProperty(Storage.prototype, "setItem", { value() { throw new DOMException("Isolated quota", "QuotaExceededError"); } });
    }
  }, mode);
  const network: { origin: string; path: string; type: string }[] = [];
  page.on("request", request => { const url = new URL(request.url()); network.push({ origin: url.origin, path: url.pathname, type: request.resourceType() }); });
  await page.goto("/giris?src=019b2234-5678-7abc-8def-0123456789ab");
  const panel = page.getByRole("region", { name: "Çerez ve depolama tercihleri", exact: true });
  const trigger = panel.getByRole("button", { name: "Çerez ve depolama tercihleri", exact: true });
  await expect(trigger).toHaveAttribute("aria-disabled", "false");
  await trigger.focus(); await page.keyboard.press("Enter");
  await expect(panel.getByRole("heading")).toBeFocused();
  await panel.getByRole("button", { name: "Kabul et", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Tercih kaydedilemedi; ölçüm bu sayfada kapalı");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await panel.getByRole("button", { name: "Özelleştir", exact: true }).click();
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".privacy-preferences").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  expect((await context.cookies()).some(c => c.name === "release_fixture_session")).toBe(true);
  expect(network.filter(r => !["http://127.0.0.1:3003", "http://127.0.0.1:4012"].includes(r.origin))).toEqual([]);
  await info.attach("sanitized-network", { contentType: "application/json", body: JSON.stringify(network) });
  await page.screenshot({ path: info.outputPath(`privacy-${mode}.png`), fullPage: true });
  expect(mock.unexpected).toEqual([]);
});

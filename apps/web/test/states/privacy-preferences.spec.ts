import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { api, failure } from "./api";

const preferenceKey = "kv.privacy.preferences";
const attributionKey = "kv.share.attribution";
const sourceId = "019b2234-5678-7abc-8def-0123456789ab";

test("cold hydration keeps preference controls below the first viewport", async ({ page }, info) => {
  const mock = await api(page);
  mock.handlers.set("me.get", route => route.fulfill({ status: 401, json: failure("UNAUTHENTICATED") }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/_next\/.*\.js(?:\?|$)/, async route => { await gate; await route.continue(); });
  try {
    await page.goto("/basla", { waitUntil: "commit" });
    const trigger = page.getByRole("button", { name: "Çerez ve depolama tercihleri", exact: true });
    await expect(trigger).toHaveAttribute("aria-disabled", "true");
    const initial = await trigger.boundingBox();
    expect(initial!.y).toBeGreaterThanOrEqual(page.viewportSize()!.height);
    release();
    await expect(trigger).toHaveAttribute("aria-disabled", "false");
    await expect(page.getByRole("button", { name: "Bir karar verelim" })).toBeEnabled();
    const hydrated = await trigger.boundingBox();
    expect(hydrated!.y).toBeGreaterThanOrEqual(page.viewportSize()!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await info.attach("hydration-geometry", { body: JSON.stringify({ initial, hydrated, viewport: page.viewportSize(), environment: "local Next, fixture API; not physical device/staging" }), contentType: "application/json" });
  } finally { release(); }
});

for (const reduced of [false, true]) test(`preferences keyboard reject/accept/withdraw, ${reduced ? "reduced" : "full"} motion`, async ({ page }, info) => {
  const hydrationErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) hydrationErrors.push(message.text());
  });
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  const mock = await api(page);
  mock.handlers.set("me.get", route => route.fulfill({ status: 401, json: failure("UNAUTHENTICATED") }));
  await page.goto(`/kayit?returnTo=%2Fhesap&src=${sourceId}`);
  const email = page.getByLabel("E-posta", { exact: true });
  await email.fill("privacy-fixture@example.test");
  const panel = page.getByRole("region", { name: "Çerez ve depolama tercihleri", exact: true });
  const trigger = panel.getByRole("button", { name: "Çerez ve depolama tercihleri", exact: true });
  const stored = (key: string) => page.evaluate(key => localStorage.getItem(key), key);
  expect(await stored(preferenceKey)).toBeNull();
  expect(await stored(attributionKey)).toBeNull();

  async function open() {
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(panel.getByRole("heading")).toBeFocused();
    expect(await panel.getByRole("button", { name: "Reddet", exact: true }).evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await panel.getByRole("button", { name: "Kabul et", exact: true }).evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("button", { name: "Reddet", exact: true })).toBeFocused();
  }
  await open();
  await page.keyboard.press("Enter");
  await expect(trigger).toBeFocused();
  await expect(panel.getByRole("status")).toContainText("kapalı");
  expect(JSON.parse((await stored(preferenceKey))!).measurement).toBe(false);
  expect(await stored(attributionKey)).toBeNull();

  await open();
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("button", { name: "Kabul et", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toBeFocused();
  await expect(panel.getByRole("status")).toContainText("açık");
  expect(JSON.parse((await stored(preferenceKey))!).measurement).toBe(true);
  await expect.poll(() => stored(attributionKey)).not.toBeNull();

  await open();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("button", { name: "Özelleştir", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("checkbox")).toBeChecked();
  expect((await new AxeBuilder({ page }).include(".privacy-preferences").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("preferences-customize.png"), fullPage: true });
  // Continue from Customize's replacement Save control to withdrawal.
  await panel.getByRole("button", { name: "İzni geri çek", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(trigger).toBeFocused();
  await expect(panel.getByRole("status")).toContainText("kapalı");
  expect(JSON.parse((await stored(preferenceKey))!).measurement).toBe(false);
  expect(await stored(attributionKey)).toBeNull();
  await expect(email).toHaveValue("privacy-fixture@example.test");
  await expect(page).toHaveURL(/returnTo=%2Fhesap/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(trigger).toHaveAttribute("aria-disabled", "false");
  expect(JSON.parse((await stored(preferenceKey))!).measurement).toBe(false);
  expect(await stored(attributionKey)).toBeNull();
  expect(mock.unexpected).toEqual([]);
  expect(hydrationErrors).toEqual([]);
});

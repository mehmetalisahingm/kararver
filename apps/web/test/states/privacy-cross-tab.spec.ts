import { expect, test } from "@playwright/test";
import { api, failure } from "./api";

const preference = "kv.privacy.preferences";
const attribution = "kv.share.attribution";
const source = "019b2234-5678-7abc-8def-0123456789ab";

test("reject and cross-tab withdrawal prevent source capture and preserve functional storage", async ({ page, context }) => {
  const other = await context.newPage();
  const requests: string[] = [];
  context.on("request", request => requests.push(request.url()));
  for (const tab of [page, other]) {
    const mock = await api(tab);
    mock.handlers.set("me.get", route => route.fulfill({ status: 401, json: failure("UNAUTHENTICATED") }));
  }
  await page.goto("/giris?src=" + source);
  await other.goto("/giris");
  const panel = (tab: typeof page) => tab.getByRole("region", { name: "Çerez ve depolama tercihleri", exact: true });
  const open = async (tab: typeof page) => {
    const trigger = panel(tab).getByRole("button", { name: "Çerez ve depolama tercihleri", exact: true });
    await expect(trigger).toHaveAttribute("aria-disabled", "false");
    await trigger.click();
    await expect(panel(tab).getByRole("heading")).toBeFocused();
  };
  const read = (key: string) => page.evaluate(key => localStorage.getItem(key), key);
  expect(await read(preference)).toBeNull();
  expect(await read(attribution)).toBeNull();
  await page.evaluate(() => {
    localStorage.setItem("kararver:theme", "dark");
    localStorage.setItem("kv-welcome-draft-v1", "privacy-test-functional-draft");
  });
  await open(page);
  await panel(page).getByRole("button", { name: "Reddet", exact: true }).click();
  await page.reload();
  await expect.poll(() => read(preference)).not.toBeNull();
  expect(await read(attribution)).toBeNull();
  await open(page);
  await panel(page).getByRole("button", { name: "Kabul et", exact: true }).click();
  await expect.poll(() => read(attribution)).not.toBeNull();
  await open(other);
  await panel(other).getByRole("button", { name: "Özelleştir", exact: true }).click();
  await expect(panel(other).getByRole("checkbox")).toBeChecked();
  await panel(other).getByRole("button", { name: "İzni geri çek", exact: true }).click();
  await expect.poll(() => read(attribution)).toBeNull();
  await open(page);
  await panel(page).getByRole("button", { name: "Özelleştir", exact: true }).click();
  await expect(panel(page).getByRole("checkbox")).not.toBeChecked();
  await page.reload();
  await expect(panel(page).getByRole("button")).toHaveAttribute("aria-disabled", "false");
  expect(await read(attribution)).toBeNull();
  expect(JSON.parse((await read(preference))!).measurement).toBe(false);
  expect(await read("kararver:theme")).toBe("dark");
  expect(await read("kv-welcome-draft-v1")).toBe("privacy-test-functional-draft");
  await expect(page.locator("iframe")).toHaveCount(0);
  // This fixture verifies app traffic only. Provider scripts/logs need live acceptance.
  expect(requests.filter(url => !["http://127.0.0.1:3003", "http://127.0.0.1:4012"].includes(new URL(url).origin))).toEqual([]);
  await other.close();
});

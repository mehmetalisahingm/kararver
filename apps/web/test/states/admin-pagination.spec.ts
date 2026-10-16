import { test, expect } from "@playwright/test";
import { api, sample } from "./api";

test("changing an admin filter while loading another page resets pagination and discards the old response", async ({ page }) => {
  const mock = await api(page);
  const user = sample("admin.users.list").data[0];
  let oldPage!: () => void;
  const oldPending = new Promise<void>(resolve => { oldPage = resolve; });
  let filteredPages = 0;
  mock.handlers.set("admin.users.list", async (route, url) => {
    const filtered = url.searchParams.get("q") === "deniz";
    const cursor = url.searchParams.get("cursor");
    if (cursor && !filtered) {
      await oldPending;
      try { await route.fulfill({ json: { data: [{ ...user, displayName: "Eski sayfadan gelmemeli" }], page: { hasMore: false, nextCursor: null } } }); } catch { /* Filtre değişince tarayıcı isteği iptal eder. */ }
      return;
    }
    if (cursor) filteredPages++;
    await route.fulfill({ json: {
      data: [{ ...user, id: cursor ? "01998b9a-0000-7000-8000-000000000099" : user.id, displayName: cursor ? "Filtreli ikinci kullanıcı" : filtered ? "Filtreli ilk kullanıcı" : "İlk kullanıcı" }],
      page: { hasMore: !cursor, nextCursor: cursor ? null : "next-page" },
    } });
  });
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Daha fazla göster", exact: true }).click();
  await expect(page.getByRole("button", { name: "Yükleniyor…", exact: true })).toBeDisabled();
  await page.getByLabel("Kullanıcı adı veya e-posta", { exact: true }).fill("deniz");
  await page.getByRole("button", { name: "Ara", exact: true }).click();
  await expect(page.getByText("Filtreli ilk kullanıcı", { exact: false })).toBeVisible();
  const more = page.getByRole("button", { name: "Daha fazla göster", exact: true });
  await expect(more).toBeEnabled();
  oldPage();
  await more.click();
  await expect(page.getByText("Filtreli ikinci kullanıcı", { exact: false })).toBeVisible();
  await expect(page.getByText("Eski sayfadan gelmemeli", { exact: false })).toHaveCount(0);
  expect(filteredPages).toBe(1);
  expect(mock.unexpected).toEqual([]);
});

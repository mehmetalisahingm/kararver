import { test, expect } from "@playwright/test";
import { api, sample } from "./api";

test("audit export downloads sanitized visible records and disables empty exports", async ({ page }) => {
  const mock = await api(page);
  await page.goto("/admin/audit");
  const group = page.getByRole("group", { name: "Audit dışa aktarma" });
  await expect(group.getByRole("button", { name: "Yüklenen kayıtları JSON indir" })).toBeEnabled();
  for (const format of ["CSV", "JSON"]) {
    const [file] = await Promise.all([page.waitForEvent("download"), group.getByRole("button", { name: `Yüklenen kayıtları ${format} indir` }).click()]);
    const stream = await file.createReadStream();
    const chunks = [];
    for await (const chunk of stream!) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    expect(file.suggestedFilename()).toMatch(new RegExp(`^kararver-audit-.*\\.${format.toLowerCase()}$`));
    if (format === "JSON") {
      expect(JSON.parse(text).count).toBe(sample("admin.audit.list").data.length);
      expect(JSON.parse(text).scope).toBe("loaded_records");
    } else expect(text).toContain('"createdAt UTC"');
  }
  mock.handlers.set("admin.audit.list", r => r.fulfill({ json: { data: [], page: { hasMore: false, nextCursor: null } } }));
  await page.reload();
  await expect(group.getByRole("button", { name: "Yüklenen kayıtları CSV indir" })).toBeDisabled();
  expect(mock.unexpected).toEqual([]);
});

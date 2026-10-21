import { test, expect } from "@playwright/test";
import { api } from "./api";

test("session status change immediately drops stale session rows and revocation actions", async ({ page }) => {
  const mock = await api(page);
  const now = "2026-10-18T08:00:00.000Z";
  let releaseRevoked!: () => void;
  let revokedStarted!: () => void;
  const pendingRevoked = new Promise<void>(resolve => { releaseRevoked = resolve; });
  const queriedRevoked = new Promise<void>(resolve => { revokedStarted = resolve; });
  const session = (status: "ACTIVE" | "REVOKED", name: string) => ({
    id: status === "ACTIVE" ? "01998b9a-0000-7000-8000-000000000091" : "01998b9a-0000-7000-8000-000000000092",
    status,
    userAgent: name,
    ipAddress: "192.0.2.0/24",
    createdAt: now,
    lastSeenAt: now,
    expiresAt: "2026-10-30T08:00:00.000Z",
    revokedAt: status === "REVOKED" ? now : null,
  });
  mock.handlers.set("admin.users.sessions.list", async (route, url) => {
    const status = url.searchParams.get("status");
    if (status === "revoked") {
      revokedStarted();
      await pendingRevoked;
    }
    const row = status === "revoked"
      ? session("REVOKED", "İptal edilmiş cihaz")
      : session("ACTIVE", "Eski aktif cihaz");
    try {
      await route.fulfill({ json: { data: [row], page: { hasMore: false, nextCursor: null } } });
    } catch { /* A previous filtered request may have been aborted. */ }
  });
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Hesabı yönet", exact: true }).first().click();
  const panel = page.getByRole("region", { name: "Kullanıcı oturumları" });
  await expect(panel.getByText("Eski aktif cihaz", { exact: false })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Tüm aktif oturumları kapat" })).toBeEnabled();

  await panel.getByLabel("Oturum durumu").selectOption("revoked");
  await queriedRevoked;
  await expect(panel.getByText("Eski aktif cihaz", { exact: false })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Tüm aktif oturumları kapat" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Bu oturumu kapat" })).toHaveCount(0);
  releaseRevoked();
  await expect(panel.getByText("İptal edilmiş cihaz", { exact: false })).toBeVisible();
  await expect(panel.getByText("Eski aktif cihaz", { exact: false })).toHaveCount(0);
  expect(mock.unexpected).toEqual([]);
});

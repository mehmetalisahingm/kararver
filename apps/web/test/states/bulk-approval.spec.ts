import { test, expect } from "@playwright/test";
import { api, sample, failure } from "./api";

const DIGEST = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

test("a high-volume bulk action is sent for second approval instead of being applied", async ({ page }) => {
  const mock = await api(page);
  let applied = 0;
  mock.handlers.set("admin.moderation.polls.bulkPreview", route => {
    const preview = sample("admin.moderation.polls.bulkPreview");
    preview.data.approval = { required: true, threshold: 20, windowMinutes: 60, windowApplied: 19 };
    return route.fulfill({ json: preview });
  });
  mock.handlers.set("admin.moderation.polls.bulk", route => {
    applied++;
    expect(route.request().postDataJSON().digest).toBe(DIGEST);
    return route.fulfill({ status: 202, json: sample("admin.moderation.polls.bulk", "approval-required") });
  });
  await page.goto("/admin/polls");
  await page.getByRole("checkbox", { name: /^Seç:/ }).first().check();
  await page.getByRole("button", { name: /Seçilenlere toplu işlem/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Önizleme al", exact: true }).click();
  await expect(dialog.getByRole("note")).toContainText("İkinci onay gerekir");
  await expect(dialog.getByRole("note")).toContainText("son 60 dakikada onaysız 19 kayıt");
  await dialog.getByLabel("Gerekçe", { exact: true }).fill("Spam dalgası temizliği");
  await dialog.getByRole("button", { name: "Onaya gönder", exact: true }).click();
  await expect(page.getByText(/ikinci onay talebi açıldı; başka bir yönetici onaylayana kadar hiçbir şey değişmez/)).toBeVisible();
  expect(applied).toBe(1);
  expect(mock.unexpected).toEqual([]);
});

test("a second admin reviews the records, verifies with the authenticator code and approves; a failed approval keeps the verified code", async ({ page }) => {
  const mock = await api(page);
  const calls: string[] = [];
  let approveAttempts = 0;
  mock.handlers.set("me.mfa.stepup", route => { calls.push("stepup"); expect(route.request().postDataJSON().code).toBe("123456"); return route.fulfill({ json: sample("me.mfa.stepup") }); });
  mock.handlers.set("admin.moderation.bulkApprovals.approve", route => {
    calls.push("approve");
    expect(route.request().postDataJSON().reason).toBe("Kayıtları inceledim");
    if (approveAttempts++ === 0) return route.fulfill({ status: 409, json: { error: { code: "CONFLICT", message: "Bu talep artık açık değil.", details: [{ code: "closed" }] }, requestId: "kv-test" } });
    return route.fulfill({ json: sample("admin.moderation.bulkApprovals.approve") });
  });
  await page.goto("/admin/polls");
  await page.getByText("Toplu işlem onayları", { exact: true }).click();
  const list = page.getByRole("list", { name: "Onay talepleri" });
  await expect(list).toContainText("Onay bekliyor");
  await expect(list).toContainText("24 kayıt");
  await list.getByRole("button", { name: "İncele ve onayla…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("table", { name: "Onaylanacak kayıtlar" })).toContainText("Bu karar doğru mu?");
  await dialog.getByLabel("Gerekçe", { exact: true }).fill("Kayıtları inceledim");
  await dialog.getByRole("button", { name: "Onayla ve uygula", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Doğrulayıcı kodunu");
  expect(calls).toEqual([]);
  await dialog.getByLabel("Doğrulayıcı kodun").fill("123456");
  await dialog.getByRole("button", { name: "Onayla ve uygula", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("artık açık değil");
  await expect(dialog.getByText("Kod doğrulandı")).toBeVisible();
  await dialog.getByRole("button", { name: "Onayla ve uygula", exact: true }).click();
  await expect(page.getByText(/Onaylandı ve uygulandı: 1 uygulandı/)).toBeVisible();
  expect(calls).toEqual(["stepup", "approve", "approve"]);
  expect(mock.unexpected).toEqual([]);
});

test("an expired verification reopens the code field so the reviewer can verify again", async ({ page }) => {
  const mock = await api(page);
  const codes: string[] = [];
  let attempts = 0;
  mock.handlers.set("me.mfa.stepup", route => { codes.push(route.request().postDataJSON().code); return route.fulfill({ json: sample("me.mfa.stepup") }); });
  mock.handlers.set("admin.moderation.bulkApprovals.approve", route => {
    if (attempts++ === 0) return route.fulfill({ status: 403, json: sample("admin.moderation.bulkApprovals.approve", "stepup-required") });
    return route.fulfill({ json: sample("admin.moderation.bulkApprovals.approve") });
  });
  await page.goto("/admin/polls");
  await page.getByText("Toplu işlem onayları", { exact: true }).click();
  await page.getByRole("list", { name: "Onay talepleri" }).getByRole("button", { name: "İncele ve onayla…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Gerekçe", { exact: true }).fill("Kayıtları inceledim");
  await dialog.getByLabel("Doğrulayıcı kodun").fill("111111");
  await dialog.getByRole("button", { name: "Onayla ve uygula", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("doğrulayıcı kodunla");
  // Doğrulama süresi dolmuş/tüketilmiş: kod alanı yeniden açılır ve yeni kod istenir.
  await expect(dialog.getByLabel("Doğrulayıcı kodun")).toBeVisible();
  await expect(dialog.getByLabel("Doğrulayıcı kodun")).toHaveValue("");
  await dialog.getByLabel("Doğrulayıcı kodun").fill("222222");
  await dialog.getByRole("button", { name: "Onayla ve uygula", exact: true }).click();
  // Success is rendered in both the inline status and global notification.
  // Narrow to one visible occurrence rather than Playwright's strict multi-match error.
  await expect(page.getByText(/Onaylandı ve uygulandı/).first()).toBeVisible();
  expect(codes).toEqual(["111111", "222222"]);
  expect(mock.unexpected).toEqual([]);
});

test("a stale request cannot be approved from the dialog", async ({ page }) => {
  const mock = await api(page);
  let approved = 0;
  mock.handlers.set("admin.moderation.bulkApprovals.get", route => {
    const detail = sample("admin.moderation.bulkApprovals.get");
    detail.data.stale = true;
    return route.fulfill({ json: detail });
  });
  mock.handlers.set("admin.moderation.bulkApprovals.approve", route => { approved++; return route.fulfill({ status: 500, json: failure() }); });
  await page.goto("/admin/polls");
  await page.getByText("Toplu işlem onayları", { exact: true }).click();
  await page.getByRole("list", { name: "Onay talepleri" }).getByRole("button", { name: "İncele ve onayla…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert").first()).toContainText("talepten sonra değişti");
  await dialog.getByLabel("Gerekçe", { exact: true }).fill("Kayıtları inceledim");
  await dialog.getByLabel("Doğrulayıcı kodun").fill("123456");
  await dialog.getByRole("button", { name: "Onayla ve uygula", exact: true }).click();
  expect(approved).toBe(0);
  expect(mock.unexpected).toEqual([]);
});

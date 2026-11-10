import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { api, sample, failure, empty } from "./api";

test("15 synthetic public polls retain API order without invented votes; removal clears discovery", async ({ page }, info) => {
  const mock = await api(page);
  mock.handlers.set("me.get", r => r.fulfill({ status: 401, json: failure("UNAUTHENTICATED") }));
  const base = sample("feed.list").data[0];
  const cards = Array.from({ length: 15 }, (_, i) => ({ ...structuredClone(base),
    id: `01998b9a-0000-7000-8000-${String(i + 1).padStart(12, "0")}`,
    title: `${String(i + 1).padStart(2, "0")} · ${i % 3 === 0 ? "Uzun bir günlük yaşam kararı için farklı seçenekleri birlikte değerlendirirken hangi yaklaşımı tercih edersin?" : "Günün kararını nasıl verirsin?"}`,
    coverImage: null, results: { visible: false }, commentCount: 0,
  }));
  mock.handlers.set("feed.list", r => r.fulfill({ json: { ...empty(), data: cards } }));
  await page.goto("/kesfet");
  const titles = page.locator(".poll-card h2");
  await expect(titles).toHaveText(cards.map(c => c.title));
  await expect(page.locator(".poll-card progress")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("15-synthetic-polls.png"), fullPage: true });
  mock.handlers.set("feed.list", r => r.fulfill({ json: empty() }));
  await page.reload();
  await expect(titles).toHaveCount(0);
  await expect(page.getByRole("link", { name: "İlk soruyu sor", exact: true })).toHaveAttribute("href", "/olustur");
  mock.handlers.set("search.query", r => r.fulfill({ json: empty() }));
  mock.handlers.set("profiles.polls", r => r.fulfill({ json: empty() }));
  mock.handlers.set("trends.list", r => r.fulfill({ json: { ...empty(), meta: null, reason: "INSUFFICIENT_HISTORY" } }));
  for (const route of ["/kesfet?q=karar", "/kategori/otomobil", "/yukselenler", "/profil/deniz"]) {
    await page.goto(route);
    await expect(page.locator("main h1").first()).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByText(cards[0].title, { exact: true })).toHaveCount(0);
  }
  mock.handlers.set("polls.get", r => r.fulfill({ status: 404, json: failure("NOT_FOUND") }));
  await page.goto(`/karar/${cards[0].id}`);
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.getByText(cards[0].title, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Oy ver$/ })).toHaveCount(0);
  await info.attach("scope", { contentType: "text/plain", body: "Synthetic API contract fixtures only. No real content deleted/published; live OG/CDN cache purge not tested." });
  expect(mock.unexpected).toEqual([]);
});

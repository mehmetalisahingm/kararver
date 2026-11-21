import { test, expect } from "@playwright/test";
const path = "/karar/01998b9a-0000-7000-8000-000000000020";
test.describe.configure({ mode: "serial" });
test("public HTML includes poll body and OG without a session or script execution", async ({ request }, info) => {
  await request.post("http://127.0.0.1:4015/__scenario/public");
  const response = await request.get(path);
  expect(response.status()).toBe(200);
  const html = await response.text();
  await info.attach("public-html", { contentType: "text/html", body: html });
  expect([...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map(m => m[1])).toContain("PUBLIC_SSR_FIXTURE_TITLE");
  expect(html.includes('property="og:title" content="PUBLIC_SSR_FIXTURE_TITLE')).toBe(true);
  expect(html.includes("Oturum kontrol ediliyor")).toBe(false);
  expect(html.includes('"total":20')).toBe(false);
});
test("removed poll is 404/noindex and the previous title is absent from HTML and OG", async ({ request }) => {
  await request.post("http://127.0.0.1:4015/__scenario/removed");
  const response = await request.get(path);
  expect(response.status()).toBe(404);
  const html = await response.text();
  expect(html.includes("noindex")).toBe(true);
  expect(html.includes("PUBLIC_SSR_FIXTURE_TITLE")).toBe(false);
});
test("upstream outage is an error, never a false permanent 404 or cached old poll", async ({ request }) => {
  await request.post("http://127.0.0.1:4015/__scenario/error");
  const response = await request.get(path);
  expect(response.status()).toBeGreaterThanOrEqual(500);
  expect((await response.text()).includes("PUBLIC_SSR_FIXTURE_TITLE")).toBe(false);
});

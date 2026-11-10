import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test/public-read", outputDir: "public-read-results", workers: 1, fullyParallel: false,
  timeout: 90000, expect: { timeout: 15000 },
  use: { baseURL: "http://127.0.0.1:3006", extraHTTPHeaders: { "User-Agent": "Twitterbot/1.0" } },
  webServer: { command: "node scripts/serve-public-read-tests.mjs", url: "http://127.0.0.1:3006/giris", reuseExistingServer: false, timeout: 120000 },
});

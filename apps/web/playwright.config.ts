import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test/browser",
  workers: 1,
  timeout: 60000,
  use: {
    browserName: (process.env.KV_BROWSER || "chromium") as "chromium" | "firefox" | "webkit",
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 1440, height: 1000 },
    launchOptions: process.env.KV_BROWSER_PATH
      ? { executablePath: process.env.KV_BROWSER_PATH }
      : {},
  },
  webServer: {
    command: "node scripts/serve-demo.mjs",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});

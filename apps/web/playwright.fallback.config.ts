import { defineConfig } from "@playwright/test";

// The root error document must work even when the Next app cannot start.
export default defineConfig({
  testDir: "./test/states",
  testMatch: "global-error.spec.ts",
  workers: 1,
  use: {
    browserName: (process.env.KV_BROWSER || "chromium") as "chromium" | "firefox" | "webkit",
    launchOptions: process.env.KV_BROWSER_PATH ? { executablePath: process.env.KV_BROWSER_PATH } : {},
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 360, height: 800 } } },
  ],
});

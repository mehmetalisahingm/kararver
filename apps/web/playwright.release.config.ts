import { defineConfig } from "@playwright/test";
import states from "./playwright.states.config";

const browserName = (process.env.KV_BROWSER || "chromium") as "chromium" | "firefox" | "webkit";
export default defineConfig({
  ...states,
  testMatch: /release-.*\.spec\.ts/,
  testIgnore: [],
  outputDir: "release-results",
  reporter: [["list"], ["html", { outputFolder: "release-report", open: "never" }]],
  projects: [360, 390, 768, 1440].map(width => ({
    name: `${browserName}-${width}`,
    use: { viewport: { width, height: 1000 }, hasTouch: width < 768,
      ...(browserName !== "firefox" ? { isMobile: width < 768 } : {}) },
  })),
});

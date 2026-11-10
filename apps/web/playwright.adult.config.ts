import { defineConfig } from "@playwright/test";
import states from "./playwright.states.config";
const browserName = (process.env.KV_BROWSER || "chromium") as "chromium" | "firefox" | "webkit";
export default defineConfig({ ...states,
  testMatch: /(?:adult-declaration|age-policy)\.spec\.ts/,
  outputDir: "adult-results",
  projects: [360, 390, 1440].map(width => ({ name: `${browserName}-${width}`, use: {
    viewport: { width, height: 1000 }, hasTouch: width < 768,
    ...(browserName !== "firefox" ? { isMobile: width < 768 } : {}),
  } })),
});

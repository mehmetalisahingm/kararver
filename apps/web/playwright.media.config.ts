import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir:"./test/media",workers:1,timeout:60000,
  use:{baseURL:"http://127.0.0.1:3004",trace:"retain-on-failure",screenshot:"only-on-failure",launchOptions:process.env.KV_BROWSER_PATH?{executablePath:process.env.KV_BROWSER_PATH}:{}},
  projects:[{name:"desktop",use:{viewport:{width:1440,height:1000}}},{name:"mobile",use:{viewport:{width:360,height:800}}}],
  webServer:{command:"node scripts/serve-media-tests.mjs",url:"http://127.0.0.1:3004",reuseExistingServer:false,timeout:120000},
});

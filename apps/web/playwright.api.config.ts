import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir:"./test/integration",workers:1,timeout:60000,
  use:{baseURL:"http://127.0.0.1:3002",launchOptions:process.env.KV_BROWSER_PATH?{executablePath:process.env.KV_BROWSER_PATH}:{}},
  webServer:[
    {command:"node scripts/test-auth-server.mjs",url:"http://127.0.0.1:4011/health",reuseExistingServer:false},
    {command:"node scripts/serve-api-test.mjs",url:"http://127.0.0.1:3002",reuseExistingServer:false,timeout:120000},
  ],
});

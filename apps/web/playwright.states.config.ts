import { defineConfig } from "@playwright/test";
const browserName = (process.env.KV_BROWSER || "chromium") as "chromium" | "firefox" | "webkit";
export default defineConfig({
  testDir:"./test/states", workers:1, timeout:90000,
  expect:{timeout:10000},
  reporter:[["list"],["html",{outputFolder:"state-report",open:"never"}]],
  use:{baseURL:"http://127.0.0.1:3003",browserName,trace:"retain-on-failure",screenshot:"only-on-failure",
    launchOptions:process.env.KV_BROWSER_PATH?{executablePath:process.env.KV_BROWSER_PATH}:{},
  },
  projects:[
    {name:`${browserName}-desktop`,use:{viewport:{width:1440,height:1000}}},
    {name:`${browserName}-mobile`,use:{viewport:{width:360,height:800},hasTouch:true,...(browserName!=="firefox"?{isMobile:true}:{})}},
  ],
  webServer:{command:"node scripts/serve-state-tests.mjs",url:"http://127.0.0.1:3003",reuseExistingServer:false,timeout:120000},
});

import { spawn } from "node:child_process";
import "./sync-assets.mjs";
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3003"], {
  stdio:"inherit", env:{...process.env,NEXT_PUBLIC_KV_DATA_MODE:"api",NEXT_PUBLIC_API_URL:"http://127.0.0.1:4012"},
});
for (const signal of ["SIGINT","SIGTERM"]) process.once(signal,()=>child.kill(signal));
child.once("exit",code=>process.exit(code??1));

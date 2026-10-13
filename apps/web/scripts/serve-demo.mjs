import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import "./sync-assets.mjs";
const require = createRequire(import.meta.url);
const child = spawn(
  process.execPath,
  [
    require.resolve("next/dist/bin/next"),
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    process.env.PORT || "3000",
  ],
  {
    stdio: "inherit",
    // #187: demo yalnız izinli APP_ENV ile açılır; verilmemişse yerel geliştirme sayılır.
    env: { ...process.env, APP_ENV: process.env.APP_ENV || "local", NEXT_PUBLIC_KV_DATA_MODE: "demo" },
  },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code || 0;
});

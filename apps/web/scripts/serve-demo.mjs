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
    env: { ...process.env, NEXT_PUBLIC_KV_DATA_MODE: "demo" },
  },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code || 0;
});

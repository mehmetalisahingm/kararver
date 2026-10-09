import { spawn } from "node:child_process";

const processes = [
  ["api", ["--filter", "@kararver/api", "start"]],
  ["worker", ["--filter", "@kararver/worker", "start"]],
];

const children = processes.map(([name, args]) => {
  const child = spawn("pnpm", args, { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
  child.on("exit", (code, signal) => {
    if (code && code !== 0) console.error(`[${name}] exited with code ${code}`);
    if (signal) console.error(`[${name}] exited with signal ${signal}`);
  });
  return child;
});

let stopping = false;
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
};
process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

await Promise.race(children.map((child) => new Promise((resolve) => child.once("exit", resolve))));
stop("SIGTERM");
process.exitCode = 1;

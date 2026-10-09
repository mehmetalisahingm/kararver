import { spawn } from "node:child_process";

const children = new Set();
let apiExited = false;
let stopping = false;

function start(name, args) {
  const child = spawn("pnpm", args, { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
  children.add(child);
  child.once("exit", (code, signal) => {
    children.delete(child);
    console.error(`[${name}] exited`, { code, signal });
    if (name === "api") {
      apiExited = true;
      stop("SIGTERM");
      return;
    }
    if (!stopping) setTimeout(() => start(name, args), 2_000).unref();
  });
  return child;
}

let stopping = false;
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
};
process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

start("api", ["--filter", "@kararver/api", "start"]);
start("worker", ["--filter", "@kararver/worker", "start"]);

while (!apiExited && !stopping) await new Promise((resolve) => setTimeout(resolve, 1_000));
process.exitCode = apiExited ? 1 : 0;

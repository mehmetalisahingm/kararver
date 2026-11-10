// Local-only synthetic HTTP adapter for SSR/crawler acceptance. No database.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { examples } from "@kararver/contracts/fixtures";
import "./sync-assets.mjs";
let scenario = "public";
const fixture = structuredClone(examples.find(e => e.endpoint === "polls.get" && e.name === "guest-hidden").body);
fixture.data.title = "PUBLIC_SSR_FIXTURE_TITLE";
fixture.data.description = "Public description for isolated crawler acceptance.";
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://127.0.0.1:4015").pathname;
  response.setHeader("content-type", "application/json");
  if (request.method === "POST" && path.startsWith("/__scenario/")) {
    scenario = path.split("/").at(-1); response.end("{}"); return;
  }
  if (path.startsWith("/v1/polls/")) {
    response.statusCode = scenario === "public" ? 200 : scenario === "removed" ? 404 : 503;
    response.end(JSON.stringify(scenario === "public" ? fixture : { error: { code: scenario === "removed" ? "NOT_FOUND" : "INTERNAL_ERROR", message: "Synthetic response", details: [] }, requestId: "ssr-fixture" }));
    return;
  }
  response.statusCode = 404; response.end("{}");
});
await new Promise(resolve => server.listen(4015, "127.0.0.1", resolve));
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3006"], {
  stdio: "inherit", env: { ...process.env, APP_ENV: "production", NEXT_PUBLIC_KV_DATA_MODE: "api", NEXT_PUBLIC_API_URL: "http://127.0.0.1:4015", API_URL: "http://127.0.0.1:4015", WEB_URL: "http://127.0.0.1:3006" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { child.kill(signal); server.close(); });
child.once("exit", code => { server.close(); process.exit(code ?? 1); });

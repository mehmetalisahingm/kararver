// Minimal, dependency-free Render readiness endpoint for infrastructure-only migration checks.
// IMPORTANT: This is not the KararVer API. Never expose user content until DB + media restore is verified.
// All non-health routes deliberately return HTTP 503 to prevent accidental traffic cutover.
import { createServer } from "node:http";

const port = Number(process.env.PORT || 10000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Invalid PORT");
}
const status = Object.freeze({
  service: "kararver-api-free-preview",
  phase: "migration-preparation",
  readyForUserTraffic: false,
  railwayDataRestored: false,
  apiEnabled: false,
});
const server = createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "null");
  const method = req.method || "GET";
  const path = (req.url || "/").split("?")[0];
  if ((method === "GET" || method === "HEAD") && path === "/health") {
    res.writeHead(200);
    return res.end(method === "HEAD" ? undefined : JSON.stringify(status));
  }
  res.setHeader("Retry-After", "3600");
  res.writeHead(503);
  return res.end(method === "HEAD" ? undefined : JSON.stringify({
    error: "Migration preview only. The KararVer API has not been deployed.",
    readyForUserTraffic: false,
  }));
});
server.listen(port, "0.0.0.0", () => {
  console.info("KararVer migration-only preview listening", { port });
});
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}

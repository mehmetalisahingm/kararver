// KV-06 smoke: çalışan bir API + web ikilisine karşı sadece public uçlarla kontrol (secret gerekmez).
// Kullanım: pnpm smoke --api <url> --web <url>
// CI'da yerel production build'e, workflow_dispatch ile staging'e karşı koşar (.github/workflows/foundation.yml).
// Her kontrol bir satır yazar: PASS / WARN / SKIP / FAIL. Bir FAIL bile varsa çıkış kodu 1'dir.
// https adreslerde Strict-Transport-Security ve her Set-Cookie'de Secure zorunludur. Staging'de bunlar
// FAIL verirse kod hatası değil, hosting/proxy (TLS sonlandırma, başlık ekleme) ayarı bulgusudur.
import { parseArgs } from "node:util";
import { getEndpoint } from "../packages/contracts/src/index.ts";

// Sözleşmede olup API'de henüz olmayan uçlar. 404 dönerse SKIP yazılır; uç gelince (200) listeden
// çıkarılması için FAIL verilir. Listede olmayan her uç zorunludur.
const KNOWN_MISSING = {
  "/v1/config": "KV-40 (#42): buildPublicConfig 6 varsayılan için karar bekliyor (KV-04 açık konu 8)",
};

const { values } = parseArgs({
  options: { api: { type: "string" }, web: { type: "string" }, strict: { type: "boolean", default: false } },
});
if (!values.api || !values.web) {
  console.error("Kullanım: pnpm smoke --api <url> --web <url> [--strict]");
  process.exit(2);
}
const apiBase = values.api.replace(/\/$/, "");
const webBase = values.web.replace(/\/$/, "");

const results = [];
const report = (status, name, detail = "") => {
  results.push(status);
  console.log(`${status.padEnd(4)} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function get(url) {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    return { res, text };
  } catch (err) {
    return { error: err };
  }
}

function json(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function zodIssues(error) {
  return error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(kök)"}: ${i.message}`).join("; ");
}

// Her cevapta: mock'a karşı koşmadığımızı ve sunucu imzası sızmadığını doğrula.
function checkHeaders(name, url, res) {
  if (res.headers.get("x-mock") !== null) report("FAIL", `${name} X-Mock yok`, `X-Mock: ${res.headers.get("x-mock")} (mock API'ye karşı koşuluyor)`);
  if (res.headers.get("x-powered-by") !== null) report("FAIL", `${name} X-Powered-By yok`, res.headers.get("x-powered-by"));
  const https = new URL(url).protocol === "https:";
  for (const cookie of res.headers.getSetCookie()) {
    const cookieName = cookie.split("=")[0];
    if (!/;\s*secure/i.test(cookie)) report(https ? "FAIL" : "WARN", `${name} cookie ${cookieName} Secure`, `Secure işareti yok${https ? " (hosting/proxy bulgusu)" : ""}`);
  }
  if (https && !res.headers.get("strict-transport-security")) report("FAIL", `${name} Strict-Transport-Security`, "https cevabında yok (hosting/proxy bulgusu)");
}

// Endpoint sözleşmesindeki 200 şemasıyla doğrula; KNOWN_MISSING kuralını uygula.
async function checkEndpoint(id, { nonEmpty = false } = {}) {
  const endpoint = getEndpoint(id);
  const path = `/v1${endpoint.path}`;
  const name = `GET ${path}`;
  const { res, text, error } = await get(apiBase + path);
  if (error) return report("FAIL", name, `istek başarısız: ${error.message}`);
  checkHeaders(name, apiBase + path, res);
  const known = KNOWN_MISSING[path];
  if (known && res.status === 404) return report("SKIP", name, `404, bilinen eksik: ${known}`);
  if (res.status !== 200) return report("FAIL", name, `HTTP ${res.status}`);
  const parsed = endpoint.responses[200].safeParse(json(text));
  if (!parsed.success) report("FAIL", `${name} sözleşme (${id})`, zodIssues(parsed.error));
  else if (nonEmpty && parsed.data.data.length === 0) report("FAIL", name, "liste boş");
  else report("PASS", name, nonEmpty ? `${id} şemasına uygun, ${parsed.data.data.length} kayıt` : `${id} şemasına uygun`);
  if (known) report("FAIL", name, "artık var: scripts/smoke.mjs KNOWN_MISSING listesinden çıkarın");
}

async function checkHealth() {
  const { res, text, error } = await get(`${apiBase}/health`);
  if (error) return report("FAIL", "GET /health", `istek başarısız: ${error.message}`);
  checkHeaders("GET /health", `${apiBase}/health`, res);
  if (res.status !== 200 || json(text)?.status !== "ok") return report("FAIL", "GET /health", `HTTP ${res.status} ${text.slice(0, 80)}`);
  report("PASS", "GET /health", "200 {status:\"ok\"}");
}

async function checkWeb() {
  const { res, text, error } = await get(`${webBase}/`);
  if (error) return report("FAIL", "web GET /", `istek başarısız: ${error.message}`);
  checkHeaders("web GET /", `${webBase}/`, res);
  if (res.status !== 200) return report("FAIL", "web GET /", `HTTP ${res.status}`);
  report("PASS", "web GET /", "200");
  if (/demo-banner|demo-controls/.test(text)) report("FAIL", "web demo modu kapalı", "HTML'de demo afişi var");
  else report("PASS", "web demo modu kapalı", "HTML'de demo afişi yok");
  // Bugün ne web ne API bu başlıkları vermiyor; --strict ile zorunlu olur.
  const recommended = {
    "content-security-policy": "Content-Security-Policy",
    "x-content-type-options": "X-Content-Type-Options",
    "x-frame-options": "X-Frame-Options (veya CSP frame-ancestors)",
  };
  for (const [header, label] of Object.entries(recommended)) {
    if (res.headers.get(header)) report("PASS", `web ${label}`, res.headers.get(header));
    else report(values.strict ? "FAIL" : "WARN", `web ${label}`, "yok");
  }
}

console.log(`smoke → api ${apiBase} · web ${webBase}`);
await checkHealth();
await checkEndpoint("config.get");
await checkEndpoint("categories.list", { nonEmpty: true });
await checkWeb();

const count = (s) => results.filter((r) => r === s).length;
console.log(`\nSonuç: ${count("PASS")} PASS · ${count("WARN")} WARN · ${count("SKIP")} SKIP · ${count("FAIL")} FAIL`);
process.exitCode = count("FAIL") > 0 ? 1 : 0;

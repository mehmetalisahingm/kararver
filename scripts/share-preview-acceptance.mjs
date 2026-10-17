/**
 * #52: read-only HTTP social preview acceptance (X and WhatsApp user agents).
 * This does NOT verify external X/WhatsApp caches or authorize beta invitations.
 * node scripts/share-preview-acceptance.mjs --live https://kararver-staging.vercel.app/karar/<slug> --removed https://kararver-staging.vercel.app/karar/<removed> --environment staging --json
 */
import { pathToFileURL } from "node:url";

const AGENTS = { x: "Twitterbot/1.0", whatsapp: "WhatsApp/2.24.0" };

export function validatePageUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error("Absolute HTTPS public /karar/ URL required"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
      !/^\/karar\/[a-zA-Z0-9_-]+$/.test(url.pathname) ||
      !/^(?:[a-z0-9-]+\.)+(?:vercel\.app|com\.tr)$/.test(url.hostname)) {
    throw new Error("Require public HTTPS Vercel/.com.tr /karar/ URL without credentials or query");
  }
  return url;
}

function decodeHtml(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#(?:\d+|x[\da-f]+));/gi, match => {
    const token = match.slice(1, -1).toLowerCase();
    const named = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
    if (token in named) return named[token];
    const point = token[1] === "x" ? Number.parseInt(token.slice(2), 16) : Number(token.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : match;
  });
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? "");
  }
  return result;
}

export function readHeadTags(html) {
  const head = /<head(?:\s[^>]*)?>([\s\S]*?)<\/head\s*>/i.exec(html)?.[1];
  if (head === undefined) return null;
  const metas = new Map(), links = new Map();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attributes(tag), key = a.property || a.name;
    if (key && !metas.has(key.toLowerCase())) metas.set(key.toLowerCase(), a.content ?? "");
  }
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const a = attributes(tag);
    if (a.rel && !links.has(a.rel.toLowerCase())) links.set(a.rel.toLowerCase(), a.href ?? "");
  }
  return { metas, links };
}

export function verifyPreview({ html, status, url, removed, environment }) {
  const checks = [];
  const add = (id, ok) => checks.push({ id, result: ok ? "PASS" : "FAIL" });
  const head = readHeadTags(html);
  add("html-head", head !== null);
  if (!head) return checks;
  const m = name => head.metas.get(name) || "";
  const robots = m("robots").toLowerCase();
  const noindex = /(?:^|,)\s*noindex(?:,|$)/.test(robots);

  if (removed) {
    add("removed-status", [200, 404, 410].includes(status));
    add("removed-noindex", noindex);
    add("removed-not-shared", !m("og:url") && !m("og:image") && !m("twitter:image"));
    return checks;
  }

  add("live-status", status === 200);
  const canonical = head.links.get("canonical") || "";
  let target;
  try { target = new URL(canonical); } catch { /* failed canonical is reported below */ }
  add("canonical", Boolean(target && target.origin === url.origin &&
    target.pathname === url.pathname && !target.search && !target.hash));
  for (const name of ["og:title", "og:description", "og:url", "twitter:title", "twitter:description", "twitter:card"]) {
    add(name, Boolean(m(name).trim()));
  }
  add("og-canonical", Boolean(canonical) && m("og:url") === canonical);
  add("title-match", m("og:title") === m("twitter:title"));
  add("description-match", m("og:description") === m("twitter:description"));
  add("card-format", ["summary", "summary_large_image"].includes(m("twitter:card")));
  const ogImage = m("og:image"), xImage = m("twitter:image");
  add("image-consistency", Boolean(ogImage) === Boolean(xImage) && (!ogImage || ogImage === xImage));
  if (ogImage) {
    let secure = false;
    try { const u = new URL(ogImage); secure = u.protocol === "https:" && !u.username && !u.password; } catch {}
    add("image-https", secure);
    add("image-card", m("twitter:card") === "summary_large_image");
  }
  add(environment === "staging" ? "staging-noindex" : "production-indexable",
    environment === "staging" ? noindex : !noindex);
  return checks;
}

export async function checkSharePreview({ live, removed, environment }, http = fetch) {
  const active = validatePageUrl(live), missing = removed ? validatePageUrl(removed) : null;
  if (!["staging", "production"].includes(environment)) throw new Error("Explicit staging or production required");
  if (missing && (missing.origin !== active.origin || missing.href === active.href)) {
    throw new Error("Removed and live URLs must be distinct pages on the same origin");
  }
  const cases = [];
  for (const [agent, ua] of Object.entries(AGENTS)) {
    for (const [type, page] of [["live", active], ...(missing ? [["removed", missing]] : [])]) {
      let checks;
      try {
        const res = await http(page.href, {
          method: "GET", redirect: "manual", credentials: "omit",
          headers: { accept: "text/html", "user-agent": ua },
          signal: AbortSignal.timeout(12000),
        });
        if (res.status >= 300 && res.status < 400) checks = [{ id: "no-redirect", result: "FAIL" }];
        else {
          const h = await res.text();
          checks = [{ id: "content-type", result: /text\/html/i.test(res.headers.get("content-type") || "") ? "PASS" : "FAIL" },
            ...verifyPreview({ html: h, status: res.status, url: page, removed: type === "removed", environment })];
        }
      } catch {
        checks = [{ id: "network", result: "FAIL" }];
      }
      cases.push({ agent, type, path: page.pathname, checks });
    }
  }
  const count = status => cases.reduce((n, c) => n + c.checks.filter(x => x.result === status).length, 0);
  return {
    mode: "READ_ONLY_HTTP_NO_CREDENTIALS",
    scope: "HTML for simulated bot user agents, NOT external cache verification",
    environment, cases,
    totals: { pass: count("PASS"), fail: count("FAIL") },
    externalCacheVerified: false,
    betaGate: "NO_GO_EXTERNAL_PLATFORM_PREVIEWS_AND_BETA_ACCEPTANCE_PENDING",
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--json" && !args.json) { args.json = true; continue; }
    if (!["--live", "--removed", "--environment"].includes(key) || !argv[i + 1] || args[key]) {
      throw new Error("Unknown, duplicate or missing CLI argument");
    }
    args[key] = argv[++i];
  }
  if (!args["--live"] || !args["--environment"]) {
    throw new Error("Usage: --live HTTPS_URL [--removed HTTPS_URL] --environment staging|production [--json]");
  }
  return { live: args["--live"], removed: args["--removed"], environment: args["--environment"], json: args.json };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { json, ...options } = parseArgs(process.argv.slice(2));
    const report = await checkSharePreview(options);
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      for (const item of report.cases) for (const c of item.checks) {
        console.log(c.result + " " + item.agent + "/" + item.type + "/" + c.id);
      }
      console.log(report.totals.pass + " PASS, " + report.totals.fail + " FAIL; external cache NOT verified");
    }
    if (report.totals.fail) process.exitCode = 1;
  } catch (e) {
    console.error("share-preview-acceptance: " + (e instanceof Error ? e.message : "unknown error"));
    process.exitCode = 1;
  }
}

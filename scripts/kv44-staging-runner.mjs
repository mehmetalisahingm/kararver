/**
 * KV-44 / #46 role-split staging acceptance runner (R0–R5).
 *
 * Each person runs only their own role on their own machine with their own env; no credential ever crosses machines.
 * Coordination values (run id, marker, masked ids) are printed and passed by the other side as arguments.
 * Synthetic accounts: only the author USER (initiator) and the media USER (media-operator); no staff role is assigned.
 * Evidence: %USERPROFILE%\kv44-evidence\<runId>\<role>.jsonl (outside the repo, masked). Matrix: docs/KV-44_STAGING_RUNNER.md.
 *
 *   --new-run                                    offline: prints a run id
 *   --check-env [--as <role>] [--window-start <ISO>]   offline: missing env names (never values) and window times
 *   --preflight                                  GET /health + GET /v1/config only, no credentials
 *   --as initiator      --phase open|cleanup     R0, author account, R2 requests (T0), self_approval; R4 cleanup
 *   --as owner          --target <8> --marker <m> [--legacy-approval <id>]    R1
 *   --as media-operator --phase run|cleanup      R0, media USER, R3; R4 media cleanup
 *   --as approver       --phase approve|expiry --approval <8>                 remaining R2 steps, T+31
 *   --merge                                      R5: merges every role JSONL in the run directory
 * Write phases need --run <id> --window-start <ISO>. Env: KV44_EXPECTED_SHA, KV44_EMAIL, KV44_PASSWORD, KV44_MEDIA_HOST.
 * R0 (except cleanup) reads the repo variable STAGING_PINNED_SHA with the local `gh` login; it must equal KV44_EXPECTED_SHA.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { crc32, deflateSync } from "node:zlib";

export const WEB = "https://kararver-staging.vercel.app";
export const API = "https://api-staging-45cb.up.railway.app";
export const REPO = "mehmetalisahingm/kararver";
export const ROLES = Object.freeze(["initiator", "owner", "media-operator", "approver"]);
const MIN = 60_000;
/** 60 minute window; the last 10 minutes are cleanup only. T0 must leave room for T+31 before the write cutoff. */
export const WINDOW = Object.freeze({ minutes: 60, writeCutoffMinute: 50, t0LatestMinute: 19, expiryAfterMinutes: 31 });
export const COMMENT_COUNT = 20; // BULK_APPROVAL_THRESHOLD (packages/contracts/src/domains/moderation.ts:235)

const BR = "apps/api/src/modules/moderation/bulk-approval-routes.ts";
const RR = "apps/api/src/modules/rbac/roles-routes.ts";
const AR = "apps/api/src/modules/security/approval-routes.ts";
const MC = "packages/contracts/src/domains/moderation.ts";
const MD = "packages/contracts/src/domains/media.ts";
/**
 * Acceptance matrix. `ref` is file:line, `needle` is checked against that line by the unit test.
 * `na` = may close as UYGULANAMAZ-staging; `k` = KV44 plan mapping (empty until kv44-plan.md is found).
 */
export const MATRIX = Object.freeze([
  { id: "R0.pinned", r: "R0", role: "all", sev: "P0", expect: "STAGING_PINNED_SHA dolu (7–40 hex) ve KV44_EXPECTED_SHA ile aynı commit; değilse NO-GO, okunamazsa BLOCKED-verification", ref: ".github/workflows/staging-monitor.yml:135", needle: "STAGING_PINNED_SHA: ${{ vars.STAGING_PINNED_SHA }}" },
  { id: "R0.release", r: "R0", role: "all", sev: "P0", expect: "200 status=ok env=staging, sha = KV44_EXPECTED_SHA", ref: "apps/api/src/app.ts:513", needle: 'app.get("/health"' },
  { id: "R0.login", r: "R0", role: "all", sev: "P0", expect: "200 + kv_session", ref: "packages/contracts/src/domains/auth.ts:87", needle: 'id: "auth.login"' },
  { id: "R0.role", r: "R0", role: "all", sev: "P0", expect: "/me rolü uygun (initiator/approver ADMIN+, owner SUPER_ADMIN)", ref: "packages/contracts/src/domains/auth.ts:240", needle: 'id: "me.get"' },
  { id: "ACC.register", r: "R0", role: "initiator, media-operator", sev: "P1", expect: "202; 429 → BLOCKED-ratelimit (5/IP/h)", ref: "docs/KV-19_RATE_LIMIT.md:21", needle: "registerPerIpHour", rateLimit: true },
  { id: "ACC.owned", r: "R0", role: "initiator, media-operator", sev: "P0", expect: "yeni hesap yalnız USER", ref: "packages/contracts/src/domains/admin.ts:590", needle: 'id: "admin.users.list"' },
  { id: "ACC.login", r: "R0", role: "initiator, media-operator", sev: "P1", expect: "200, aynı id", ref: "packages/contracts/src/domains/auth.ts:87", needle: 'id: "auth.login"' },
  { id: "R2.fixture.poll", r: "R2", role: "initiator", sev: "P1", expect: "201", ref: "packages/contracts/src/domains/polls.ts:187", needle: 'id: "polls.create"', rateLimit: true },
  { id: "R2.fixture.comments", r: "R2", role: "initiator", sev: "P1", expect: `${COMMENT_COUNT}× 201 (429 → Retry-After kadar bekle)`, ref: "packages/contracts/src/domains/comments.ts:74", needle: 'id: "comments.create"', rateLimit: true },
  { id: "R2.preview", r: "R2", role: "initiator", sev: "P1", expect: `willChange=${COMMENT_COUNT}, approval.required=true`, ref: "apps/api/src/modules/moderation/bulk-routes.ts:63", needle: "approval: { required" },
  { id: "R2.open.expiring", r: "R2", role: "initiator", sev: "P0", expect: "202 PENDING (T0)", ref: "apps/api/src/modules/moderation/bulk-routes.ts:123", needle: "status: 202" },
  { id: "R2.open.target", r: "R2", role: "initiator", sev: "P0", expect: "202 PENDING", ref: "apps/api/src/modules/moderation/bulk-routes.ts:123", needle: "status: 202" },
  { id: "R2.self_approval", r: "R2", role: "initiator", sev: "P0", expect: "403 FORBIDDEN self_approval", ref: `${BR}:112`, needle: 'code: "self_approval"' },
  { id: "R1.target", r: "R1", role: "owner", sev: "P1", expect: "marker + 8 chars → single USER", ref: "packages/contracts/src/domains/admin.ts:590", needle: 'id: "admin.users.list"' },
  { id: "R1.self", r: "R1", role: "owner", sev: "P0", expect: "409 CONFLICT, details self veya boş (önce kapı cevaplar: permissions.ts:560 → access.ts:58)", ref: `${RR}:42`, needle: 'code: "self"' },
  { id: "R1.last_super_admin", r: "R1", role: "owner", sev: "P0", na: true, expect: "UYGULANAMAZ-staging: ikinci SUPER_ADMIN gerekir (birim testi: apps/api/test/admin-roles.test.ts:171)", ref: `${RR}:44`, needle: 'code: "last_super_admin"' },
  { id: "R1.super_admin_reserved.role", r: "R1", role: "owner", sev: "P0", expect: "403 FORBIDDEN super_admin_reserved", ref: `${RR}:36`, needle: "super_admin_reserved" },
  { id: "R1.super_admin_reserved.request", r: "R1", role: "owner", sev: "P0", expect: "403 FORBIDDEN super_admin_reserved, kayıt oluşmaz", ref: `${AR}:29`, needle: "super_admin_reserved" },
  { id: "R1.legacy_approval", r: "R1", role: "owner", sev: "P0", na: true, expect: "403 super_admin_reserved; bekleyen eski talep yoksa UYGULANAMAZ-staging (birim testi: apps/api/test/role-approvals.test.ts)", ref: `${AR}:45`, needle: "super_admin_reserved" },
  { id: "R3.config", r: "R3", role: "media-operator", sev: "P0", expect: "KV44_MEDIA_HOST yalın host adı", ref: `${MD}:29`, needle: 'id: "media.uploads.create"' },
  { id: "R3.upload.create", r: "R3", role: "media-operator", sev: "P0", expect: "201 PUT presign", ref: `${MD}:29`, needle: 'id: "media.uploads.create"' },
  { id: "R3.upload.host", r: "R3", role: "media-operator", sev: "P0", expect: "https ve host === KV44_MEDIA_HOST; değilse FAIL ve dur", ref: `${MD}:66`, needle: "Upload URL'i 10 dk" },
  { id: "R3.upload.put", r: "R3", role: "media-operator", sev: "P1", expect: "200 (sentetik 64×64 PNG)", ref: `${MD}:66`, needle: "Upload URL'i 10 dk" },
  { id: "R3.complete", r: "R3", role: "media-operator", sev: "P1", expect: "202 MediaView", ref: `${MD}:70`, needle: 'id: "media.complete"' },
  { id: "R3.private-url", r: "R3", role: "media-operator", sev: "P0", expect: "APPROVED değilken url=null", ref: `${MD}:12`, needle: "Public URL sadece APPROVED" },
  { id: "R3.not-public", r: "R3", role: "media-operator", sev: "P0", expect: "anonim /media-public 404, imza sızıntısı yok", ref: "apps/api/src/modules/media/public-routes.ts:12", needle: "/media-public/m/:file" },
  { id: "R2.resolve", r: "R2", role: "approver", sev: "P1", expect: "8 karakter → tek talep, başlatan ben değilim", ref: `${MC}:855`, needle: 'id: "admin.moderation.bulkApprovals.list"' },
  { id: "R2.stepup_required", r: "R2", role: "approver", sev: "P0", expect: "403 FORBIDDEN stepup_required", ref: `${BR}:121`, needle: 'code: "stepup_required"' },
  { id: "R2.stepup", r: "R2", role: "approver", sev: "P1", expect: "200 stepUpExpiresAt", ref: "packages/contracts/src/domains/auth.ts:231", needle: 'id: "me.mfa.stepup"' },
  { id: "R2.approve", r: "R2", role: "approver", sev: "P0", expect: "200 APPROVED", ref: `${BR}:138`, needle: "status: 200" },
  { id: "R2.closed.reapprove", r: "R2", role: "approver", sev: "P0", expect: "409 CONFLICT closed", ref: `${BR}:111`, needle: '"closed"' },
  { id: "R2.expired.view", r: "R2", role: "approver", sev: "P1", expect: "T+31'de status EXPIRED", ref: `${BR}:22`, needle: '"EXPIRED"' },
  { id: "R2.closed.expired", r: "R2", role: "approver", sev: "P0", expect: "T+31'de 409 CONFLICT closed (TTL moderation.ts:237)", ref: `${BR}:111`, needle: '"closed"' },
  { id: "R4.cancel", r: "R4", role: "initiator", sev: "P1", expect: "açık kalan talepler geri çekilir", ref: `${MC}:935`, needle: 'id: "admin.moderation.bulkApprovals.cancel"' },
  { id: "R4.comment", r: "R4", role: "initiator", sev: "P1", expect: "200 REMOVE", ref: `${MC}:400`, needle: "/:id/moderation" },
  { id: "R4.poll", r: "R4", role: "initiator", sev: "P1", expect: "200 REMOVE", ref: `${MC}:400`, needle: "/:id/moderation" },
  { id: "R4.ban", r: "R4", role: "initiator, media-operator", sev: "P1", expect: "201 BAN veya 409 already_active", ref: "packages/contracts/src/domains/admin.ts:873", needle: 'id: "admin.sanctions.create"' },
  { id: "R4.media.reject", r: "R4", role: "media-operator", sev: "P1", expect: "200 REJECT", ref: `${MC}:691`, needle: 'id: "admin.media.decide"' },
  { id: "R4.residue", r: "R4", role: "initiator, media-operator", sev: "P1", expect: "kalan kayıt yok; varsa TEMİZLİK EKSİK + maskeli liste", ref: `${MC}:400`, needle: "/:id/moderation" },
  { id: "R5.merge", r: "R5", role: "initiator", sev: "P1", expect: "tüm rol dosyalarında aynı run id ve release", ref: "docs/KV-44_SECURITY_ACCEPTANCE.md:31", needle: "Her satır şu alanlara" },
].map(row => Object.freeze({ k: "", ...row })));
const ROW = Object.fromEntries(MATRIX.map(r => [r.id, r]));
/** Rows that must exist in R5 for a PASS verdict. */
const REQUIRED = MATRIX.filter(r => !r.id.startsWith("R4.") && r.id !== "R5.merge").map(r => r.id);

// --- masking -------------------------------------------------------------------------------------------------------
export const mask8 = value => (typeof value === "string" && value ? `${value.slice(0, 8)}…` : null);
/** Signed URL: keep only host and the first 8 characters of the path; the whole query (signature, credential, expires) is dropped. */
export function maskUrl(raw) {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}/${u.pathname.replace(/^\//, "").slice(0, 8)}…${u.search ? "?******" : ""}`;
  } catch { return "******"; }
}
/** Last line of defense for free text: URL, e-mail, UUID, cookie and signature fragments are never written. */
export function redact(text) {
  return String(text ?? "")
    .replace(/https?:\/\/[^\s"']+/g, m => maskUrl(m))
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "***@***")
    .replace(/kv_session=[^;\s]*/gi, "kv_session=******")
    .replace(/X-Amz-[A-Za-z]+=[^&\s]*/g, "******")
    .replace(/\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "$1…")
    .slice(0, 300);
}
export const RUN_ID = /^kv44-\d{8}T\d{4}Z-[a-f0-9]{6}$/;
export const newRunId = (now = new Date(), rand = randomBytes(3).toString("hex")) =>
  `kv44-${now.toISOString().replace(/[-:]/g, "").slice(0, 13)}Z-${rand}`;
export function validateMediaHost(value) {
  if (typeof value !== "string" || !/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)) throw new Error("KV44_MEDIA_HOST must be a bare host name");
  return value;
}
/** Media host check: protocol and host must match exactly; subdomain/suffix tricks, port and user info are rejected. */
export function mediaHostMatches(rawUrl, expectedHost) {
  try {
    const u = new URL(rawUrl);
    return u.protocol === "https:" && u.hostname === expectedHost && u.host === expectedHost && !u.username && !u.password;
  } catch { return false; }
}
/** 64×64 solid synthetic PNG; contains no personal data. */
export function syntheticPng(size = 64) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x6b)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

// --- window --------------------------------------------------------------------------------------------------------
class Halt extends Error { constructor(result, step) { super(step); this.result = result; } }
export function createWindow(startIso, now) {
  const start = Date.parse(startIso ?? "");
  if (!Number.isFinite(start)) throw new Error("--window-start must be an ISO time");
  const minute = () => (now().getTime() - start) / MIN;
  return {
    start: new Date(start).toISOString(),
    minute,
    /** Writes outside cleanup: not before the window, not in the last 10 minutes. */
    write(step) { const m = minute(); if (m < 0 || m >= WINDOW.writeCutoffMinute) throw new Halt("BLOCKED-window", step); },
    t0(step) { const m = minute(); if (m < 0 || m > WINDOW.t0LatestMinute) throw new Halt("BLOCKED-window", step); },
    cutoff: () => new Date(start + WINDOW.writeCutoffMinute * MIN),
  };
}

/** Env each role needs on its own machine. The approver's TOTP is prompted at the step, never read from env. */
export const ROLE_ENV = Object.freeze({
  initiator: ["KV44_EXPECTED_SHA", "KV44_EMAIL", "KV44_PASSWORD"],
  owner: ["KV44_EXPECTED_SHA", "KV44_EMAIL", "KV44_PASSWORD"],
  "media-operator": ["KV44_EXPECTED_SHA", "KV44_EMAIL", "KV44_PASSWORD", "KV44_MEDIA_HOST"],
  approver: ["KV44_EXPECTED_SHA", "KV44_EMAIL", "KV44_PASSWORD"],
});
const ENV_FORMAT = { KV44_EXPECTED_SHA: v => /^[a-f0-9]{40}$/.test(v), KV44_MEDIA_HOST: v => { try { validateMediaHost(v); return true; } catch { return false; } } };
/** Offline: names only, each as ok | missing | invalid. No value, length or prefix ever leaves this function. */
export function checkEnv(env, roles = ROLES) {
  return roles.map(role => ({ role, vars: ROLE_ENV[role].map(name => {
    const v = env[name];
    return { name, status: !v ? "missing" : ENV_FORMAT[name] && !ENV_FORMAT[name](v) ? "invalid" : "ok" };
  }) }));
}
/** Window milestones from --window-start (UTC). */
export function windowTimes(startIso) {
  const start = Date.parse(startIso ?? "");
  if (!Number.isFinite(start)) throw new Error("--window-start must be an ISO time");
  const at = m => new Date(start + m * MIN).toISOString();
  return { start: at(0), t0Latest: at(WINDOW.t0LatestMinute), writeCutoff: at(WINDOW.writeCutoffMinute), end: at(WINDOW.minutes) };
}

// --- runner core ---------------------------------------------------------------------------------------------------
export const evidenceRoot = () => join(homedir(), "kv44-evidence");

function createContext({ role, phase, runId, deps }) {
  const { http = fetch, now = () => new Date(), log = console.log, root = evidenceRoot() } = deps;
  if (!RUN_ID.test(runId ?? "")) throw new Error("--run must come from --new-run");
  const dir = join(root, runId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${role}.jsonl`), stateFile = join(dir, `.state-${role}.json`);
  const rows = [];
  let release = null;
  const record = (step, result, res, note) => {
    const m = ROW[step];
    const row = { at: now().toISOString(), runId, role, phase, release, r: m?.r ?? "—", step, result, sev: m?.sev ?? null, ref: m?.ref ?? null,
      ...(res ? { status: res.status, code: res.code ?? null, detail: res.detail ?? null, requestId: res.requestId ?? null } : {}),
      ...(note ? { note: redact(note) } : {}) };
    rows.push(row);
    appendFileSync(file, JSON.stringify(row) + "\n");
    log(`${row.result.padEnd(20)} ${row.step}${res ? ` ${res.status}${res.detail ? `/${res.detail}` : ""}` : ""}${row.note ? ` — ${row.note}` : ""}`);
    return row;
  };
  const expect = (step, res, ok, { stop = true, note } = {}) => {
    if (res?.status === 429 && ROW[step]?.rateLimit) { record(step, "BLOCKED-ratelimit", res, note); throw new Halt("BLOCKED-ratelimit", step); }
    record(step, ok ? "PASS" : "FAIL", res, note);
    if (!ok && stop) throw new Halt("FAIL", step);
    return ok;
  };
  const call = async (path, { method = "GET", body, cookie = "", key, base = WEB + "/api/v1" } = {}) => {
    const response = await http(base + path, { method, redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(30_000),
      headers: { origin: WEB, accept: "application/json", ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}), ...(key ? { "idempotency-key": key } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    let data = null;
    if (response.status !== 204) { try { data = await response.json(); } catch { data = null; } }
    return { status: response.status, data, code: data?.error?.code, detail: data?.error?.details?.[0]?.code,
      requestId: response.headers.get("x-request-id"), retryAfter: Number(response.headers.get("retry-after")), cookies: response.headers.getSetCookie?.() ?? [] };
  };
  const login = async (email, password) => {
    const res = await call("/auth/login", { method: "POST", body: { email, password } });
    const cookie = (res.cookies.find(c => c.startsWith("kv_session=")) ?? "").split(";")[0];
    return { res, cookie: cookie.length > "kv_session=".length ? cookie : "", id: res.data?.data?.id ?? null };
  };
  const loadState = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {});
  const saveState = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));
  const setRelease = value => { release = value; };
  return { dir, file, rows, record, expect, call, login, loadState, saveState, setRelease, now };
}

/**
 * STAGING_PINNED_SHA repo variable via the local `gh` login (GitHub only, never staging).
 * The list endpoint separates "not set" (200 without the name) from "no access" (error); a single-variable GET is 404 for both.
 */
export function readPinnedSha({ exec = execFile } = {}) {
  return new Promise((resolve, reject) => {
    exec("gh", ["api", `repos/${REPO}/actions/variables`, "--paginate", "--jq", '.variables[] | select(.name == "STAGING_PINNED_SHA") | .value'],
      { timeout: 15_000, windowsHide: true }, (err, stdout) => (err ? reject(new Error("gh api failed")) : resolve(String(stdout).trim() || null)));
  });
}

/** R0: pin (skipped in cleanup, the pin is removed at window end), release, login, role. Every phase starts with it. */
async function r0(ctx, { http = fetch, env, pinnedSha = readPinnedSha }, roleOk, { pin = true } = {}) {
  const sha = env.KV44_EXPECTED_SHA ?? "";
  if (!/^[a-f0-9]{40}$/.test(sha) || !env.KV44_EMAIL || !env.KV44_PASSWORD) throw new Error("KV44_EXPECTED_SHA (40 hex), KV44_EMAIL and KV44_PASSWORD are required");
  if (pin) {
    let pinned;
    try { pinned = await pinnedSha(); }
    catch { ctx.record("R0.pinned", "BLOCKED-verification", null, "STAGING_PINNED_SHA okunamadı (gh kurulu, oturum açık ve repo erişimi var mı?)"); throw new Halt("BLOCKED-verification", "R0.pinned"); }
    const valid = typeof pinned === "string" && /^[0-9a-f]{7,40}$/.test(pinned);
    ctx.expect("R0.pinned", null, valid && sha.startsWith(pinned),
      { note: !pinned ? "STAGING_PINNED_SHA sabitlenmemiş" : !valid ? "STAGING_PINNED_SHA geçersiz" : `pinned ${pinned.slice(0, 12)}` });
  }
  const health = await http(API + "/health", { redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(15_000) });
  let state = null; try { state = await health.json(); } catch {}
  const release = state?.release?.sha ?? null;
  ctx.setRelease(release);
  ctx.expect("R0.release", { status: health.status }, health.status === 200 && state?.status === "ok" && state?.release?.env === "staging" && release?.length >= 12 && sha.startsWith(release),
    { note: `release ${release ?? "?"}` });
  const op = await ctx.login(env.KV44_EMAIL, env.KV44_PASSWORD);
  ctx.expect("R0.login", op.res, op.res.status === 200 && Boolean(op.cookie));
  const me = await ctx.call("/me", { cookie: op.cookie });
  const roles = me.data?.data?.roles ?? [];
  if (!(me.status === 200 && roleOk(roles))) { ctx.record("R0.role", "BLOCKED-role", me, `roles=${roles.join(",") || "?"}`); throw new Halt("BLOCKED-role", "R0.role"); }
  ctx.record("R0.role", "PASS", me, `roles=${roles.join(",")}`);
  return { cookie: op.cookie, id: me.data.data.id };
}
const isAdmin = roles => roles.includes("ADMIN") || roles.includes("SUPER_ADMIN");
const randomPassword = () => randomBytes(24).toString("base64url");

/** Synthetic USER: created once, right after R0. The password stays in this process memory only. */
async function createSyntheticUser(ctx, op, marker, suffix, state) {
  const username = `${marker}_${suffix}`, email = `${username}@example.test`, password = randomPassword();
  const reg = await ctx.call("/auth/register", { method: "POST", body: { username, email, password, displayName: "İzole KV44 güvenlik kontrolü" } });
  ctx.expect("ACC.register", reg, reg.status === 202, { note: suffix });
  const found = await ctx.call(`/admin/users?q=${encodeURIComponent(username)}`, { cookie: op.cookie });
  const user = found.data?.data?.find(u => u.username === username);
  ctx.expect("ACC.owned", found, Boolean(user?.id) && user.id !== op.id && (user.roles ?? []).every(r => r === "USER"), { note: `${suffix} ${mask8(user?.id)}` });
  state.users = { ...state.users, [suffix]: { id: user.id, banned: false } };
  ctx.saveState(state);
  const signed = await ctx.login(email, password);
  ctx.expect("ACC.login", signed.res, signed.res.status === 200 && signed.id === user.id && Boolean(signed.cookie), { note: suffix });
  return { id: user.id, cookie: signed.cookie };
}

async function logout(ctx, cookie) { if (cookie) { try { await ctx.call("/auth/logout", { method: "POST", cookie }); } catch {} } }
const REASON = "İzole KV44 güvenlik kabulü";

/** Shared R4: cancel/remove/ban whatever is in the role state; anything left is listed as TEMİZLİK EKSİK. */
async function cleanup(ctx, op, state) {
  const remaining = [];
  const attempt = async (step, label, fn) => {
    try { const ok = await fn(); if (!ok) remaining.push(label); return ok; }
    catch { ctx.record(step, "FAIL", null, `${label} (transport)`); remaining.push(label); return false; }
  };
  for (const a of Object.values(state.approvals ?? {})) {
    if (a.closed) continue;
    await attempt("R4.cancel", `approval ${mask8(a.id)}`, async () => {
      const view = await ctx.call(`/admin/moderation/bulk-approvals/${a.id}`, { cookie: op.cookie });
      if (view.status === 200 && view.data?.data?.status !== "PENDING") { a.closed = true; ctx.record("R4.cancel", "PASS", view, `${mask8(a.id)} already ${view.data.data.status}`); return true; }
      const res = await ctx.call(`/admin/moderation/bulk-approvals/${a.id}/cancel`, { method: "POST", cookie: op.cookie, body: { reason: `${REASON} temizliği` } });
      a.closed = res.status === 200 || res.detail === "closed";
      ctx.record("R4.cancel", a.closed ? "PASS" : "FAIL", res, mask8(a.id));
      return a.closed;
    });
  }
  for (const c of state.comments ?? []) {
    if (c.removed) continue;
    await attempt("R4.comment", `comment ${mask8(c.id)}`, async () => {
      const res = await ctx.call(`/admin/comments/${c.id}/moderation`, { method: "POST", cookie: op.cookie, body: { action: "REMOVE", reason: `${REASON} temizliği` } });
      c.removed = res.status === 200;
      ctx.record("R4.comment", c.removed ? "PASS" : "FAIL", res, mask8(c.id));
      return c.removed;
    });
  }
  if (state.poll && !state.poll.removed) {
    await attempt("R4.poll", `poll ${mask8(state.poll.id)}`, async () => {
      const res = await ctx.call(`/admin/polls/${state.poll.id}/moderation`, { method: "POST", cookie: op.cookie, body: { action: "REMOVE", reason: `${REASON} temizliği` } });
      state.poll.removed = res.status === 200;
      ctx.record("R4.poll", state.poll.removed ? "PASS" : "FAIL", res, mask8(state.poll.id));
      return state.poll.removed;
    });
  }
  if (state.media && !state.media.rejected) {
    await attempt("R4.media.reject", `media ${mask8(state.media.id)}`, async () => {
      const res = await ctx.call(`/admin/media/${state.media.id}/decision`, { method: "POST", cookie: op.cookie, body: { decision: "REJECT", reason: `${REASON} temizliği` } });
      state.media.rejected = res.status === 200;
      ctx.record("R4.media.reject", state.media.rejected ? "PASS" : "FAIL", res, mask8(state.media.id));
      return state.media.rejected;
    });
  }
  // The super_admin_reserved test leaves no record; if it ever does, R1 reverts the role right away.
  for (const [suffix, u] of Object.entries(state.users ?? {})) {
    if (u.banned) continue;
    await attempt("R4.ban", `user ${suffix} ${mask8(u.id)}`, async () => {
      const res = await ctx.call(`/admin/users/${u.id}/sanctions`, { method: "POST", cookie: op.cookie, body: { type: "BAN", reason: `${REASON} test hesabı temizliği` } });
      u.banned = res.status === 201 || res.detail === "already_active";
      ctx.record("R4.ban", u.banned ? "PASS" : "FAIL", res, `${suffix} ${mask8(u.id)}`);
      return u.banned;
    });
  }
  ctx.saveState(state);
  if (remaining.length) ctx.record("R4.residue", "TEMİZLİK EKSİK", null, `kalan: ${remaining.join(", ")}`);
  else ctx.record("R4.residue", "PASS", null, "kalan kayıt yok");
  return remaining;
}

// --- roles ---------------------------------------------------------------------------------------------------------
async function initiator(ctx, deps, args, win) {
  const state = ctx.loadState();
  let op = null, author = null;
  if (args.phase === "cleanup") {
    try { op = await r0(ctx, deps, isAdmin, { pin: false }); await cleanup(ctx, op, state); }
    finally { await logout(ctx, op?.cookie); }
    return;
  }
  if (args.phase !== "open") throw new Error("initiator: --phase open|cleanup");
  if (state.marker) throw new Error("This run is already open; use --phase cleanup");
  let aborted = false;
  try {
    op = await r0(ctx, deps, isAdmin);
    win.t0("R2.open.expiring");
    state.marker = `sec_kv44_${randomBytes(5).toString("hex")}`;
    ctx.saveState(state);
    author = await createSyntheticUser(ctx, op, state.marker, "author", state);
    const categories = await ctx.call("/categories");
    const categoryId = categories.data?.data?.[0]?.id;
    if (!categoryId) ctx.expect("R2.fixture.poll", categories, false, { note: "kategori yok" });
    win.write("R2.fixture.poll");
    const poll = await ctx.call("/polls", { method: "POST", cookie: author.cookie, key: `${state.marker}-poll`, body: {
      kind: "POLL", title: `KV44 güvenlik kontrolü ${state.marker}: hangisi?`, categoryId, durationHours: 24, resultsVisibility: "AFTER_VOTE",
      options: [{ label: "A seçeneği" }, { label: "B seçeneği" }] } });
    ctx.expect("R2.fixture.poll", poll, poll.status === 201 && Boolean(poll.data?.data?.id), { note: mask8(poll.data?.data?.id) });
    state.poll = { id: poll.data.data.id, removed: false };
    state.comments = [];
    ctx.saveState(state);
    for (let i = 1; i <= COMMENT_COUNT; i++) {
      for (;;) {
        win.t0("R2.fixture.comments");
        const res = await ctx.call(`/polls/${state.poll.id}/comments`, { method: "POST", cookie: author.cookie, key: `${state.marker}-c${i}`, body: { body: `KV44 izole güvenlik yorumu ${state.marker} #${i}` } });
        if (res.status === 429 && Number.isInteger(res.retryAfter) && res.retryAfter >= 1 && res.retryAfter <= 60) { await (deps.pause ?? sleep)(res.retryAfter * 1000 + 1000); continue; }
        if (res.status !== 201 || !res.data?.data?.id) ctx.expect("R2.fixture.comments", res, false, { note: `#${i}` });
        state.comments.push({ id: res.data.data.id, removed: false });
        ctx.saveState(state);
        break;
      }
    }
    ctx.record("R2.fixture.comments", "PASS", null, `${COMMENT_COUNT} yorum`);
    const ids = state.comments.map(c => c.id);
    const preview = await ctx.call(`/admin/moderation/comments/bulk/preview?ids=${ids.join(",")}&action=HIDE`, { cookie: op.cookie });
    const p = preview.data?.data;
    ctx.expect("R2.preview", preview, preview.status === 200 && p?.summary?.willChange === COMMENT_COUNT && p?.approval?.required === true);
    state.approvals = {};
    for (const [step, name] of [["R2.open.expiring", "expiring"], ["R2.open.target", "target"]]) {
      win.t0(step);
      const res = await ctx.call("/admin/moderation/comments/bulk", { method: "POST", cookie: op.cookie, body: { ids, action: "HIDE", reason: `${REASON} (${name})`, digest: p.digest } });
      const a = res.data?.data;
      ctx.expect(step, res, res.status === 202 && a?.status === "PENDING" && Boolean(a?.id), { note: `${mask8(a?.id)} createdAt ${a?.createdAt} expiresAt ${a?.expiresAt}` });
      state.approvals[name] = { id: a.id, createdAt: a.createdAt, expiresAt: a.expiresAt, closed: false };
      ctx.saveState(state);
    }
    const self = await ctx.call(`/admin/moderation/bulk-approvals/${state.approvals.target.id}/approve`, { method: "POST", cookie: op.cookie, body: { reason: `${REASON} kendi onayı denemesi` } });
    ctx.expect("R2.self_approval", self, self.status === 403 && self.code === "FORBIDDEN" && self.detail === "self_approval");
    deps.log([
      "", "=== HANDOFF (yalnız maskeli değerler) ===",
      `run          ${ctx.dir.split(/[\\/]/).pop()}`,
      `window-start ${win.start}   yazma sınırı ${win.cutoff().toISOString()}`,
      `owner        --target ${state.users.author.id.slice(0, 8)} --marker ${state.marker}`,
      `approver     --phase approve --approval ${state.approvals.target.id.slice(0, 8)}`,
      `approver     --phase expiry  --approval ${state.approvals.expiring.id.slice(0, 8)}   (T0 ${state.approvals.expiring.createdAt}, T+31 ${new Date(Date.parse(state.approvals.expiring.createdAt) + WINDOW.expiryAfterMinutes * MIN).toISOString()})`,
    ].join("\n"));
  } catch (err) {
    aborted = true;
    if (err instanceof Halt) { if (err.result.startsWith("BLOCKED-window")) ctx.record(err.message, err.result, null, "pencere dışında yazma yok"); }
    else ctx.record("transport", "FAIL", null, err?.message);
  } finally {
    await logout(ctx, author?.cookie);
    // Open phase failed: the remaining R2 steps cannot run, so R4 runs right away.
    if (aborted && op) { try { await cleanup(ctx, op, state); } catch { ctx.record("R4.residue", "TEMİZLİK EKSİK", null, "temizlik çalışamadı"); } }
    await logout(ctx, op?.cookie);
  }
}

async function owner(ctx, deps, args, win) {
  let op = null, promoted = null;
  try {
    op = await r0(ctx, deps, roles => roles.includes("SUPER_ADMIN"));
    if (!/^[0-9a-f]{8}$/.test(args.target ?? "") || !/^sec_kv44_[0-9a-f]{10}$/.test(args.marker ?? "")) throw new Error("owner: --target <8 hex> --marker sec_kv44_… are required");
    const found = await ctx.call(`/admin/users?q=${encodeURIComponent(args.marker)}`, { cookie: op.cookie });
    const matches = (found.data?.data ?? []).filter(u => u.username?.startsWith(args.marker) && u.id?.startsWith(args.target));
    const target = matches.length === 1 && (matches[0].roles ?? []).every(r => r === "USER") ? matches[0] : null;
    ctx.expect("R1.target", found, Boolean(target), { note: `${matches.length} eşleşme` });
    win.write("R1.self");
    // Same role (SUPER_ADMIN→SUPER_ADMIN): even if the guard broke, the result is a no-op, so the single owner is never put at risk.
    const self = await ctx.call(`/admin/users/${op.id}/role`, { method: "PUT", cookie: op.cookie, body: { role: "SUPER_ADMIN", reason: `${REASON} kendi rolü denemesi` } });
    ctx.expect("R1.self", self, self.status === 409 && self.code === "CONFLICT" && [undefined, "self"].includes(self.detail), { stop: false, note: `details=${self.detail ?? "boş"}` });
    ctx.record("R1.last_super_admin", "UYGULANAMAZ-staging", null, "tek SUPER_ADMIN politikası; birim testi apps/api/test/admin-roles.test.ts:171");
    win.write("R1.super_admin_reserved.role");
    const put = await ctx.call(`/admin/users/${target.id}/role`, { method: "PUT", cookie: op.cookie, body: { role: "SUPER_ADMIN", reason: `${REASON} rezerve rol denemesi` } });
    if (put.status === 200) promoted = target.id;
    ctx.expect("R1.super_admin_reserved.role", put, put.status === 403 && put.code === "FORBIDDEN" && put.detail === "super_admin_reserved", { stop: false });
    win.write("R1.super_admin_reserved.request");
    const reqd = await ctx.call("/admin/role-approvals", { method: "POST", cookie: op.cookie, body: { userId: target.id, role: "SUPER_ADMIN", reason: `${REASON} rezerve onay denemesi` } });
    ctx.expect("R1.super_admin_reserved.request", reqd, reqd.status === 403 && reqd.code === "FORBIDDEN" && reqd.detail === "super_admin_reserved", { stop: false,
      note: reqd.status === 201 ? `kayıt oluştu ${mask8(reqd.data?.data?.id)}` : undefined });
    const legacyId = args["legacy-approval"];
    const legacy = legacyId ? await ctx.call(`/admin/role-approvals/${encodeURIComponent(legacyId)}`, { cookie: op.cookie }) : null;
    if (!legacy || legacy.status !== 200 || legacy.data?.data?.status !== "PENDING" || legacy.data?.data?.role !== "SUPER_ADMIN") {
      ctx.record("R1.legacy_approval", "UYGULANAMAZ-staging", legacy, "bekleyen eski talep yok (birim testi: apps/api/test/role-approvals.test.ts)");
    } else {
      win.write("R1.legacy_approval");
      const res = await ctx.call(`/admin/role-approvals/${legacyId}/approve`, { method: "POST", cookie: op.cookie, body: { reason: `${REASON} eski talep denemesi` } });
      ctx.expect("R1.legacy_approval", res, res.status === 403 && res.detail === "super_admin_reserved", { stop: false, note: mask8(legacyId) });
    }
  } catch (err) {
    if (err instanceof Halt) { if (err.result === "BLOCKED-window") ctx.record(err.message, err.result, null, "pencere dışında yazma yok"); }
    else ctx.record("transport", "FAIL", null, err?.message);
  } finally {
    if (promoted && op) {
      const back = await ctx.call(`/admin/users/${promoted}/role`, { method: "PUT", cookie: op.cookie, body: { role: "USER", reason: `${REASON} P0 geri alma` } }).catch(() => null);
      ctx.record("R4.residue", back?.status === 200 ? "PASS" : "TEMİZLİK EKSİK", back, `P0 geri alma ${mask8(promoted)}`);
    }
    await logout(ctx, op?.cookie);
  }
}

async function mediaOperator(ctx, deps, args, win) {
  const state = ctx.loadState();
  let op = null, user = null;
  if (args.phase === "cleanup") {
    try { op = await r0(ctx, deps, isAdmin, { pin: false }); await cleanup(ctx, op, state); }
    finally { await logout(ctx, op?.cookie); }
    return;
  }
  if (args.phase !== "run") throw new Error("media-operator: --phase run|cleanup");
  if (state.marker) throw new Error("R3 already ran in this run; use --phase cleanup");
  let host;
  try { host = validateMediaHost(deps.env.KV44_MEDIA_HOST); ctx.record("R3.config", "PASS", null, `host ${host}`); }
  catch { ctx.record("R3.config", "FAIL", null, "KV44_MEDIA_HOST eksik veya geçersiz"); return; }
  try {
    op = await r0(ctx, deps, isAdmin);
    win.write("ACC.register");
    state.marker = `sec_kv44_${randomBytes(5).toString("hex")}`;
    ctx.saveState(state);
    user = await createSyntheticUser(ctx, op, state.marker, "media", state);
    win.write("R3.upload.create");
    const png = syntheticPng();
    const created = await ctx.call("/media/uploads", { method: "POST", cookie: user.cookie, key: `${state.marker}-upload`, body: { purpose: "POLL", mimeType: "image/png", sizeBytes: png.length } });
    if (created.status === 403 && created.code === "EMAIL_NOT_VERIFIED") { ctx.record("R3.upload.create", "BLOCKED-verification", created); throw new Halt("BLOCKED-verification", "R3.upload.create"); }
    ctx.expect("R3.upload.create", created, created.status === 201 && Boolean(created.data?.data?.mediaId) && created.data?.data?.upload?.method === "PUT");
    const { mediaId, upload } = created.data.data;
    state.media = { id: mediaId, rejected: false };
    ctx.saveState(state);
    ctx.expect("R3.upload.host", null, mediaHostMatches(upload.url, host), { note: maskUrl(upload.url) });
    win.write("R3.upload.put");
    const put = await (deps.http ?? fetch)(upload.url, { method: "PUT", body: png, headers: upload.headers, redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(30_000) });
    ctx.expect("R3.upload.put", { status: put.status }, put.status === 200, { note: maskUrl(upload.url) });
    const done = await ctx.call(`/media/${mediaId}/complete`, { method: "POST", cookie: user.cookie });
    ctx.expect("R3.complete", done, done.status === 202 && done.data?.data?.id === mediaId, { note: `status ${done.data?.data?.status}` });
    let view = done.data.data;
    for (let i = 0; i < 3 && view.status === "PENDING"; i++) {
      await (deps.pause ?? sleep)(10_000);
      const got = await ctx.call(`/media/${mediaId}`, { cookie: user.cookie });
      if (got.status === 200 && got.data?.data) view = got.data.data;
    }
    const approved = view.status === "APPROVED";
    ctx.expect("R3.private-url", null, approved || view.url === null, { stop: false, note: `status ${view.status}${view.preview?.url ? ` preview ${maskUrl(view.preview.url)}` : ""}` });
    const anon = await (deps.http ?? fetch)(`${API}/media-public/m/${mediaId}.webp`, { method: "GET", redirect: "manual", credentials: "omit", headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    let text = ""; try { text = await anon.text(); } catch {}
    const leak = /(X-Amz-(?:Algorithm|Credential|Signature)|AWSAccessKeyId|s3:\/\/)/i.test(text);
    if (approved) ctx.record("R3.not-public", "INFO", { status: anon.status }, "model APPROVED verdi; karantina kanıtı değil");
    else ctx.expect("R3.not-public", { status: anon.status }, anon.status === 404 && !leak, { stop: false });
  } catch (err) {
    if (err instanceof Halt) { if (err.result === "BLOCKED-window") ctx.record(err.message, err.result, null, "pencere dışında yazma yok"); }
    else ctx.record("transport", "FAIL", null, err?.message);
  } finally {
    await logout(ctx, user?.cookie);
    await logout(ctx, op?.cookie);
  }
}

async function approver(ctx, deps, args, win) {
  let op = null;
  const pause = deps.pause ?? sleep;
  try {
    op = await r0(ctx, deps, isAdmin);
    if (!["approve", "expiry"].includes(args.phase) || !/^[0-9a-f]{8}$/.test(args.approval ?? "")) throw new Error("approver: --phase approve|expiry --approval <8 hex>");
    const list = await ctx.call("/admin/moderation/bulk-approvals?status=PENDING&limit=50", { cookie: op.cookie });
    const matches = (list.data?.data ?? []).filter(a => a.id?.startsWith(args.approval));
    const a = matches.length === 1 && matches[0].initiator?.id !== op.id ? matches[0] : null;
    ctx.expect("R2.resolve", list, Boolean(a), { note: `${matches.length} eşleşme` });
    const approve = () => ctx.call(`/admin/moderation/bulk-approvals/${a.id}/approve`, { method: "POST", cookie: op.cookie, body: { reason: `${REASON} ikinci onay` } });
    if (args.phase === "approve") {
      win.write("R2.stepup_required");
      const noStepUp = await approve();
      ctx.expect("R2.stepup_required", noStepUp, noStepUp.status === 403 && noStepUp.code === "FORBIDDEN" && noStepUp.detail === "stepup_required");
      const code = String(await deps.promptSecret("TOTP kodu (görünmez): ")).trim();
      const step = await ctx.call("/me/mfa/step-up", { method: "POST", cookie: op.cookie, body: { code } });
      ctx.expect("R2.stepup", step, step.status === 200 && Boolean(step.data?.data?.stepUpExpiresAt), { note: "code ******" });
      win.write("R2.approve");
      const ok = await approve();
      ctx.expect("R2.approve", ok, ok.status === 200 && ok.data?.data?.approval?.status === "APPROVED", { note: `applied ${ok.data?.data?.result?.summary?.applied ?? "?"}` });
      const again = await approve();
      ctx.expect("R2.closed.reapprove", again, again.status === 409 && again.code === "CONFLICT" && again.detail === "closed");
      return;
    }
    // T+31 measured from the server's createdAt (not the workstation clock); must land before the write cutoff.
    const at = Date.parse(a.createdAt) + WINDOW.expiryAfterMinutes * MIN;
    if (!(at < win.cutoff().getTime())) throw new Halt("BLOCKED-window", "R2.closed.expired");
    for (let wait = at - ctx.now().getTime(); wait > 0; wait = at - ctx.now().getTime()) {
      deps.log(`T+31 bekleniyor: ${Math.ceil(wait / 1000)} sn`);
      await pause(Math.min(wait, 59_000));
    }
    win.write("R2.closed.expired");
    const view = await ctx.call(`/admin/moderation/bulk-approvals/${a.id}`, { cookie: op.cookie });
    ctx.expect("R2.expired.view", view, view.status === 200 && view.data?.data?.status === "EXPIRED", { stop: false, note: `status ${view.data?.data?.status}` });
    const late = await approve();
    ctx.expect("R2.closed.expired", late, late.status === 409 && late.code === "CONFLICT" && late.detail === "closed");
  } catch (err) {
    if (err instanceof Halt) { if (err.result === "BLOCKED-window") ctx.record(err.message, err.result, null, "pencere dışında yazma yok"); }
    else ctx.record("transport", "FAIL", null, err?.message);
  } finally {
    await logout(ctx, op?.cookie);
  }
}

// --- preflight / merge ---------------------------------------------------------------------------------------------
/** Credential-free GET /health and GET /v1/config only. */
export async function preflight(http = fetch) {
  const checks = [];
  const get = async (id, path, ok) => {
    try {
      const res = await http(API + path, { method: "GET", redirect: "manual", credentials: "omit", headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      let data = null; try { data = await res.json(); } catch {}
      const pass = ok(res, data);
      checks.push({ id, result: pass ? "PASS" : "FAIL", status: res.status, ...(id === "health" ? { release: data?.release?.sha ?? null, env: data?.release?.env ?? null } : {}) });
    } catch { checks.push({ id, result: "FAIL", note: "transport" }); }
  };
  await get("health", "/health", (r, d) => r.status === 200 && d?.status === "ok" && d?.release?.env === "staging");
  await get("config", "/v1/config", (r, d) => r.status === 200 && d?.data && typeof d.data === "object" &&
    !/(?:password|secret|private.?key|smtp|database.?url|access.?key|authorization)/i.test(JSON.stringify(d)));
  return { at: new Date().toISOString(), api: API, mode: "PREFLIGHT_READ_ONLY", checks, pass: checks.every(c => c.result === "PASS") };
}

const RANK = ["FAIL", "TEMİZLİK EKSİK", "BLOCKED-role", "BLOCKED-window", "BLOCKED-ratelimit", "BLOCKED-verification", "INFO", "UYGULANAMAZ-staging", "PASS"];
export function combine(results) {
  if (!results.length) return "EKSİK";
  return [...results].sort((a, b) => (RANK.indexOf(a) + 1 || 99) - (RANK.indexOf(b) + 1 || 99))[0];
}

export function mergeEvidence(dir) {
  const files = readdirSync(dir).filter(f => /^[a-z-]+\.jsonl$/.test(f) && ROLES.includes(f.replace(/\.jsonl$/, "")));
  const rows = files.flatMap(f => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)));
  const runIds = [...new Set(rows.map(r => r.runId))], releases = [...new Set(rows.map(r => r.release).filter(Boolean))];
  const missingRoles = ROLES.filter(r => !files.includes(`${r}.jsonl`));
  // Latest row per (role, step); a step's result is the worst over roles (a later cleanup rerun supersedes an earlier attempt).
  const latest = {};
  for (const row of rows) latest[`${row.role}|${row.step}`] = row;
  const byStep = id => Object.values(latest).filter(r => r.step === id);
  const result = id => combine(byStep(id).map(r => r.result));
  const noteOf = id => byStep(id).map(r => r.note).filter(Boolean).join("; ");
  const merge = { id: "R5.merge", result: runIds.length === 1 && releases.length === 1 && !missingRoles.length ? "PASS" : "FAIL",
    note: `runId ${runIds.length}, release ${releases.join(",") || "?"}${missingRoles.length ? `, eksik rol ${missingRoles.join(",")}` : ""}` };
  const matrix = MATRIX.map(m => ({ ...m, result: m.id === "R5.merge" ? merge.result : result(m.id), note: m.id === "R5.merge" ? merge.note : noteOf(m.id) }));
  const required = matrix.filter(m => REQUIRED.includes(m.id) || m.id === "R5.merge");
  const allowed = m => m.result === "PASS" || (m.na && m.result === "UYGULANAMAZ-staging");
  const extraFails = Object.values(latest).filter(r => r.result === "FAIL" && !ROW[r.step]);
  const verdict = required.some(m => m.result === "FAIL") || extraFails.length ? "NO-GO"
    : required.every(allowed) ? "PASS" : "BLOCKED";
  const residue = Object.values(latest).filter(r => r.step === "R4.residue" && r.result !== "PASS");
  const cleanupDone = ["initiator", "media-operator"].every(role => latest[`${role}|R4.residue`]);
  const report = { runId: runIds[0] ?? null, releases, verdict, cleanup: residue.length || !cleanupDone ? "TEMİZLİK EKSİK" : "TAMAM",
    residue: residue.map(r => ({ role: r.role, step: r.step, note: r.note ?? "" })), missingRoles, matrix: matrix.map(({ needle, ...m }) => m) };
  writeFileSync(join(dir, "merged.jsonl"), rows.map(r => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(join(dir, "R5-report.json"), JSON.stringify(report, null, 2));
  const md = [`# KV-44 staging koşusu ${report.runId}`, "", `**Karar: ${verdict}** · Temizlik: **${report.cleanup}** · release ${releases.join(", ") || "?"}`, "",
    ...(report.cleanup === "TEMİZLİK EKSİK" ? ["## TEMİZLİK EKSİK", "", ...(residue.length ? residue.map(r => `- ${r.role} ${r.step}: ${r.note ?? ""}`) : ["- R4 her iki rolde koşmadı"]), ""] : []),
    "| ID | R | Rol | Sev | Beklenen | Sonuç | Kaynak | K | Not |", "|---|---|---|---|---|---|---|---|---|",
    ...report.matrix.map(m => `| ${m.id} | ${m.r} | ${m.role} | ${m.sev} | ${m.expect} | ${m.result} | \`${m.ref}\` | ${m.k} | ${m.note.replace(/\|/g, "/")} |`)].join("\n");
  writeFileSync(join(dir, "R5-report.md"), md + "\n");
  return { report, md };
}

// --- CLI -----------------------------------------------------------------------------------------------------------
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Hidden prompt: nothing is echoed, nothing is stored. */
export function promptHidden(label, { stdin = process.stdin, stderr = process.stderr } = {}) {
  if (!stdin.isTTY) return Promise.reject(new Error("TOTP is read only from an interactive terminal"));
  stderr.write(label);
  stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const done = () => { stdin.off("data", onData); stdin.setRawMode(false); stdin.pause(); stderr.write("\n"); };
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") { done(); resolve(value); return; }
        if (ch === "\u0003") { done(); reject(new Error("cancelled")); return; }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1); else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const RUNNERS = { initiator, owner, "media-operator": mediaOperator, approver };

export async function main(argv, deps = {}) {
  const { values: args } = parseArgs({ args: argv, strict: true, options: {
    "new-run": { type: "boolean" }, "check-env": { type: "boolean" }, preflight: { type: "boolean" }, merge: { type: "boolean" },
    as: { type: "string" }, phase: { type: "string" }, run: { type: "string" }, "window-start": { type: "string" },
    approval: { type: "string" }, target: { type: "string" }, marker: { type: "string" }, "legacy-approval": { type: "string" },
  } });
  const log = deps.log ?? console.log;
  if (args["new-run"]) { log(newRunId()); return 0; }
  if (args["check-env"]) {
    if (args.as && !ROLE_ENV[args.as]) throw new Error(`--as ${ROLES.join("|")}`);
    const rows = checkEnv(deps.env ?? process.env, args.as ? [args.as] : ROLES);
    for (const { role, vars } of rows) log(`${role.padEnd(15)} ${vars.map(v => `${v.name}=${v.status}`).join("  ")}`);
    const bad = [...new Set(rows.flatMap(r => r.vars.filter(v => v.status !== "ok").map(v => `${v.name} (${v.status})`)))];
    log(bad.length ? `eksik/geçersiz: ${bad.join(", ")}` : "env tamam");
    if (args["window-start"]) {
      const w = windowTimes(args["window-start"]);
      log(`pencere (UTC)  başlangıç ${w.start}  T0 en geç ${w.t0Latest}  yazma sınırı ${w.writeCutoff}  bitiş ${w.end}`);
    } else log("pencere: --window-start verilmedi");
    return bad.length ? 1 : 0;
  }
  if (args.preflight) { const r = await preflight(deps.http); log(JSON.stringify(r, null, 2)); return r.pass ? 0 : 1; }
  if (args.merge) {
    if (!RUN_ID.test(args.run ?? "")) throw new Error("--merge needs --run");
    const { report, md } = mergeEvidence(join(deps.root ?? evidenceRoot(), args.run));
    log(md);
    return report.verdict === "PASS" && report.cleanup === "TAMAM" ? 0 : 1;
  }
  const run = RUNNERS[args.as];
  if (!run) throw new Error(`--as ${ROLES.join("|")}`);
  const full = { env: process.env, promptSecret: promptHidden, log, ...deps };
  const ctx = createContext({ role: args.as, phase: args.phase ?? "run", runId: args.run, deps: full });
  const win = createWindow(args["window-start"], ctx.now);
  await run(ctx, full, args, win);
  log(`kanıt: ${ctx.file}`);
  return ctx.rows.some(r => r.result !== "PASS" && r.result !== "INFO" && r.result !== "UYGULANAMAZ-staging") ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; },
    err => { console.error(redact(err?.message ?? "error")); process.exitCode = 1; });
}

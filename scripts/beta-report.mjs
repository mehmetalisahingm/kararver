/**
 * KV-45 / #47: local-only, pseudonymous beta acceptance report.
 * No API calls, no real credentials, no participant names/email/IP or free text.
 * Run: node scripts/beta-report.mjs --participants beta-private/participants.json \
 *      --tasks beta-private/tasks.json --bugs beta-private/bugs.json --as-of 2026-10-20T00:00:00.000Z
 *
 * The presence of data NEVER authorizes invitations or public launch.
 * Gate #46 and operational acceptance #51 are checked separately by humans.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SEGMENTS = Object.freeze({ new_user: 16, social: 10, creator: 8, community: 6 });
const TASKS = Object.freeze(Array.from({ length: 13 }, (_, i) => "B" + String(i + 1).padStart(2, "0")));
const ACTIONS = Object.freeze(["poll", "discussion", "vote", "comment", "reaction", "communityJoin"]);
const PSEUDONYM = /^BETA-[A-Z0-9]{3,12}$/;
const DAY_MS = 86_400_000;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

function fail(message) { throw new Error("beta-report: " + message); }
function checkKeys(obj, fields, label) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) fail(label + ": JSON object required");
  const extra = Object.keys(obj).filter(k => !fields.includes(k));
  if (extra.length) fail(label + ": forbidden field(s): " + extra.join(", "));
}
function timestamp(value, label, optional = false) {
  if (optional && (value === null || value === undefined)) return null;
  if (typeof value !== "string" || !ISO.test(value) || Number.isNaN(Date.parse(value)) ||
      new Date(value).toISOString() !== value) fail(label + ": strict UTC timestamp required");
  return Date.parse(value);
}
function date(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d$/.test(value) ||
      Number.isNaN(Date.parse(value)) ||
      new Date(value + "T00:00:00.000Z").toISOString().slice(0, 10) !== value) {
    fail(label + ": YYYY-MM-DD UTC date required");
  }
  return value;
}
function percentage(num, den) { return den ? Math.round((1000 * num) / den) / 10 : null; }
function count(arr, pred) { return arr.filter(pred).length; }
const onlyDate = ms => new Date(ms).toISOString().slice(0, 10);

export function aggregateBeta(participants, tasks, bugs, asOf) {
  if (!Array.isArray(participants) || !Array.isArray(tasks) || !Array.isArray(bugs)) {
    fail("all three input documents must be JSON arrays");
  }
  const now = timestamp(asOf, "as-of");
  const users = new Map();
  const segments = Object.fromEntries(Object.keys(SEGMENTS).map(s => [s, { target: SEGMENTS[s], invited: 0, accepted: 0, activated: 0 }]));
  for (const p of participants) {
    checkKeys(p, ["participantId", "segment", "invitedAt", "consentedAt", "acceptedAt", "activatedAt", "activityDatesUtc", "firstActions", "withdrawnAt"], "participant");
    if (!PSEUDONYM.test(p.participantId) || users.has(p.participantId)) fail("participantId must be a unique pseudonym (BETA-...); never use personal data");
    if (!(p.segment in SEGMENTS)) fail("unsupported segment");
    const invited = timestamp(p.invitedAt, "invitedAt", true);
    const consented = timestamp(p.consentedAt, "consentedAt", true);
    const accepted = timestamp(p.acceptedAt, "acceptedAt", true);
    const activated = timestamp(p.activatedAt, "activatedAt", true);
    const withdrawn = timestamp(p.withdrawnAt, "withdrawnAt", true);
    if (!invited && (consented || accepted || activated)) fail("participation without invitation");
    if (consented && consented < invited) fail("consent earlier than invitation");
    if (accepted && (!consented || accepted < consented)) fail("accepted requires prior explicit consent");
    if (activated && (!accepted || activated < accepted)) fail("activated requires accepted invitation");
    if (withdrawn && (!invited || withdrawn < invited)) fail("invalid withdrawal");
    for (const [key, val] of [["invitedAt",invited],["consentedAt",consented],["acceptedAt",accepted],["activatedAt",activated],["withdrawnAt",withdrawn]]) {
      if (val !== null && val > now) fail(key + " is in the future");
    }
    if (!Array.isArray(p.activityDatesUtc)) fail("activityDatesUtc required (can be [])");
    const days = new Set(p.activityDatesUtc.map(x => date(x, "activityDatesUtc")));
    for (const day of days) if (Date.parse(day + "T00:00:00.000Z") > now) fail("future activity day");
    checkKeys(p.firstActions ?? {}, ACTIONS, "firstActions");
    for (const [action, at] of Object.entries(p.firstActions ?? {})) {
      const t = timestamp(at, "firstActions." + action);
      if (!activated || t < activated || t > now) fail("firstAction must follow activation and not be future");
    }
    if (withdrawn !== null && activated !== null && withdrawn < activated) fail("withdrawal predates activation");
    const record = { ...p, invited, consented, accepted, activated, withdrawn, days };
    users.set(p.participantId, record);
    if (invited !== null) segments[p.segment].invited++;
    if (accepted !== null) segments[p.segment].accepted++;
    if (activated !== null) segments[p.segment].activated++;
  }
  const scenarios = Object.fromEntries(TASKS.map(id => [id, { attempted: 0, passed: 0, assisted: 0, blocked: 0 }]));
  const taskKeys = new Set();
  for (const t of tasks) {
    checkKeys(t, ["participantId", "caseId", "result", "assisted", "observedAt"], "task");
    const p = users.get(t.participantId);
    if (!p || !p.activated) fail("task references a non-activated pseudonymous participant");
    if (!TASKS.includes(t.caseId) || !["PASS", "FAIL", "BLOCKED"].includes(t.result) || typeof t.assisted !== "boolean") fail("invalid caseId/result/assisted");
    const observed = timestamp(t.observedAt, "observedAt");
    if (observed < p.activated || observed > now || (p.withdrawn && observed > p.withdrawn)) fail("task timestamp outside active participation");
    const k = t.participantId + ":" + t.caseId;
    if (taskKeys.has(k)) fail("duplicate participant-case outcome; keep final result only");
    taskKeys.add(k);
    const row = scenarios[t.caseId];
    if (t.result === "BLOCKED") row.blocked++;
    else {
      row.attempted++;
      if (t.result === "PASS") row.passed++;
      if (t.assisted) row.assisted++;
    }
  }
  const issueCounts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  const bugIds = new Set();
  for (const b of bugs) {
    checkKeys(b, ["id", "severity", "state", "owner", "issueUrl"], "bug");
    if (typeof b.id !== "string" || !/^BETA-BUG-[0-9]{3,6}$/.test(b.id) || bugIds.has(b.id)) fail("bug IDs must be unique anonymous references");
    bugIds.add(b.id);
    if (!(b.severity in issueCounts) || !["OPEN", "FIXED", "VERIFIED"].includes(b.state)) fail("invalid bug severity/state");
    if (typeof b.owner !== "string" || !/^[a-zA-Z0-9_-]{2,39}$/.test(b.owner)) fail("owner must be GitHub handle, not personal details");
    if (typeof b.issueUrl !== "string" || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(b.issueUrl)) fail("bug issueUrl must be a GitHub issue, no query string");
    if (b.state !== "VERIFIED") issueCounts[b.severity]++;
  }
  const active = [...users.values()].filter(p => p.activated !== null);
  const invited = count([...users.values()], p => p.invited !== null);
  const accepted = count([...users.values()], p => p.accepted !== null);
  const activated = active.length;
  const mature = n => active.filter(p => now - p.activated >= n * DAY_MS);
  const retained = (p, n) => {
    const calendar = new Date(Date.parse(onlyDate(p.activated) + "T00:00:00.000Z") + n * DAY_MS);
    return p.days.has(onlyDate(calendar.getTime()));
  };
  const day1 = mature(1), day7 = mature(7);
  const completed = Object.values(scenarios).reduce((n, s) => n + s.passed, 0);
  const attempted = Object.values(scenarios).reduce((n, s) => n + s.attempted, 0);
  const assisted = Object.values(scenarios).reduce((n, s) => n + s.assisted, 0);
  const firstActions = Object.fromEntries(ACTIONS.map(a => [a, count(active, p => Boolean(p.firstActions?.[a]))]));
  const report = {
    asOf, status: "GATED_NO_AUTOMATIC_GO",
    disclaimer: "Metrics are self-reported local beta records. #46 security and #51 ops require separate signed evidence. No invites are sent by this tool.",
    target: { min: 30, planned: 40, max: 50 },
    actual: { invited, accepted, activated, withdrawn: count([...users.values()], p => p.withdrawn !== null) },
    funnel: { acceptanceRate: percentage(accepted, invited), activationRate: percentage(activated, accepted) },
    segments, firstActions,
    retention: {
      D1: { mature: day1.length, returned: count(day1,p => retained(p,1)), rate: percentage(count(day1,p => retained(p,1)),day1.length) },
      D7: { mature: day7.length, returned: count(day7,p => retained(p,7)), rate: percentage(count(day7,p => retained(p,7)),day7.length) },
    },
    tasks: { attempted, completed, assisted, assistanceRate: percentage(assisted, attempted), scenarios },
    bugs: { openOrUnverified: issueCounts, criticalOrHighOpen: issueCounts.P0 + issueCounts.P1 },
    requirements: {
      invitationTargetMet: invited >= 30 && invited <= 50,
      coreCasesObserved: TASKS.every(k => scenarios[k].passed > 0),
      criticalOrHighResolved: issueCounts.P0 + issueCounts.P1 === 0,
      hasD7MatureCohort: day7.length > 0,
      manualSecurityApprovalRequired: true,
    },
  };
  return report;
}

function render(r) {
  const p = n => n === null ? "N/A (no eligible denominator)" : n.toFixed(1) + "%";
  const lines = [
    "# KararVer #47 — Closed beta measurements",
    "As-of UTC: " + r.asOf, "STATUS: " + r.status, "",
    "Invited (actual): " + r.actual.invited + " / planned " + r.target.planned + " (range " + r.target.min + "–" + r.target.max + ")",
    "Accepted (actual): " + r.actual.accepted + " | Activated (actual): " + r.actual.activated + " | Withdrawn: " + r.actual.withdrawn,
    "Acceptance: " + p(r.funnel.acceptanceRate) + " | Activation: " + p(r.funnel.activationRate),
    "D1: " + r.retention.D1.returned + "/" + r.retention.D1.mature + " (" + p(r.retention.D1.rate) + ")",
    "D7: " + r.retention.D7.returned + "/" + r.retention.D7.mature + " (" + p(r.retention.D7.rate) + ")",
    "Tasks: " + r.tasks.completed + "/" + r.tasks.attempted + " pass, assistance rate " + p(r.tasks.assistanceRate),
    "Open/unverified findings: " + JSON.stringify(r.bugs.openOrUnverified),
    "First actions: " + JSON.stringify(r.firstActions),
    "", "| Scenario | Passed | Attempted | Blocked | Assisted |", "|---|---:|---:|---:|---:|",
    ...Object.entries(r.tasks.scenarios).map(([k,s]) => "| " + k + " | " + s.passed + " | " + s.attempted + " | " + s.blocked + " | " + s.assisted + " |"),
    "", "Not a release authorization. #46, #51, #53 and owner sign-off are required.",
  ];
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = {};
  const allowed = new Set(["participants","tasks","bugs","as-of","json"]);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--") || !allowed.has(key.slice(2))) fail("unknown argument: " + key);
    if (key === "--json") { args.json = true; continue; }
    const value = argv[++i];
    if (!value || value.startsWith("--") || args[key.slice(2)] !== undefined) fail("missing/duplicate value: " + key);
    args[key.slice(2)] = value;
  }
  for (const required of ["participants","tasks","bugs","as-of"]) if (!args[required]) fail("required --" + required);
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const read = k => JSON.parse(readFileSync(args[k], "utf8"));
    const report = aggregateBeta(read("participants"), read("tasks"), read("bugs"), args["as-of"]);
    process.stdout.write((args.json ? JSON.stringify(report, null, 2) : render(report)) + "\n");
  } catch (err) {
    // On error only expose validation message, never input document content.
    console.error(err instanceof SyntaxError ? "beta-report: invalid JSON input" : String(err?.message || err));
    process.exitCode = 1;
  }
}

/**
 * #2 koordinasyon / #54 release kanıt paketi: yayına neyin engel olduğunu tek raporda toplar. SALT OKUMA: GitHub REST API'den
 * main CI, açık PR'lar (CI, review, yaş), yayın kapısı issue'larının kabul maddesi ilerlemesi, açık bug ve staging alarmları;
 * staging /health'ten çalışan sürüm. Hiçbir şeye yazmaz, birleştirmez, yorum göndermez. Çıktı Markdown'dır; #2/#54'e elle eklenir.
 *   GITHUB_TOKEN=$(gh auth token) node scripts/release-status.mjs [--repo sahip/ad] [--api https://…] [--out rapor.md]
 * Rapor GO/NO-GO kararı değildir: son karar Mehmet'tedir (#54).
 */
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/** Yayın kapısı issue'ları (KV-45 §1, #54 bağımlılıkları) ve süper admin paketi. */
export const RELEASE_GATES = [46, 47, 48, 51, 52, 53, 54];
export const ADMIN_PACKAGE = [180, 181, 182, 183, 184, 185, 186];

/** Issue gövdesindeki kabul maddeleri: "- [x]" tamam, "- [ ]" açık. */
export function checklistProgress(body) {
  const text = body ?? "";
  const done = (text.match(/^\s*[-*] \[[xX]\]/gm) ?? []).length;
  const open = (text.match(/^\s*[-*] \[ \]/gm) ?? []).length;
  return { done, total: done + open };
}

/** Check-run sonuçlarının özeti: başarısız varsa "failing", sürüyorsa "pending", hepsi geçti/atlandıysa "passing". */
export function ciSummary(runs) {
  if (!runs || runs.length === 0) return "none";
  if (runs.some((r) => ["failure", "timed_out", "cancelled", "action_required"].includes(r.conclusion ?? ""))) return "failing";
  if (runs.some((r) => r.status !== "completed")) return "pending";
  return "passing";
}

/** PR'ın review durumu: kişi başına son karar; değişiklik isteyen varsa o kazanır. */
export function reviewState(reviews) {
  const last = new Map();
  for (const r of reviews ?? []) if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(r.state)) last.set(r.user?.login, r.state);
  const states = [...last.values()];
  if (states.includes("CHANGES_REQUESTED")) return "changes_requested";
  if (states.includes("APPROVED")) return "approved";
  return "review_required";
}

export const days = (from, now) => Math.max(0, Math.floor((now.getTime() - Date.parse(from)) / 86_400_000));

const CI_LABEL = { passing: "✅", failing: "✖ kırmızı", pending: "⏳", none: "—" };
const REVIEW_LABEL = { approved: "onaylı", changes_requested: "değişiklik istendi", review_required: "review bekliyor" };
const esc = (s) => String(s).replaceAll("|", "\\|").replaceAll("\n", " ");

/** Bir PR'ın bekleme nedeni ve sıradaki sorumlusu (koordinasyon için). */
export function nextStep(pr) {
  if (pr.draft) return { who: pr.author, what: "taslak" };
  if (pr.ci === "failing") return { who: pr.author, what: "CI düzeltmesi" };
  if (pr.review === "changes_requested") return { who: pr.author, what: "review düzeltmesi" };
  if (pr.ci === "pending") return { who: "CI", what: "CI sürüyor" };
  if (pr.review === "approved") return { who: "birleştiren", what: "birleştirme" };
  return { who: "reviewer", what: "review" };
}

export function renderReport({ generatedAt, repo, main, staging, prs, gates, adminPackage, bugs, alarms }) {
  const lines = [];
  lines.push(`## Release durumu — ${generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`);
  lines.push("");
  lines.push(`> Salt okuma raporu (\`scripts/release-status.mjs\`). GO/NO-GO kararı değildir; son karar Mehmet'tedir (#54).`);
  lines.push("");
  const stagingLine = staging.error
    ? `staging /health okunamadı (${staging.error})`
    : `staging \`${staging.sha ?? "?"}\` · /health ${staging.httpStatus} \`${staging.status}\`${staging.onMain ? "" : staging.sha ? " · **main'in son yeşil commit'i değil**" : ""}`;
  lines.push(`- **main:** \`${main.sha.slice(0, 12)}\` · CI ${CI_LABEL[main.ci] ?? main.ci} · ${stagingLine}`);
  lines.push(`- **Açık staging alarmı:** ${alarms.length ? alarms.map((a) => `#${a.number}`).join(", ") : "yok"} · **Açık bug:** ${bugs.length ? bugs.map((b) => `#${b.number}`).join(", ") : "yok"}`);
  lines.push("");
  lines.push("### Yayın kapıları");
  lines.push("| Issue | Sahip | Kabul maddeleri | Son güncelleme |");
  lines.push("|---|---|---|---|");
  for (const g of gates) lines.push(`| #${g.number} ${esc(g.title.slice(0, 60))} | ${g.assignees.join(", ") || "—"} | ${g.progress.done}/${g.progress.total} | ${g.updatedDays} gün önce |`);
  if (adminPackage.length) {
    lines.push("");
    lines.push("### Süper admin paketi");
    lines.push("| Issue | Sahip | Kabul maddeleri |");
    lines.push("|---|---|---|");
    for (const g of adminPackage) lines.push(`| #${g.number} ${esc(g.title.slice(0, 60))} | ${g.assignees.join(", ") || "—"} | ${g.progress.done}/${g.progress.total} |`);
  }
  lines.push("");
  lines.push(`### Açık PR'lar (${prs.length})`);
  if (prs.length === 0) lines.push("Açık PR yok.");
  else {
    lines.push("| PR | Yazar | CI | Review | Yaş | Sırada |");
    lines.push("|---|---|---|---|---|---|");
    for (const pr of prs) {
      const step = nextStep(pr);
      lines.push(`| #${pr.number} ${esc(pr.title.slice(0, 60))} | ${pr.author} | ${CI_LABEL[pr.ci] ?? pr.ci} | ${REVIEW_LABEL[pr.review]} | ${pr.ageDays} gün | ${step.who}: ${step.what} |`);
    }
  }
  lines.push("");
  lines.push(`<sub>Kaynak: ${repo} · ${generatedAt.toISOString()}</sub>`);
  return `${lines.join("\n")}\n`;
}

async function collect({ repo, api, token, now, http = fetch }) {
  const gh = async (path) => {
    const res = await http(`https://api.github.com/repos/${repo}${path}`, {
      headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}), "x-github-api-version": "2022-11-28" },
    });
    if (!res.ok) throw new Error(`GitHub ${path.split("?")[0]} → HTTP ${res.status}`);
    return res.json();
  };
  const checks = async (sha) => (await gh(`/commits/${sha}/check-runs?per_page=100`)).check_runs ?? [];
  const mainSha = (await gh("/commits/main")).sha;
  const runs = (await gh("/actions/workflows/foundation.yml/runs?branch=main&event=push&status=completed&per_page=20")).workflow_runs ?? [];
  const green = runs.find((r) => r.conclusion === "success")?.head_sha ?? null;
  let staging;
  try {
    const res = await http(`${api}/health`, { signal: AbortSignal.timeout(15_000) });
    const body = await res.json();
    staging = { httpStatus: res.status, status: body.status, sha: body.release?.sha ?? null, onMain: !!green && !!body.release?.sha && green.startsWith(body.release.sha) };
  } catch (err) {
    staging = { error: err instanceof Error ? err.name : "hata" };
  }
  const openPrs = await gh("/pulls?state=open&per_page=50");
  const prs = [];
  for (const p of openPrs) {
    prs.push({
      number: p.number,
      title: p.title,
      author: p.user?.login ?? "?",
      draft: !!p.draft,
      ci: ciSummary(await checks(p.head.sha)),
      review: reviewState(await gh(`/pulls/${p.number}/reviews?per_page=100`)),
      ageDays: days(p.created_at, now),
    });
  }
  const issue = async (n) => {
    const i = await gh(`/issues/${n}`);
    return { number: n, title: i.title, state: i.state, assignees: (i.assignees ?? []).map((a) => a.login), progress: checklistProgress(i.body), updatedDays: days(i.updated_at, now) };
  };
  const gates = [];
  for (const n of RELEASE_GATES) gates.push(await issue(n));
  const adminPackage = [];
  for (const n of ADMIN_PACKAGE) {
    const i = await issue(n);
    if (i.state === "open") adminPackage.push(i);
  }
  const listIssues = async (label) => (await gh(`/issues?state=open&labels=${encodeURIComponent(label)}&per_page=50`)).filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title }));
  return {
    generatedAt: now,
    repo,
    main: { sha: mainSha, ci: ciSummary(await checks(mainSha)) },
    staging,
    prs,
    gates: gates.filter((g) => g.state === "open"),
    adminPackage,
    bugs: await listIssues("bug"),
    alarms: await listIssues("staging-alarm"),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values } = parseArgs({
    options: {
      repo: { type: "string", default: "mehmetalisahingm/kararver" },
      api: { type: "string", default: "https://api-staging-45cb.up.railway.app" },
      out: { type: "string" },
    },
  });
  try {
    const report = renderReport(await collect({ repo: values.repo, api: values.api, token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN, now: new Date() }));
    if (values.out) await writeFile(values.out, report);
    process.stdout.write(report);
  } catch (err) {
    console.error(`rapor üretilemedi: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

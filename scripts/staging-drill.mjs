// KV-48 (#50) staging tatbikatı: yedek → boş DB'ye restore → doğrulama → medya tutarlılığı → smoke → geri dönüş/RTO.
// Adımlar ve kurallar: docs/KV-48_BACKUP_RESTORE.md. Komut satırına parola yazılmaz; her şey ortam değişkeninden okunur.
//
//   DATABASE_URL=<staging Postgres, public adres>
//   RESTORE_DATABASE_URL=<aynı sunucuda YENİ bir veritabanı, ör. .../kararver_restore_20261005>
//   S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_PRIVATE, S3_BUCKET_PUBLIC  (staging R2, salt-okur yeter)
//   STAGING_API_URL=https://...  STAGING_WEB_URL=https://...
//   PG_BIN=<PostgreSQL 17 istemci klasörü>  (pg_dump/pg_restore PATH'te değilse)
//
//   node scripts/staging-drill.mjs prepare
//     Staging'e DOKUNMAZ: smoke (önce), yedek, restore, doğrulama, iki DB'de medya denetimi. Yalnız okur ve yeni DB açar.
//   node scripts/staging-drill.mjs switch
//     Geri dönüşü ölçer: API/worker DATABASE_URL'i RESTORE_DATABASE_URL'e çevrildikten sonra (Railway) çalıştırılır;
//     API yeniden sağlıklı ve smoke geçene kadar bekler. RTO = restore başlangıcı → smoke geçişi.
//
// Rapor: drill/<tarih>/report.json ve report.md (repoya girmez). Parolalar yazılmaz.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
if (mode !== 'prepare' && mode !== 'switch') {
  console.error('Kullanım: node scripts/staging-drill.mjs prepare | switch');
  process.exit(2);
}

const need = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`eksik ortam değişkeni: ${k}`);
    process.exit(2);
  }
  return v;
};
const redact = (u) => {
  const x = new URL(u);
  if (x.password) x.password = '***';
  return x.toString();
};

const day = new Date().toISOString().slice(0, 10);
const dir = path.join(root, 'drill', day);
const reportFile = path.join(dir, 'report.json');
await mkdir(dir, { recursive: true });
let report = {};
try {
  report = JSON.parse(await readFile(reportFile, 'utf8'));
} catch {}
const save = async () => {
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(dir, 'report.md'), markdown(report));
};

/** Repodaki bir betiği Node ile çalıştırır (pnpm gerekmez); çıktıyı hem ekrana basar hem döner. */
function run(script, args, env = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(root, script), ...args], { cwd: root, env: { ...process.env, ...env } });
    child.on('error', (err) => resolve({ code: 1, ms: Date.now() - started, out: String(err) }));
    let out = '';
    const tee = (d) => {
      out += d;
      process.stdout.write(d);
    };
    child.stdout.on('data', tee);
    child.stderr.on('data', tee);
    child.on('close', (code) => resolve({ code: code ?? 1, ms: Date.now() - started, out }));
  });
}

const smoke = (api, web) => run('scripts/smoke.mjs', ['--api', api, '--web', web]);
const step = (name, r, extra = {}) => {
  report.steps ??= [];
  report.steps.push({ name, ok: r.code === 0, ms: r.ms, at: new Date().toISOString(), ...extra });
  console.log(`\n── ${name}: ${r.code === 0 ? 'OK' : 'BAŞARISIZ'} (${(r.ms / 1000).toFixed(1)} sn)\n`);
  return r.code === 0;
};

const api = need('STAGING_API_URL');
const web = need('STAGING_WEB_URL');
const source = need('DATABASE_URL');
const target = need('RESTORE_DATABASE_URL');
const s3 = Object.fromEntries(['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET_PRIVATE', 'S3_BUCKET_PUBLIC'].map((k) => [k, need(k)]));
const workerEnv = (db) => ({ APP_ENV: 'staging', DATABASE_URL: db, JOBS_ENABLED: 'false', ...s3 });

if (mode === 'prepare') {
  report = { day, source: redact(source), target: redact(target), api, web, steps: [] };
  step('smoke (önce)', await smoke(api, web));
  step('medya tutarlılığı (canlı DB)', await run('apps/worker/scripts/media-consistency.ts', [], workerEnv(source)));

  const b = await run('packages/db/ops/backup.ts', ['--out', dir], { DATABASE_URL: source });
  const file = b.out.match(/yedek: (.+\.dump)/)?.[1]?.trim();
  if (!step('yedek', b, { file: file && path.basename(file) }) || !file) {
    await save();
    process.exit(1);
  }
  report.backupFile = file;
  report.restoreStartedAt = new Date().toISOString();
  const r = await run('packages/db/ops/restore.ts', ['--file', file], { RESTORE_DATABASE_URL: target, DATABASE_URL: source });
  const ok = step('boş DB\'ye restore + doğrulama', r);
  report.restoreSummary = r.out.split('\n').filter((l) => /restore:|SONUÇ|✖/.test(l));
  if (ok) step('medya tutarlılığı (restore edilmiş DB)', await run('apps/worker/scripts/media-consistency.ts', [], workerEnv(target)));
  await save();
  console.log(`\nRapor: ${path.join(dir, 'report.md')}`);
  console.log('Sonraki adım (geri dönüş provası): staging API ve worker DATABASE_URL → RESTORE_DATABASE_URL, yeniden başlat, sonra: node scripts/staging-drill.mjs switch');
  process.exitCode = ok ? 0 : 1;
} else {
  if (!report.restoreStartedAt) {
    console.error('Önce prepare çalıştırılmalı (aynı gün).');
    process.exit(2);
  }
  // API yeniden açılana kadar bekle (en çok 15 dk), sonra smoke.
  const deadline = Date.now() + 15 * 60_000;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(new URL('/health', api), { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 5000));
  }
  const s = healthy ? await smoke(api, web) : { code: 1, ms: 0, out: '' };
  step('geri dönüş: restore edilmiş DB ile smoke', s);
  report.rtoMs = Date.now() - Date.parse(report.restoreStartedAt);
  await save();
  console.log(`RTO (restore başlangıcı → smoke): ${(report.rtoMs / 60000).toFixed(1)} dk`);
  process.exitCode = s.code;
}

function markdown(r) {
  const rows = (r.steps ?? []).map((s) => `| ${s.name} | ${s.ok ? '✅' : '❌'} | ${(s.ms / 1000).toFixed(1)} sn |`).join('\n');
  return [
    `# KV-48 staging tatbikatı — ${r.day}`,
    '',
    `Kaynak: \`${r.source}\` · Hedef: \`${r.target}\` · API: ${r.api} · Web: ${r.web}`,
    '',
    '| Adım | Sonuç | Süre |',
    '|---|---|---|',
    rows,
    '',
    r.restoreSummary ? ['```', ...r.restoreSummary, '```'].join('\n') : '',
    r.rtoMs ? `**RTO (restore başlangıcı → smoke geçişi):** ${(r.rtoMs / 60000).toFixed(1)} dk` : '',
    '',
  ].join('\n');
}

// Yerel kurulum kontrolü (KV-06): pnpm check:setup  ya da pnpm yokken  node scripts/check-setup.mjs
// Her sorun için tek satırlık çözüm komutu yazar. Ayrıntı: docs/KV-06_LOCAL_SETUP.md
// HATA varsa çıkış kodu 1, yalnız UYARI varsa 0. Yeni bağımlılık kullanmaz; hiçbir şeyi değiştirmez.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const dbDir = resolve(root, 'packages/db');
const isWindows = process.platform === 'win32';
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const pnpmWanted = pkg.packageManager.replace(/^pnpm@/, '');
const nodeWanted = readFileSync(resolve(root, '.nvmrc'), 'utf8').trim().replace(/^v/, '');

let errors = 0;
let warnings = 0;
const ok = (msg) => console.log(`[OK]    ${msg}`);
// Çözüm satırında ">" kullanılmaz: cmd'ye yapıştırılınca yönlendirme olur (docs/KV-06_LOCAL_SETUP.md §4.7).
const fail = (msg, fix) => { errors++; console.log(`[HATA]  ${msg}\n        çözüm: ${fix}`); };
const warn = (msg, fix) => { warnings++; console.log(`[UYARI] ${msg}${fix ? `\n        çözüm: ${fix}` : ''}`); };
const skip = (msg, reason) => console.log(`[ATLA]  ${msg} (${reason})`);
const run = (cmd, args, opts = {}) => (Array.isArray(args)
  ? spawnSync(cmd, args, { encoding: 'utf8', cwd: root, ...opts })
  : spawnSync(cmd, { encoding: 'utf8', cwd: root, ...args }));
const byOs = (win, unix) => (isWindows ? win : unix);
const mask = (url) => { try { const u = new URL(url); if (u.password) u.password = '***'; return u.toString(); } catch { return '(geçersiz URL)'; } };

console.log(`KararVer check:setup — ${process.platform}, ${root}\n`);

// 1. Node
const nodeHave = process.versions.node;
const nodeMajor = Number(nodeHave.split('.')[0]);
if (nodeHave === nodeWanted) ok(`Node ${nodeHave} (.nvmrc)`);
else if (nodeMajor !== Number(nodeWanted.split('.')[0])) {
  fail(`Node ${nodeHave} kurulu, repo ${nodeWanted} istiyor (.nvmrc)`,
    byOs(`nvm install ${nodeWanted}  ardından  nvm use ${nodeWanted}   (nvm-windows yoksa: https://nodejs.org/dist/v${nodeWanted}/)`,
      `nvm install ${nodeWanted} && nvm use ${nodeWanted}`));
} else warn(`Node ${nodeHave}, .nvmrc ${nodeWanted} diyor (major aynı, çalışır)`, `nvm install ${nodeWanted}  ardından  nvm use ${nodeWanted}`);

// 2. pnpm
const agent = process.env.npm_config_user_agent?.match(/pnpm\/(\S+)/)?.[1];
const pnpmHave = agent ?? (() => {
  // Windows'ta pnpm bir .cmd shim'i; kabuk gerekir. Argüman dizisi verilmez (DEP0190).
  const r = isWindows ? run('pnpm --version', { shell: true }) : run('pnpm', ['--version']);
  return r.status === 0 ? r.stdout.trim() : null;
})();
const pnpmFix = `npm i -g pnpm@${pnpmWanted}`;
if (!pnpmHave) fail('pnpm bulunamadı', `${pnpmFix}   (corepack enable EPERM verirse de bu yol)`);
else if (pnpmHave !== pnpmWanted) fail(`pnpm ${pnpmHave} kurulu, package.json packageManager ${pnpmWanted} istiyor`, pnpmFix);
else ok(`pnpm ${pnpmHave} (packageManager)`);

// 3. Bağımlılıklar
const prismaCli = (() => {
  try { return createRequire(resolve(dbDir, 'package.json')).resolve('prisma/build/index.js'); } catch { return null; }
})();
const depsOk = existsSync(resolve(root, 'node_modules')) && prismaCli && existsSync(resolve(dbDir, 'generated/prisma'));
if (depsOk) ok('Bağımlılıklar kurulu, Prisma client üretilmiş');
else fail('Bağımlılıklar eksik (node_modules veya packages/db/generated yok)', 'pnpm install');

// 4. .env
const envPath = resolve(root, '.env');
let env = null;
if (!existsSync(envPath)) {
  fail('.env yok', byOs('copy .env.example .env   (PowerShell: Copy-Item .env.example .env)', 'cp .env.example .env'));
} else {
  env = parseEnv(readFileSync(envPath, 'utf8'));
  if (!env.DATABASE_URL) fail('.env içinde DATABASE_URL yok', '.env.example\'daki DATABASE_URL satırını .env\'ye kopyalayın');
  else ok(`.env var, DATABASE_URL=${mask(env.DATABASE_URL)}`);
  if (!env.AUTH_TOKEN_PEPPER) {
    warn('.env içinde AUTH_TOKEN_PEPPER boş (testler için gerekmez, pnpm dev için gerekir)',
      `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   çıktısını AUTH_TOKEN_PEPPER= satırına yazın`);
  }
}

// 5. Docker
const dockerInfo = run('docker', ['info', '--format', '{{.ServerVersion}}']);
const dockerUp = dockerInfo.status === 0;
if (dockerInfo.error) fail('docker komutu bulunamadı', 'Docker Desktop kurun: https://docs.docker.com/get-docker/');
else if (!dockerUp) fail('Docker çalışmıyor', byOs('Docker Desktop\'ı başlatın, "Engine running" olunca tekrar deneyin', process.platform === 'darwin' ? 'open -a Docker' : 'sudo systemctl start docker'));
else ok(`Docker ${dockerInfo.stdout.trim()} çalışıyor`);

// 6. postgres container
let pgHealthy = false;
if (!dockerUp) skip('postgres container', 'Docker çalışmıyor');
else {
  const ps = run('docker', ['compose', 'ps', '--format', 'json', 'postgres']);
  // Compose sürümüne göre tek JSON dizi ya da satır başına bir nesne döner.
  const rows = ps.status === 0 ? ps.stdout.trim().split(/\r?\n/).filter(Boolean).flatMap((line) => JSON.parse(line)) : [];
  const pg = rows.find((r) => r.Service === 'postgres');
  if (!pg) fail('postgres container çalışmıyor', 'docker compose up -d');
  else if (pg.Health === 'healthy') { pgHealthy = true; ok(`postgres container healthy (${pg.Name})`); }
  else if (pg.Health === 'starting') fail('postgres container henüz hazır değil (starting)', 'birkaç saniye bekleyip tekrar: pnpm check:setup');
  else fail(`postgres container durumu: ${pg.State}${pg.Health ? `/${pg.Health}` : ''}`, 'docker compose up -d   (düzelmezse: docker compose logs postgres)');
}

// 7–8. Dev DB bağlantısı ve migration'lar
if (!env?.DATABASE_URL || !prismaCli) skip('Dev DB bağlantısı ve migration\'lar', !prismaCli ? 'bağımlılıklar eksik' : '.env/DATABASE_URL yok');
else if (!pgHealthy) skip('Dev DB bağlantısı ve migration\'lar', 'postgres hazır değil');
else {
  const status = run(process.execPath, [prismaCli, 'migrate', 'status'], { cwd: dbDir, env: { ...process.env, DATABASE_URL: env.DATABASE_URL } });
  const out = `${status.stdout}\n${status.stderr}`;
  if (/P1001|Can't reach database server/i.test(out)) {
    fail(`Dev DB'ye bağlanılamadı (${mask(env.DATABASE_URL)})`, 'docker compose up -d   (5432 başka bir Postgres\'te olabilir: docs/KV-06_LOCAL_SETUP.md)');
  } else if (/not yet been applied|have not yet been applied/i.test(out)) {
    ok('Dev DB bağlantısı');
    fail('Uygulanmamış migration var', 'pnpm db:migrate');
  } else if (status.status === 0) {
    ok('Dev DB bağlantısı');
    ok('Migration\'lar güncel');
  } else {
    fail('prisma migrate status başarısız', `pnpm --filter @kararver/db exec prisma migrate status   ile ayrıntıya bakın`);
    console.log(out.trim().split(/\r?\n/).slice(-5).map((l) => `        ${l}`).join('\n'));
  }
}

// 9. Test veritabanı. API/worker harness'i ve db:test aynı kuralı izler: ortamdaki TEST_DATABASE_URL, yoksa .env'deki
//    TEST_DATABASE_URL, o da yoksa DATABASE_URL + "_test" (apps/api/test/support/test-db.ts).
const derivedTestUrl = (() => {
  const base = process.env.DATABASE_URL ?? env?.DATABASE_URL;
  if (!base) return undefined;
  try {
    const u = new URL(base);
    u.pathname = `${u.pathname.replace(/^\//, '')}_test`;
    return u.toString();
  } catch {
    return undefined;
  }
})();
const testUrl = process.env.TEST_DATABASE_URL ?? env?.TEST_DATABASE_URL ?? derivedTestUrl;
const exampleTestUrl = 'postgresql://kararver:kararver_local@localhost:5432/kararver_test';
const setFix = byOs(`set TEST_DATABASE_URL=${exampleTestUrl}   (PowerShell: $env:TEST_DATABASE_URL = "${exampleTestUrl}")`,
  `export TEST_DATABASE_URL=${exampleTestUrl}`);
if (!testUrl) {
  warn('Test veritabanı belirlenemedi (TEST_DATABASE_URL yok, .env\'de DATABASE_URL yok): API/worker PostgreSQL testleri ATLANIR (uyarıyla)', setFix);
} else {
  let parsed = null;
  try { parsed = new URL(testUrl); } catch { /* aşağıda raporlanır */ }
  const name = parsed && decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!parsed) fail('TEST_DATABASE_URL geçerli bir URL değil', setFix);
  else if (!name.endsWith('_test')) fail(`TEST_DATABASE_URL veritabanı adı "_test" ile bitmeli (şu an: "${name}")`, setFix);
  else if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) warn(`TEST_DATABASE_URL yerel değil (${parsed.hostname}); pnpm test:reset bunu reddeder`, null);
  else ok(`TEST_DATABASE_URL=${mask(testUrl)}`);
}

// 10. cmd'de yanlış yönlendirmeden kalan dosyalar
const strays = ['pnpm', 'prisma'].filter((f) => existsSync(resolve(root, f)));
if (strays.length) warn(`Kök dizinde artık dosya: ${strays.join(', ')} (cmd'de ">" yönlendirmesinden kalmış olabilir)`, byOs(`del ${strays.join(' ')}   (PowerShell: Remove-Item ${strays.join(', ')})`, `rm ${strays.join(' ')}`));

console.log(`\n${errors} hata, ${warnings} uyarı.${errors ? ' Çözüm satırlarını sırayla uygulayıp tekrar çalıştırın: pnpm check:setup' : ''}`);
process.exitCode = errors ? 1 : 0;

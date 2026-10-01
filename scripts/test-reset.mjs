// Yerel test veritabanını sıfırlar (KV-06): pnpm test:reset
// Hedef, pnpm db:test ile aynı kuralla seçilir: TEST_DATABASE_URL, yoksa .env'deki DATABASE_URL + "_test".
// Yalnız adı "_test" ile biten, localhost/127.0.0.1 üzerindeki bir veritabanına dokunur; diğer her durumda reddeder.
// Sıfırlama "prisma migrate reset --force" ile yapılır: tüm tablolar silinir, migration'lar baştan uygulanır.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const dbDir = resolve(root, 'packages/db');

function refuse(msg) {
  console.error(`test:reset reddedildi: ${msg}`);
  process.exit(1);
}

function targetUrl() {
  if (process.env.TEST_DATABASE_URL) return { url: process.env.TEST_DATABASE_URL, source: 'TEST_DATABASE_URL' };
  const envPath = resolve(root, '.env');
  const base = process.env.DATABASE_URL ?? (existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')).DATABASE_URL : undefined);
  if (!base) refuse('TEST_DATABASE_URL yok ve .env içinde DATABASE_URL yok (bkz. docs/KV-06_LOCAL_SETUP.md)');
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/^\//, '')}_test`;
  return { url: url.toString(), source: 'DATABASE_URL + "_test"' };
}

const { url, source } = targetUrl();
let parsed;
try { parsed = new URL(url); } catch { refuse(`${source} geçerli bir URL değil`); }
const host = parsed.hostname;
const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
if (!dbName.endsWith('_test')) refuse(`veritabanı adı "_test" ile bitmiyor ("${dbName}")`);
if (!['localhost', '127.0.0.1'].includes(host)) refuse(`host yerel değil ("${host}"); yalnız localhost/127.0.0.1 sıfırlanır`);

let prismaCli;
try {
  prismaCli = createRequire(resolve(dbDir, 'package.json')).resolve('prisma/build/index.js');
} catch {
  refuse('Prisma CLI bulunamadı; önce: pnpm install');
}

console.log(`Sıfırlanacak: host=${host} port=${parsed.port || '5432'} db=${dbName} (kaynak: ${source})`);
const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'reset', '--force'], {
  cwd: dbDir,
  env: { ...process.env, DATABASE_URL: url },
  stdio: 'inherit',
});
process.exitCode = result.status ?? 1;

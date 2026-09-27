// Own the preview server lifecycle so CI and local runs use the same command.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../ui/design-system/', import.meta.url));
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(resolve(root) + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const child = spawn(process.execPath, [resolve(root, 'tests/verify.cjs')], {
  stdio: 'inherit',
  env: { ...process.env, KV_PREVIEW_URL: `http://127.0.0.1:${server.address().port}` },
});
const timeout = setTimeout(() => child.kill(), 8 * 60_000);
try {
  process.exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => resolve(code ?? 1));
  });
} finally {
  clearTimeout(timeout);
  server.closeAllConnections();
  server.close();
}

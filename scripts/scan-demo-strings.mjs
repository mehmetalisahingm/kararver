// #187: api modu web build'inde demo izi taraması. Liste: scripts/demo-forbidden-strings.json.
// Kullanım: node scripts/scan-demo-strings.mjs [dizin ...]   (varsayılan: apps/web/.next/static apps/web/.next/server)
// Dosya içeriği ve dosya yolu aranır; .map dosyaları atlanır. Bir iz bile bulunursa çıkış kodu 1'dir.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const { strings } = JSON.parse(readFileSync(path.join(import.meta.dirname, "demo-forbidden-strings.json"), "utf8"));
const dirs = process.argv.slice(2).length
  ? process.argv.slice(2).map((d) => path.resolve(d))
  : ["apps/web/.next/static", "apps/web/.next/server"].map((d) => path.join(root, d));

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (entry.isFile() && !entry.name.endsWith(".map")) yield full;
  }
}

let scanned = 0;
const hits = new Map(strings.map((s) => [s.value, []]));
for (const dir of dirs) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`FAIL dizin yok: ${path.relative(root, dir)} (önce web build'i alın)`);
    process.exit(2);
  }
  for (const file of files(dir)) {
    scanned++;
    const rel = path.relative(root, file).replaceAll("\\", "/");
    const text = readFileSync(file, "latin1") + "\n" + readFileSync(file, "utf8");
    for (const { value } of strings) if (rel.includes(value) || text.includes(value)) hits.get(value).push(rel);
  }
}

let found = 0;
for (const { value, why } of strings) {
  const where = hits.get(value);
  if (where.length) found++;
  console.log(`${where.length ? "FAIL" : "PASS"} ${JSON.stringify(value)} (${why})${where.length ? ` — ${where.length} dosya: ${where.slice(0, 3).join(", ")}${where.length > 3 ? " …" : ""}` : ""}`);
}
console.log(`\n${scanned} dosya tarandı · ${strings.length} dizge · ${found} dizgede iz bulundu`);
process.exitCode = found ? 1 : 0;

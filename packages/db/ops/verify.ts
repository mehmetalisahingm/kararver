// KV-48 (#50) — salt-okur sağlık kontrolü: pnpm --filter @kararver/db db:verify [--manifest <yedek.dump.manifest.json>]
//
// DATABASE_URL'deki veritabanında tutarlılık kontrollerini çalıştırır. --manifest verilirse durumu o yedeğin
// manifestiyle de karşılaştırır (ör. restore edilmiş bir veritabanını sonradan yeniden doğrulamak için).
// Migration öncesi/sonrası ve deploy rollback'inde kullanılır (docs/KV-48_BACKUP_RESTORE.md). Hiçbir şey yazmaz.
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createPrismaClient } from "../src/index.ts";
import type { Manifest } from "./backup.ts";
import { checkInvariants, collectState, compareState } from "./state.ts";

const { values } = parseArgs({ options: { manifest: { type: "string" } } });
const prisma = createPrismaClient(process.env.DATABASE_URL);
try {
  let failed = false;
  if (values.manifest) {
    const manifest = JSON.parse(await readFile(values.manifest, "utf8")) as Manifest;
    const diffs = compareState(manifest.state, await collectState(prisma));
    for (const d of diffs) console.error(`  ✖ ${d}`);
    failed ||= diffs.length > 0;
  }
  for (const i of await checkInvariants(prisma)) {
    console.log(`  ${i.violations === 0 ? "✔" : "✖"} ${i.name}${i.violations ? `: ${i.violations} ihlal` : ""}`);
    failed ||= i.violations > 0;
  }
  console.log(failed ? "SONUÇ: sorun var" : "SONUÇ: tutarlı");
  process.exitCode = failed ? 1 : 0;
} finally {
  await prisma.$disconnect();
}

// docs/API_CONTRACTS.md envanter bloklarını registry'den yeniler.
// Kullanım: pnpm --filter @kararver/contracts docs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { endpoints } from "../src/index.ts";
import { renderInventory, renderUnblocks, replaceBlock } from "../src/inventory.ts";

const docPath = path.resolve(import.meta.dirname, "../../../docs/API_CONTRACTS.md");
const original = readFileSync(docPath, "utf8").replaceAll("\r\n", "\n");
let doc = replaceBlock(original, "inventory", renderInventory(endpoints));
doc = replaceBlock(doc, "unblocks", renderUnblocks(endpoints));
writeFileSync(docPath, doc);
console.log(`${endpoints.length} endpoint yazıldı → ${path.relative(process.cwd(), docPath)}`);

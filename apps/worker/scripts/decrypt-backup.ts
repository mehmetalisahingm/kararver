// KV-48 restore öncesi: şifreli yedeği çözer. Özel anahtar yalnız restore yapan kişinin makinesinde, dosya olarak.
//   node apps/worker/scripts/decrypt-backup.ts --in <dosya>.dump.enc --out <dosya>.dump --key <özel-anahtar.pem>
// Etiket doğrulanmazsa (dosya değişmiş/kesik) çıktı silinir ve hata verilir. Sonra: db:restore --file <dosya>.dump
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { decryptFile } from "../src/jobs/backup/envelope.ts";

const { values } = parseArgs({ options: { in: { type: "string" }, out: { type: "string" }, key: { type: "string" } } });
if (!values.in || !values.out || !values.key) {
  console.error("kullanım: --in <şifreli> --out <döküm> --key <özel-anahtar.pem>");
  process.exit(2);
}
try {
  await decryptFile(values.in, values.out, await readFile(values.key, "utf8"));
  console.log(`çözüldü: ${values.out}`);
} catch (err) {
  console.error(`çözülemedi: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}

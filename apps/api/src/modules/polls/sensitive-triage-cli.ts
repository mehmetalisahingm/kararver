// #327 hassas içerik envanteri CLI'ı (salt okuma):
//   TRIAGE_DATABASE_URL=postgresql://… pnpm --filter @kararver/api content:sensitive-triage [--out <yeni-dosya.csv>]
// stdout: yalnız sayılar (tür, kategori, durum). Metin, e-posta, kullanıcı ID'si veya bağlantı adresi basılmaz.
// --out: bulguların tür,id,pollId,durum,kategori,alan listesi; dosya yeni oluşturulur (varsa reddedilir), izin 0600.
// Bu listeyi issue, CI log'u veya artifact'a koymayın; inceleme yalnız yetkili moderasyon kanalında yapılır.
// Çıkış kodu: 0 = tarama bitti (bulgu olsa da), 1 = hata, 2 = kullanım hatası.
import { open } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createPrismaClient } from "@kararver/db";
import { runReadOnlyTriage, type TriageHit } from "./sensitive-triage.ts";

const USAGE = "Kullanım: TRIAGE_DATABASE_URL=… pnpm --filter @kararver/api content:sensitive-triage [--out <yeni-dosya.csv>]";

const argv = process.argv.slice(2);
if (argv[0] === "--") argv.shift();
let out: string | undefined;
try {
  ({ values: { out } } = parseArgs({ args: argv, options: { out: { type: "string" } }, strict: true, allowPositionals: false }));
} catch (err) {
  console.error(`${(err as Error).message}\n${USAGE}`);
  process.exit(2);
}
const url = process.env.TRIAGE_DATABASE_URL;
if (!url) {
  console.error(`TRIAGE_DATABASE_URL gerekli (DATABASE_URL bilerek kullanılmaz).\n${USAGE}`);
  process.exit(2);
}

const file = out ? await open(out, "wx", 0o600) : null;
const prisma = createPrismaClient(url);
try {
  await file?.write("kind,id,pollId,status,category,field\n");
  const summary = await runReadOnlyTriage(prisma, async (h: TriageHit) => {
    await file?.write(`${h.kind},${h.id},${h.pollId},${h.status},${h.category},${h.field}\n`);
  });
  console.log(JSON.stringify({ triage: "sensitive-content-v1", readOnly: true, summary }));
} catch (err) {
  // Prisma hataları bağlantı adresi taşıyabilir; yalnız genel kod basılır.
  console.error(JSON.stringify({ triage: "sensitive-content-v1", error: (err as { code?: string }).code ?? "triage_failed" }));
  process.exitCode = 1;
} finally {
  await file?.close();
  await prisma.$disconnect();
}

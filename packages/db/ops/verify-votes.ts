// KV-44 (#46) — anket bazlı oy tutarlılığı: pnpm --filter @kararver/db db:verify-votes --poll <uuid> [--poll <uuid> ...]
//
// DATABASE_URL'deki veritabanında, verilen anketler için ops/vote-invariants.ts kontrollerini READ ONLY transaction'da
// çalıştırır; hiçbir şey yazmaz. Çıktıda yalnız sayılar vardır (hesap, e-posta, oy seçimi yok). Staging R3 kanıtı bu çıktıdır.
// --print-sql: SQL'i yazdırır ve çıkar (psql'de $1 yerine ARRAY['<uuid>']::uuid[]).
import { parseArgs } from "node:util";
import { createPrismaClient } from "../src/index.ts";
import { checkVoteInvariants, VOTE_INVARIANTS_SQL } from "./vote-invariants.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const { values } = parseArgs({ options: { poll: { type: "string", multiple: true }, "print-sql": { type: "boolean" } } });

if (values["print-sql"]) {
  console.log(VOTE_INVARIANTS_SQL.trim());
} else {
  const polls = values.poll ?? [];
  if (polls.length === 0 || !polls.every((p) => UUID.test(p))) {
    console.error("kullanım: db:verify-votes --poll <uuid> [--poll <uuid> ...]");
    process.exit(2);
  }
  const prisma = createPrismaClient(process.env.DATABASE_URL);
  try {
    const report = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return checkVoteInvariants(tx, polls);
    });
    const s = report.summary;
    console.log(`  anket=${s.polls} oy=${s.votes} geçerli=${s.validVotes} CAST=${s.castEvents} CHANGE=${s.changeEvents}`);
    for (const i of report.invariants) console.log(`  ${i.violations === 0 ? "✔" : "✖"} ${i.name}${i.violations ? `: ${i.violations} ihlal` : ""}`);
    const failed = report.invariants.some((i) => i.violations > 0);
    console.log(failed ? "SONUÇ: sorun var" : "SONUÇ: tutarlı");
    process.exitCode = failed ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

// KV-48 (#50) — veritabanının yedek/restore karşılaştırması için durum özeti ve tutarlılık kontrolleri.
//
// Özet üç parçadır:
// - migrations: uygulanmış migration adları (Prisma _prisma_migrations).
// - rows: public şemadaki her tablonun tam satır sayısı.
// - catalog: Prisma'nın yönetmediği elle yazılmış SQL dahil şema nesneleri (trigger + etkin/pasif durumu,
//   CHECK/FK kısıtları + doğrulanmış mı, index tanımları, fonksiyon gövdelerinin özeti, eklentiler).
//   `prisma migrate diff` trigger, CHECK ve fonksiyonları görmez; restore sonrası bunların eksiksiz geldiği buradan anlaşılır.
//
// Tutarlılık kontrolleri (invariants) yalnız okur. Sayaç kolonları (polls.vote_count vb.) kaynak tablolarla aynı
// transaction'da güncellenir; yedekten dönen veride ya da canlı DB'de farkları, yarım kalmış yazım veya hatalı elle
// müdahalenin işaretidir.
import type { PrismaClient } from "../src/index.ts";

export type Catalog = {
  triggers: string[];
  constraints: string[];
  indexes: string[];
  functions: string[];
  extensions: string[];
};

export type DbState = {
  migrations: string[];
  rows: Record<string, number>;
  catalog: Catalog;
};

export type Invariant = { name: string; violations: number };

/** Tek ifade ve tek snapshot: çağıran REPEATABLE READ transaction'ında ise bütün sayımlar aynı ana aittir. */
type Sql = Pick<PrismaClient, "$queryRawUnsafe">;

const strings = async (db: Sql, sql: string) => (await db.$queryRawUnsafe<{ v: string }[]>(sql)).map((r) => r.v);

export async function collectState(db: Sql): Promise<DbState> {
  const migrations = await strings(
    db,
    `SELECT migration_name AS v FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
  );
  const tables = await strings(
    db,
    `SELECT c.relname AS v FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname`,
  );
  const rows: Record<string, number> = {};
  for (const t of tables) {
    const [r] = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${t.replaceAll('"', '""')}"`);
    rows[t] = r!.n;
  }
  const catalog: Catalog = {
    triggers: await strings(
      db,
      `SELECT c.relname || '.' || t.tgname || ' enabled=' || t.tgenabled::text AS v
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal AND n.nspname = 'public' ORDER BY 1`,
    ),
    constraints: await strings(
      db,
      `SELECT c.relname || '.' || k.conname || ' ' || pg_get_constraintdef(k.oid) || CASE WHEN k.convalidated THEN '' ELSE ' NOT VALID' END AS v
         FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' ORDER BY 1`,
    ),
    indexes: await strings(db, `SELECT indexdef AS v FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`),
    functions: await strings(
      db,
      `SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') md5=' || md5(p.prosrc) AS v
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
        ORDER BY 1`,
    ),
    extensions: await strings(db, `SELECT extname || '@' || extversion AS v FROM pg_extension ORDER BY 1`),
  };
  return { migrations, rows, catalog };
}

/**
 * Kısıt tanımının yazım biçimini eşitler. PostgreSQL, CHECK ifadesini dökümden yeniden okurken tip dönüşümlerini
 * farklı yere yazabilir: `x = ANY ((ARRAY['a'::character varying])::text[])` restore sonrası
 * `x = ANY (ARRAY[('a'::character varying)::text])` olur (staging PG 18 tatbikatında görüldü). Anlam aynıdır;
 * tip dönüşümleri, parantezler ve boşluklar atılınca iki yazım eşleşir. Kısıt adı ve geri kalan ifade aynen karşılaştırılır.
 */
export function normalizeConstraint(def: string): string {
  return def
    // Yalnız tip adı atılır ("character varying" veya tek kelime); ardından gelen AND/OR gibi kelimelere dokunulmaz.
    .replace(/::(character varying|"?[a-z_][a-z0-9_]*"?)(\[\])?/gi, "")
    .replace(/[()\s]/g, "");
}

/** İki özet arasındaki farklar; boş dizi = aynı. */
export function compareState(expected: DbState, actual: DbState): string[] {
  const diffs: string[] = [];
  const list = (label: string, a: string[], b: string[]) => {
    const norm = label === "constraints" ? normalizeConstraint : (x: string) => x;
    const sa = new Set(a.map(norm));
    const sb = new Set(b.map(norm));
    for (const x of a) if (!sb.has(norm(x))) diffs.push(`${label}: eksik ${x}`);
    for (const x of b) if (!sa.has(norm(x))) diffs.push(`${label}: fazla ${x}`);
  };
  list("migration", expected.migrations, actual.migrations);
  for (const t of new Set([...Object.keys(expected.rows), ...Object.keys(actual.rows)])) {
    const e = expected.rows[t];
    const a = actual.rows[t];
    if (e !== a) diffs.push(`satır: ${t} beklenen ${e ?? "tablo yok"}, bulunan ${a ?? "tablo yok"}`);
  }
  for (const k of Object.keys(expected.catalog) as (keyof Catalog)[]) list(k, expected.catalog[k], actual.catalog[k]);
  return diffs;
}

/**
 * Tutarlılık kontrolleri. Toplu (GROUP BY) yazılır: 100.000 oyda satır başına alt sorgu ~30 sn, bu hâliyle < 1 sn (KV-47 profili). Her biri ihlal eden satır sayısını döner (0 = sağlam). Sadece bu tablolar varsa çalışır;
 * şema henüz o migration'a gelmemişse kontrol atlanır (eski bir yedeği doğrularken).
 */
const INVARIANTS: { name: string; needs: string[]; sql: string }[] = [
  {
    name: "migration: yarım kalmış (başarısız) migration yok",
    needs: ["_prisma_migrations"],
    sql: `SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
  },
  {
    name: "polls.vote_count = geçerli oy sayısı",
    needs: ["polls", "votes"],
    sql: `SELECT count(*)::int AS n FROM polls p
           LEFT JOIN (SELECT poll_id, count(*) AS c FROM votes WHERE invalidated_at IS NULL GROUP BY poll_id) v ON v.poll_id = p.id
           WHERE p.vote_count <> coalesce(v.c, 0)`,
  },
  {
    name: "poll_options.vote_count = seçeneğin geçerli oy sayısı",
    needs: ["poll_options", "votes"],
    sql: `SELECT count(*)::int AS n FROM poll_options o
           LEFT JOIN (SELECT option_id, count(*) AS c FROM votes WHERE invalidated_at IS NULL GROUP BY option_id) v ON v.option_id = o.id
           WHERE o.vote_count <> coalesce(v.c, 0)`,
  },
  {
    name: "oy, anketin kendi seçeneğinde",
    needs: ["votes", "poll_options"],
    sql: `SELECT count(*)::int AS n FROM votes v JOIN poll_options o ON o.id = v.option_id WHERE o.poll_id <> v.poll_id`,
  },
  {
    name: "polls.like_count/dislike_count = tepki sayısı",
    needs: ["polls", "poll_reactions"],
    sql: `SELECT count(*)::int AS n FROM polls p
           LEFT JOIN (SELECT poll_id, count(*) FILTER (WHERE value = 'LIKE') AS l, count(*) FILTER (WHERE value = 'DISLIKE') AS d
                        FROM poll_reactions GROUP BY poll_id) r ON r.poll_id = p.id
           WHERE p.like_count <> coalesce(r.l, 0) OR p.dislike_count <> coalesce(r.d, 0)`,
  },
  {
    // Append-only ve kilit trigger'ları (vote_events, audit, revizyonlar, anket kilidi) kapalı bırakılmamalı;
    // ör. restore sırasında --disable-triggers ile kapatılıp unutulursa.
    name: "trigger'ların hepsi etkin",
    needs: [],
    sql: `SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE NOT t.tgisinternal AND n.nspname = 'public' AND t.tgenabled = 'D'`,
  },
];

export async function checkInvariants(db: Sql): Promise<Invariant[]> {
  const present = new Set(
    await strings(db, `SELECT c.relname AS v FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'`),
  );
  const out: Invariant[] = [];
  for (const inv of INVARIANTS) {
    if (!inv.needs.every((t) => present.has(t))) continue;
    const [r] = await db.$queryRawUnsafe<{ n: number }[]>(inv.sql);
    out.push({ name: inv.name, violations: r!.n });
  }
  return out;
}

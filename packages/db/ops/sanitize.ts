// #297 / #288 / #291 — yeni sağlayıcıya taşımadan önce restore edilmiş KOPYADAKİ kişisel veriyi arındırır.
//
//   SANITIZE_DATABASE_URL=postgresql://kararver:…@localhost:54330/kararver_restore_20261101 pnpm --filter @kararver/db db:sanitize [--apply]
//
// Akış (docs/KV-48_BACKUP_RESTORE.md "Arındırılmış taşıma"): canlı yedek → yerelde boş DB'ye restore → bu araç → doğrulama →
// arındırılmış kopyanın yedeği → hedef sağlayıcıya restore. Canlı DB'ye asla bağlanmaz:
// - Hedef yalnız yerel bir sunucu olabilir (localhost / 127.0.0.1 / ::1).
// - Veritabanı adı "restore" ya da "sanitize" içermeli veya "_test" ile bitmeli; DATABASE_URL ile aynı olamaz.
// - Varsayılan deneme (dry-run): her şey yapılır, doğrulanır ve geri alınır. Yalnız --apply kalıcı yazar.
//
// Ne yapar (tek transaction):
// 1. Gerçek görünümlü hesaplar: e-posta alan adı test/ayrılmış alan adı olmayan her hesap (RFC 2606/6761: example.*,
//    .test, .invalid, .example, .localhost, .local). E-posta, kullanıcı adı, görünen ad sentetik değerle değişir; bio ve avatar
//    boşalır; parola özeti geçersiz bir işaretle değişir (giriş yapılamaz, doğrulama hata değil false döner).
// 2. Herkes için geçici ve ağ izli kayıtlar silinir: oturumlar (IP, user-agent), MFA kayıtları ve kurtarma kodları (yeni
//    ortamın pepper'ı farklıdır, zaten çözülemez), tek kullanımlık token'lar, e-posta değişikliği talepleri,
//    idempotency anahtarları, hız sınırı sayaçları, veri dışa aktarma talepleri.
// 3. Serbest metin ve JSON alanlarında (audit before/after, olay yükleri, bildirimler, revizyonlar, yorum/anket metinleri)
//    gerçek hesapların e-postası, kullanıcı adı ve görünen adı sentetik kullanıcı adıyla değişir. JSON'da yalnız değerler
//    değişir, anahtarlar değişmez. Yapısal sütunlar (işlem adı, tür, durum, kimlik, özet, rota) değişmez.
//    Ekleme-yalnız tabloların tetikleyicileri yalnız bu kopyada ve yalnız bu transaction içinde kapatılıp geri açılır.
// 4. Doğrulama: kalan gerçek e-posta/kimlik izi, oturum ve MFA kaydı sıfır değilse işlem geri alınır, çıkış kodu 1.
//
// Rapor yalnız sayı içerir; hiçbir e-posta, kullanıcı adı veya kimlik yazdırılmaz.
import { parseArgs } from "node:util";
import { createPrismaClient, type PrismaClient } from "../src/index.ts";
import { databaseName, redact } from "./pg-tools.ts";
import { checkInvariants, type Invariant } from "./state.ts";

/** E-postası bu kalıba uyan hesap test hesabıdır (SQL regex, büyük/küçük harf duyarsız). */
export const TEST_EMAIL_PATTERN = String.raw`(@example\.(test|com|org|net)|\.(test|invalid|example|localhost|local))$`;

/** Herkes için silinen tablolar; sıra FK'ye göre (cascade: mfa_recovery_codes, session_mfa_stepups). */
export const PURGED_TABLES = [
  "user_mfa_credentials",
  "sessions",
  "auth_tokens",
  "email_change_requests",
  "idempotency_keys",
  "rate_limit_counters",
  "data_exports",
] as const;

/** Değeri dokunulmadan kalan yapısal sütunlar (ad kalıbı). */
export const STRUCTURAL_COLUMN = /^(id|.*_id|.*_ids|.*_hash|.*_key|key|action|operation|type|kind|status|state|source|subject_type|target_type|route|method|locale|format|content_type|mime_type|natural_key|object_key|storage_key|reason_code|role|visibility|results_visibility|password_hash)$/;

export type SanitizeReport = {
  target: string;
  applied: boolean;
  realUsers: number;
  purged: Record<string, number>;
  rewritten: Record<string, number>;
  remaining: { identifiers: number; sessions: number; mfa: number; realUsers: number };
  invariants: Invariant[];
  ok: boolean;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Hedefin canlı DB olmadığından emin olur; değilse anlaşılır bir hatayla durur. */
export function assertSafeTarget(target: string, live = process.env.DATABASE_URL): void {
  const url = new URL(target);
  if (!LOCAL_HOSTS.has(url.hostname)) throw new Error(`arındırma yalnız yerel sunucuda yapılır (hedef: ${url.hostname})`);
  const name = databaseName(target);
  if (!/(restore|sanitize)/.test(name) && !name.endsWith("_test")) {
    throw new Error(`hedef veritabanı adı "restore"/"sanitize" içermeli ya da "_test" ile bitmeli: ${name}`);
  }
  if (live && new URL(live).host === url.host && databaseName(live) === name) throw new Error("SANITIZE_DATABASE_URL, DATABASE_URL ile aynı olamaz");
}

class DryRun extends Error {}

/** Serbest metin ve JSON değerlerini temizleyen geçici fonksiyonlar (yalnız bu oturumda; pg_temp). */
const FUNCTIONS = [
  String.raw`CREATE FUNCTION pg_temp.kv_re(s text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT regexp_replace(s, '([.\\^$*+?()\[\]{}|-])', '\\\1', 'g') $$`,
  // E-posta her yerde, büyük/küçük harf duyarsız alt dize. Kullanıcı adı ve görünen ad (≥ 3 karakter) yapısal değerlerle
  // karışmasın diye harf DUYARLI: serbest metinde tam kelime, JSON değerinde yalnız değerin tamamı. (Ör. "admin" adlı bir
  // hesap, rol değeri "ADMIN"i ya da "admin.users.list" işlem adını değiştirmez.)
  String.raw`CREATE FUNCTION pg_temp.kv_scrub_text(t text, is_json boolean) RETURNS text LANGUAGE plpgsql STABLE AS $$
    DECLARE r record; out text := t;
    BEGIN
      IF t IS NULL THEN RETURN NULL; END IF;
      FOR r IN SELECT * FROM kv_real LOOP
        out := regexp_replace(out, pg_temp.kv_re(r.old_email), r.new_email, 'gi');
        IF is_json THEN
          IF out = r.old_user OR out = r.old_display THEN out := r.new_user; END IF;
        ELSE
          IF length(r.old_user) >= 3 THEN out := regexp_replace(out, '\m' || pg_temp.kv_re(r.old_user) || '\M', r.new_user, 'g'); END IF;
          IF length(r.old_display) >= 3 THEN out := regexp_replace(out, '\m' || pg_temp.kv_re(r.old_display) || '\M', r.new_user, 'g'); END IF;
        END IF;
      END LOOP;
      RETURN out;
    END $$`,
  String.raw`CREATE FUNCTION pg_temp.kv_scrub_json(j jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
    BEGIN
      IF j IS NULL THEN RETURN NULL; END IF;
      CASE jsonb_typeof(j)
        WHEN 'string' THEN RETURN to_jsonb(pg_temp.kv_scrub_text(j #>> '{}', true));
        WHEN 'object' THEN RETURN coalesce((SELECT jsonb_object_agg(k, pg_temp.kv_scrub_json(v)) FROM jsonb_each(j) AS e(k, v)), '{}'::jsonb);
        WHEN 'array' THEN RETURN coalesce((SELECT jsonb_agg(pg_temp.kv_scrub_json(v) ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY AS e(v, n)), '[]'::jsonb);
        ELSE RETURN j;
      END CASE;
    END $$`,
  // Kalan iz (mode): 'email' yalnız e-posta; 'text' + tam kelime ad; 'json' + tırnaklı tam değer ad ("admin").
  String.raw`CREATE FUNCTION pg_temp.kv_has_trace(t text, mode text) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM kv_real r WHERE t ~* pg_temp.kv_re(r.old_email)
      OR (mode = 'text' AND length(r.old_user) >= 3 AND t ~ ('\m' || pg_temp.kv_re(r.old_user) || '\M'))
      OR (mode = 'text' AND length(r.old_display) >= 3 AND t ~ ('\m' || pg_temp.kv_re(r.old_display) || '\M'))
      OR (mode = 'json' AND length(r.old_user) >= 3 AND strpos(t, to_jsonb(r.old_user)::text) > 0)
      OR (mode = 'json' AND length(r.old_display) >= 3 AND strpos(t, to_jsonb(r.old_display)::text) > 0)) $$`,
];

type Column = { table: string; column: string; json: boolean };

async function textColumns(tx: Pick<PrismaClient, "$queryRawUnsafe">): Promise<Column[]> {
  const rows = await tx.$queryRawUnsafe<{ table: string; column: string; data_type: string }[]>(
    `SELECT c.table_name AS "table", c.column_name AS "column", c.data_type
       FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND c.data_type IN ('text', 'character varying', 'jsonb')
        AND c.table_name NOT IN ('users', '_prisma_migrations')
      ORDER BY 1, 2`,
  );
  return rows.map((r) => ({ table: r.table, column: r.column, json: r.data_type === "jsonb" }));
}

const q = (s: string) => `"${s.replaceAll('"', '""')}"`;

export async function sanitize(target: string, { apply }: { apply: boolean }): Promise<SanitizeReport> {
  assertSafeTarget(target);
  const prisma = createPrismaClient(target);
  const report: SanitizeReport = {
    target: redact(target),
    applied: false,
    realUsers: 0,
    purged: {},
    rewritten: {},
    remaining: { identifiers: 0, sessions: 0, mfa: 0, realUsers: 0 },
    invariants: [],
    ok: false,
  };
  try {
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '10s'`);
          await tx.$executeRawUnsafe(
            `CREATE TEMP TABLE kv_real ON COMMIT DROP AS
               SELECT id, lower(email_normalized) AS old_email, username AS old_user, display_name AS old_display,
                      'user_' || substr(replace(id::text, '-', ''), 1, 20) AS new_user,
                      'user_' || substr(replace(id::text, '-', ''), 1, 20) || '@example.test' AS new_email
                 FROM users WHERE email_normalized !~* '${TEST_EMAIL_PATTERN}'`,
          );
          report.realUsers = Number((await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM kv_real`))[0]!.n);
          for (const sql of FUNCTIONS) await tx.$executeRawUnsafe(sql);

          // 2. Geçici ve ağ izli kayıtlar (herkes için).
          for (const table of PURGED_TABLES) report.purged[table] = await tx.$executeRawUnsafe(`DELETE FROM ${q(table)}`);

          // 3. Serbest metin ve JSON. Tabloların kullanıcı tetikleyicileri (ekleme-yalnız, revizyon, sayaç) kapatılır:
          //    yalnız metin değişir, sayaç ve geçmiş üretilmez. Önceden kapalı olan tetikleyici kapalı kalır.
          const columns = (await textColumns(tx)).filter((c) => !STRUCTURAL_COLUMN.test(c.column));
          const tables = [...new Set(columns.map((c) => c.table))];
          const enabled = await tx.$queryRawUnsafe<{ rel: string; name: string }[]>(
            `SELECT tgrelid::regclass::text AS rel, tgname AS name FROM pg_trigger
              WHERE NOT tgisinternal AND tgenabled <> 'D' AND tgrelid::regclass::text = ANY($1::text[])`,
            tables,
          );
          for (const t of enabled) await tx.$executeRawUnsafe(`ALTER TABLE ${q(t.rel)} DISABLE TRIGGER ${q(t.name)}`);
          if (report.realUsers > 0) {
            for (const c of columns) {
              const scrub = c.json ? `pg_temp.kv_scrub_json(${q(c.column)})` : `pg_temp.kv_scrub_text(${q(c.column)}, false)`;
              const n = await tx.$executeRawUnsafe(
                `UPDATE ${q(c.table)} SET ${q(c.column)} = ${scrub}
                  WHERE ${q(c.column)} IS NOT NULL AND pg_temp.kv_has_trace(${q(c.column)}::text, '${c.json ? "json" : "text"}')`,
              );
              if (n > 0) report.rewritten[`${c.table}.${c.column}`] = n;
            }
          }
          for (const t of enabled) await tx.$executeRawUnsafe(`ALTER TABLE ${q(t.rel)} ENABLE TRIGGER ${q(t.name)}`);

          // 1. Hesaplar en son değişir: yukarıdaki taramalar eski değerleri kv_real'den okur.
          await tx.$executeRawUnsafe(
            `UPDATE users u SET email = r.new_email, email_normalized = r.new_email, username = r.new_user,
                    username_normalized = r.new_user, display_name = 'Arındırılmış kullanıcı', bio = NULL,
                    avatar_media_id = NULL, password_hash = '!sanitized', updated_at = now()
               FROM kv_real r WHERE u.id = r.id`,
          );

          // 4. Doğrulama: her metin/JSON sütununda e-posta izi; arındırılan sütunlarda ad izi.
          let identifiers = 0;
          for (const c of await textColumns(tx)) {
            const mode = STRUCTURAL_COLUMN.test(c.column) ? "email" : c.json ? "json" : "text";
            const [{ n }] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
              `SELECT count(*) AS n FROM ${q(c.table)} WHERE ${q(c.column)} IS NOT NULL AND pg_temp.kv_has_trace(${q(c.column)}::text, '${mode}')`,
            );
            identifiers += Number(n);
          }
          const one = async (sql: string, ...args: unknown[]) => Number((await tx.$queryRawUnsafe<{ n: bigint }[]>(sql, ...args))[0]!.n);
          report.remaining = {
            identifiers,
            sessions: await one(`SELECT count(*) AS n FROM sessions`),
            mfa: await one(`SELECT (SELECT count(*) FROM user_mfa_credentials) + (SELECT count(*) FROM mfa_recovery_codes) AS n`),
            realUsers: await one(`SELECT count(*) AS n FROM users WHERE email_normalized !~* $1`, TEST_EMAIL_PATTERN),
          };
          const r = report.remaining;
          if (r.identifiers || r.sessions || r.mfa || r.realUsers) throw new Error(`arındırma doğrulanamadı: ${JSON.stringify(r)}`);
          if (!apply) throw new DryRun();
        },
        { timeout: 600_000, maxWait: 30_000 },
      );
      report.applied = true;
    } catch (err) {
      if (!(err instanceof DryRun)) throw err;
    }
    report.invariants = await checkInvariants(prisma);
    report.ok = report.invariants.every((i) => i.violations === 0);
    return report;
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } } });
  const target = process.env.SANITIZE_DATABASE_URL;
  if (!target) {
    console.error("SANITIZE_DATABASE_URL gerekli (yerel, restore edilmiş kopya)");
    process.exit(2);
  }
  try {
    const r = await sanitize(target, { apply: values.apply });
    console.log(`arındırma: ${r.target} · ${r.applied ? "UYGULANDI" : "DENEME (geri alındı; kalıcı yazmak için --apply)"}`);
    console.log(`  gerçek görünümlü hesap: ${r.realUsers}`);
    console.log(`  silinen: ${Object.entries(r.purged).map(([t, n]) => `${t}=${n}`).join(", ")}`);
    console.log(`  yeniden yazılan: ${Object.entries(r.rewritten).map(([c, n]) => `${c}=${n}`).join(", ") || "yok"}`);
    console.log(`  kalan: iz=${r.remaining.identifiers}, oturum=${r.remaining.sessions}, mfa=${r.remaining.mfa}, gerçek hesap=${r.remaining.realUsers}`);
    for (const i of r.invariants) console.log(`  ${i.violations === 0 ? "✔" : "✖"} ${i.name}${i.violations ? `: ${i.violations} ihlal` : ""}`);
    console.log(r.ok ? "SONUÇ: tutarlı" : "SONUÇ: tutarlılık ihlali");
    process.exitCode = r.ok ? 0 : 1;
  } catch (err) {
    console.error(`arındırma başarısız: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

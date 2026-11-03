// #297 / #288 / #291 — İZOLE, restore edilmiş bir KOPYADAKİ kişisel veriyi arındırır. Canlı staging'e (Neon) ya da
// production'a asla uygulanmaz: oradaki hesap ve oturumlar kalıcı etkilenir (Mehmet, #299, 2-3 Kasım).
//
//   SANITIZE_DATABASE_URL=postgresql://kararver:…@localhost:54330/kararver_restore_20261101 \
//     pnpm --filter @kararver/db db:sanitize [--apply] [--role-holders keep|demote]
//
// Akış (docs/KV-48_BACKUP_RESTORE.md "Arındırılmış kopya"): yedek → yerelde boş DB'ye restore → bu araç → doğrulama.
//
// Hedef güvenliği (fail-closed):
// - Bağlantı adresi yalnız localhost / 127.0.0.1 / ::1; sorgu parametresi kabul edilmez (ör. ?host=uzak-sunucu).
// - Bağlandıktan sonra sunucunun kendi adresi de denetlenir (inet_server_addr: unix soketi ya da loopback).
// - Veritabanı adı "restore" ya da "sanitize" içermeli veya "_test" ile bitmeli; DATABASE_URL ile aynı olamaz.
// - Varsayılan deneme (dry-run): her şey yapılır, doğrulanır ve geri alınır. Yalnız --apply kalıcı yazar.
//
// Ne yapar (tek transaction):
// 1. Gerçek görünümlü hesap: e-posta alan adı test/ayrılmış alan adı değil (example.*, .test, .invalid, .example,
//    .localhost, .local). E-posta, kullanıcı adı, görünen ad sentetik olur; bio/avatar boşalır; parola özeti geçersiz olur.
//    ROL SAHİPLERİ (MODERATOR/ADMIN/SUPER_ADMIN) için seçim (--role-holders):
//    - keep (varsayılan): kimlikleri ve parolaları KORUNUR, kopyada giriş yapabilirler; rapor sayısını verir. Böylece tek
//      SUPER_ADMIN kilitlenmez ve bootstrap gerekmez. Bu hesapların kişisel verisi kopyada bilerek kalır.
//    - demote: diğerleri gibi arındırılır VE rol satırları silinir; kopyada SUPER_ADMIN kalmaz, `admin:bootstrap` çalışır.
// 2. Herkes için silinenler: oturumlar (IP, user-agent), MFA kayıtları ve kurtarma kodları, tek kullanımlık token'lar,
//    e-posta değişikliği talepleri, idempotency anahtarları, hız sınırı sayaçları, veri dışa aktarma talepleri.
// 3. Serbest metin ve JSON DEĞERLERİ (anahtarlar değil):
//    - Test alan adında olmayan HER e-posta (hesabı olmayan üçüncü kişiler dahil) `redacted@example.test` olur.
//    - Arındırılan hesapların kullanıcı adı (harf duyarlı) ve görünen adı (Türkçe harfler dahil harf duyarsız; kullanıcı
//      adıyla aynıysa harf duyarlı) tam kelime olarak sentetik kullanıcı adıyla değişir. Kelime sınırı nokta, alt çizgi,
//      @ ve tireyi de içerir: "admin" adlı hesap `admin.users.list` işlem adını ya da "ADMIN" rol değerini değiştirmez.
//    - polls.slug: tire ile ayrılmış kullanıcı adı kısa sentetik değere (u + 8 hane) döner; diğer slug'lar yapısaldır.
//    - Ekleme-yalnız tetikleyiciler yalnız bu kopyada ve yalnız bu transaction içinde kapatılıp geri açılır.
// 4. Doğrulama, transaction İÇİNDE: kalan iz (bağımsız genel e-posta taraması dahil), oturum, MFA, arındırılmamış gerçek
//    hesap ve tutarlılık ihlali sıfır değilse işlem geri alınır, çıkış kodu 1.
// Medya nesneleri (avatar, dışa aktarma paketleri) depoda kalır; bu araç yalnız veritabanını işler.
// Rapor yalnız sayı içerir; hiçbir e-posta, kullanıcı adı veya kimlik yazdırılmaz.
import { parseArgs } from "node:util";
import { createPrismaClient, type PrismaClient } from "../src/index.ts";
import { databaseName, redact } from "./pg-tools.ts";
import { checkInvariants, type Invariant } from "./state.ts";

/** E-postası bu kalıba uyan hesap / adres test adresidir (SQL regex, büyük/küçük harf duyarsız). */
export const TEST_EMAIL_PATTERN = String.raw`(@example\.(test|com|org|net)|\.(test|invalid|example|localhost|local))$`;
/** Metindeki e-posta biçimi (genel tarama). */
export const EMAIL_PATTERN = String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`;

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

/** Değeri dokunulmadan kalan yapısal sütunlar (ad kalıbı). Burada yalnız e-posta izi aranır. */
export const STRUCTURAL_COLUMN = /^(id|.*_id|.*_ids|.*_hash|.*_key|key|action|operation|type|kind|status|state|source|subject_type|target_type|route|method|locale|format|content_type|mime_type|natural_key|object_key|storage_key|reason_code|role|visibility|results_visibility|password_hash|slug)$/;
/** Kullanıcı metninden türeyen ve arındırılan slug sütunları. */
export const SCRUBBED_SLUGS = new Set(["polls.slug"]);

export type RoleHolderPolicy = "keep" | "demote";

export type SanitizeReport = {
  target: string;
  applied: boolean;
  roleHolders: RoleHolderPolicy;
  realUsers: number;
  retainedRoleHolders: number;
  demotedRoles: number;
  purged: Record<string, number>;
  rewritten: Record<string, number>;
  before: { users: number; sessions: number; roles: Record<string, number>; auditRows: number };
  after: { users: number; sessions: number; roles: Record<string, number>; auditRows: number };
  remaining: { identifiers: number; foreignEmails: number; sessions: number; mfa: number; realUsers: number };
  invariants: Invariant[];
  ok: boolean;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Bağlanmadan önce: hedefin canlı DB olmadığından emin olur; değilse anlaşılır bir hatayla durur. */
export function assertSafeTarget(target: string, live = process.env.DATABASE_URL): void {
  const url = new URL(target);
  if (!LOCAL_HOSTS.has(url.hostname)) throw new Error(`arındırma yalnız yerel sunucuda yapılır (hedef: ${url.hostname})`);
  if (url.search || url.hash) throw new Error("hedef adreste sorgu parametresi kabul edilmez (ör. host=…; bağlantı başka sunucuya yönelebilir)");
  const name = databaseName(target);
  if (!/(restore|sanitize)/.test(name) && !name.endsWith("_test")) {
    throw new Error(`hedef veritabanı adı "restore"/"sanitize" içermeli ya da "_test" ile bitmeli: ${name}`);
  }
  if (live && new URL(live).host === url.host && databaseName(live) === name) throw new Error("SANITIZE_DATABASE_URL, DATABASE_URL ile aynı olamaz");
}

/** Bağlandıktan sonra: sunucu gerçekten yerel mi (unix soketi ya da loopback)? */
async function assertLocalServer(db: Pick<PrismaClient, "$queryRawUnsafe">): Promise<void> {
  const [row] = await db.$queryRawUnsafe<{ addr: string | null }[]>(`SELECT host(inet_server_addr()) AS addr`);
  if (row && row.addr !== null && row.addr !== "127.0.0.1" && row.addr !== "::1") {
    throw new Error("bağlanılan sunucu yerel değil (inet_server_addr loopback değil); arındırma yapılmadı");
  }
}

const TR_PAIRS: Record<string, string> = { i: "iİ", ı: "ıI", ç: "çÇ", ş: "şŞ", ğ: "ğĞ", ö: "öÖ", ü: "üÜ" };
/**
 * Harf duyarsız eşleşme için karakter sınıfları (veritabanı yerelinden bağımsız; C yerelinde Türkçe harfler de katlanır).
 * "Çağla" → [çÇ][aA][ğĞ][lL][aA]. "I"/"i" Türkçe ve İngilizce iki biçimiyle eşleşir.
 */
export function caseInsensitivePattern(value: string): string {
  let out = "";
  for (const ch of value) {
    const lower = ch.toLocaleLowerCase("tr");
    const forms = new Set([ch, lower, ch.toLocaleUpperCase("tr"), ch.toLowerCase(), ch.toUpperCase(), ...(TR_PAIRS[lower] ?? "")]);
    if (lower === "i" || lower === "ı") for (const f of "iIİı") forms.add(f);
    const escaped = [...forms].map((f) => (/[\\\]^-]/.test(f) ? `\\${f}` : f)).join("");
    out += /[\p{L}\p{N}]/u.test(ch) ? `[${escaped}]` : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

class DryRun extends Error {}

/**
 * Serbest metin ve JSON değerlerini temizleyen geçici fonksiyonlar (yalnız bu oturumda; pg_temp). Kelime sınırı:
 * öncesi/sonrası harf, rakam, alt çizgi, nokta, @ ya da tire olmayan konum.
 */
const B = String.raw`[^[:alnum:]_.@-]`;
const FUNCTIONS = [
  String.raw`CREATE FUNCTION pg_temp.kv_re(s text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT regexp_replace(s, '([.\\^$*+?()\[\]{}|-])', '\\\1', 'g') $$`,
  // Test alanı dışındaki her e-postayı değiştirir (hesabı olmayan üçüncü kişiler dahil).
  String.raw`CREATE FUNCTION pg_temp.kv_scrub_emails(t text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
    DECLARE m text; out text := t;
    BEGIN
      IF t IS NULL THEN RETURN NULL; END IF;
      FOR m IN SELECT x[1] FROM regexp_matches(t, '(${EMAIL_PATTERN})', 'g') AS x LOOP
        IF m !~* '${TEST_EMAIL_PATTERN}' THEN out := replace(out, m, 'redacted@example.test'); END IF;
      END LOOP;
      RETURN out;
    END $$`,
  String.raw`CREATE FUNCTION pg_temp.kv_has_foreign_email(t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT EXISTS (SELECT 1 FROM regexp_matches(t, '(${EMAIL_PATTERN})', 'g') AS x WHERE x[1] !~* '${TEST_EMAIL_PATTERN}') $$`,
  // Ad ve kullanıcı adı: tam kelime (özel sınır); kullanıcı adı harf duyarlı, görünen ad karakter sınıflarıyla duyarsız.
  String.raw`CREATE FUNCTION pg_temp.kv_scrub_names(t text) RETURNS text LANGUAGE plpgsql STABLE AS $$
    DECLARE r record; out text := t;
    BEGIN
      IF t IS NULL THEN RETURN NULL; END IF;
      FOR r IN SELECT * FROM kv_real LOOP
        out := regexp_replace(out, pg_temp.kv_re(r.old_email), r.new_email, 'gi');
        IF r.user_re IS NOT NULL THEN out := regexp_replace(out, '(^|${B})' || r.user_re || '(?=$|${B})', '\1' || r.new_user, 'g'); END IF;
        IF r.display_re IS NOT NULL THEN out := regexp_replace(out, '(^|${B})' || r.display_re || '(?=$|${B})', '\1' || r.new_user, 'g'); END IF;
      END LOOP;
      RETURN out;
    END $$`,
  String.raw`CREATE FUNCTION pg_temp.kv_scrub_text(t text) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT pg_temp.kv_scrub_emails(pg_temp.kv_scrub_names(t)) $$`,
  String.raw`CREATE FUNCTION pg_temp.kv_scrub_json(j jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
    BEGIN
      IF j IS NULL THEN RETURN NULL; END IF;
      CASE jsonb_typeof(j)
        WHEN 'string' THEN RETURN to_jsonb(pg_temp.kv_scrub_text(j #>> '{}'));
        WHEN 'object' THEN RETURN coalesce((SELECT jsonb_object_agg(k, pg_temp.kv_scrub_json(v)) FROM jsonb_each(j) AS e(k, v)), '{}'::jsonb);
        WHEN 'array' THEN RETURN coalesce((SELECT jsonb_agg(pg_temp.kv_scrub_json(v) ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY AS e(v, n)), '[]'::jsonb);
        ELSE RETURN j;
      END CASE;
    END $$`,
  // JSON'un yalnız metin DEĞERLERİ (anahtarlar hariç), tek metin olarak.
  String.raw`CREATE FUNCTION pg_temp.kv_json_strings(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT coalesce(string_agg(v #>> '{}', ' | '), '') FROM jsonb_path_query(j, 'strict $.**') AS v WHERE jsonb_typeof(v) = 'string' $$`,
  String.raw`CREATE FUNCTION pg_temp.kv_scrub_slug(t text) RETURNS text LANGUAGE plpgsql STABLE AS $$
    DECLARE r record; out text := t;
    BEGIN
      IF t IS NULL THEN RETURN NULL; END IF;
      FOR r IN SELECT * FROM kv_real WHERE slug_re IS NOT NULL LOOP
        out := regexp_replace(out, '(^|-)' || r.slug_re || '(?=-|$)', '\1' || r.short, 'g');
      END LOOP;
      RETURN out;
    END $$`,
  // Kalan iz (mode): 'email' yalnız e-posta (gerçek hesap + genel); 'text' + ad; 'slug' + slug kuralı.
  String.raw`CREATE FUNCTION pg_temp.kv_has_trace(t text, mode text) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT pg_temp.kv_has_foreign_email(t) OR EXISTS (SELECT 1 FROM kv_real r WHERE t ~* pg_temp.kv_re(r.old_email)
      OR (mode = 'text' AND r.user_re IS NOT NULL AND t ~ ('(^|${B})' || r.user_re || '(?=$|${B})'))
      OR (mode = 'text' AND r.display_re IS NOT NULL AND t ~ ('(^|${B})' || r.display_re || '(?=$|${B})'))
      OR (mode = 'slug' AND r.slug_re IS NOT NULL AND t ~ ('(^|-)' || r.slug_re || '(?=-|$)'))) $$`,
];

type Column = { table: string; column: string; json: boolean; maxLength: number | null };

async function textColumns(tx: Pick<PrismaClient, "$queryRawUnsafe">): Promise<Column[]> {
  const rows = await tx.$queryRawUnsafe<{ table: string; column: string; data_type: string; max: number | null }[]>(
    `SELECT c.table_name AS "table", c.column_name AS "column", c.data_type, c.character_maximum_length AS max
       FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND c.data_type IN ('text', 'character varying', 'jsonb')
        AND c.table_name NOT IN ('users', '_prisma_migrations')
      ORDER BY 1, 2`,
  );
  return rows.map((r) => ({ table: r.table, column: r.column, json: r.data_type === "jsonb", maxLength: r.max === null ? null : Number(r.max) }));
}

/** Sütunun arındırma kipi: yapısal (yalnız e-posta izi), slug (arındırılan slug), metin/JSON. */
function modeOf(c: Column): "email" | "slug" | "text" {
  const qualified = `${c.table}.${c.column}`;
  if (SCRUBBED_SLUGS.has(qualified)) return "slug";
  return STRUCTURAL_COLUMN.test(c.column) ? "email" : "text";
}

const q = (s: string) => `"${s.replaceAll('"', '""')}"`;

export async function sanitize(target: string, { apply, roleHolders = "keep" }: { apply: boolean; roleHolders?: RoleHolderPolicy }): Promise<SanitizeReport> {
  assertSafeTarget(target);
  const prisma = createPrismaClient(target);
  const empty = { users: 0, sessions: 0, roles: {}, auditRows: 0 };
  const report: SanitizeReport = {
    target: redact(target),
    applied: false,
    roleHolders,
    realUsers: 0,
    retainedRoleHolders: 0,
    demotedRoles: 0,
    purged: {},
    rewritten: {},
    before: { ...empty },
    after: { ...empty },
    remaining: { identifiers: 0, foreignEmails: 0, sessions: 0, mfa: 0, realUsers: 0 },
    invariants: [],
    ok: false,
  };
  try {
    await assertLocalServer(prisma);
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '10s'`);
          const one = async (sql: string, ...args: unknown[]) => Number((await tx.$queryRawUnsafe<{ n: bigint }[]>(sql, ...args))[0]!.n);
          const summary = async () => ({
            users: await one(`SELECT count(*) AS n FROM users`),
            sessions: await one(`SELECT count(*) AS n FROM sessions`),
            roles: Object.fromEntries(
              (await tx.$queryRawUnsafe<{ role: string; n: bigint }[]>(`SELECT role::text AS role, count(*) AS n FROM user_roles GROUP BY 1 ORDER BY 1`)).map((r) => [r.role, Number(r.n)]),
            ),
            auditRows: await one(`SELECT count(*) AS n FROM audit_logs`),
          });
          report.before = await summary();

          // 1. Arındırılacak gerçek hesaplar (rol sahipleri politikaya göre) ve eşleşme kalıpları.
          const candidates = await tx.$queryRawUnsafe<{ id: string; email: string; username: string; display: string; has_role: boolean }[]>(
            `SELECT u.id::text, lower(u.email_normalized) AS email, u.username, u.display_name AS display,
                    EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id) AS has_role
               FROM users u WHERE u.email_normalized !~* $1`,
            TEST_EMAIL_PATTERN,
          );
          const kept = roleHolders === "keep" ? candidates.filter((c) => c.has_role) : [];
          const sanitized = candidates.filter((c) => !kept.includes(c));
          report.realUsers = candidates.length;
          report.retainedRoleHolders = kept.length;
          await tx.$executeRawUnsafe(
            `CREATE TEMP TABLE kv_real (id uuid, old_email text, new_user text, new_email text, short text, user_re text, display_re text, slug_re text) ON COMMIT DROP`,
          );
          for (const c of sanitized) {
            const hex = c.id.replaceAll("-", "");
            const sameAsUser = c.display.toLocaleLowerCase("tr") === c.username.toLocaleLowerCase("tr");
            await tx.$executeRawUnsafe(
              `INSERT INTO kv_real VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)`,
              c.id,
              c.email,
              `user_${hex.slice(0, 20)}`,
              `user_${hex.slice(0, 20)}@example.test`,
              `u${hex.slice(0, 8)}`,
              c.username.length >= 3 ? escapeRe(c.username) : null,
              c.display.length >= 3 ? (sameAsUser ? escapeRe(c.display) : caseInsensitivePattern(c.display)) : null,
              c.username.length >= 3 ? escapeRe(c.username.toLowerCase()) : null,
            );
          }
          for (const sql of FUNCTIONS) await tx.$executeRawUnsafe(sql);

          // 2. Geçici ve ağ izli kayıtlar (herkes için).
          for (const table of PURGED_TABLES) report.purged[table] = await tx.$executeRawUnsafe(`DELETE FROM ${q(table)}`);

          // 3. Serbest metin, JSON değerleri ve arındırılan slug'lar. Tetikleyiciler (ekleme-yalnız, revizyon, sayaç)
          //    yalnız bu transaction içinde kapatılır; önceden kapalı olan kapalı kalır.
          const columns = (await textColumns(tx)).filter((c) => modeOf(c) !== "email");
          const tables = [...new Set(columns.map((c) => c.table))];
          const enabled = await tx.$queryRawUnsafe<{ rel: string; name: string }[]>(
            `SELECT tgrelid::regclass::text AS rel, tgname AS name FROM pg_trigger
              WHERE NOT tgisinternal AND tgenabled <> 'D' AND tgrelid::regclass::text = ANY($1::text[])`,
            tables,
          );
          for (const t of enabled) await tx.$executeRawUnsafe(`ALTER TABLE ${q(t.rel)} DISABLE TRIGGER ${q(t.name)}`);
          for (const c of columns) {
            const mode = modeOf(c);
            const scrub = mode === "slug" ? `pg_temp.kv_scrub_slug(${q(c.column)})` : c.json ? `pg_temp.kv_scrub_json(${q(c.column)})` : `pg_temp.kv_scrub_text(${q(c.column)})`;
            const probe = c.json ? `pg_temp.kv_json_strings(${q(c.column)})` : `${q(c.column)}::text`;
            const n = await tx.$executeRawUnsafe(
              `UPDATE ${q(c.table)} SET ${q(c.column)} = ${scrub}
                WHERE ${q(c.column)} IS NOT NULL AND pg_temp.kv_has_trace(${probe}, '${mode}')`,
            );
            if (n > 0) report.rewritten[`${c.table}.${c.column}`] = n;
          }
          for (const t of enabled) await tx.$executeRawUnsafe(`ALTER TABLE ${q(t.rel)} ENABLE TRIGGER ${q(t.name)}`);

          // 1b. Hesaplar en son değişir (taramalar eski değerleri kv_real'den okur); demote'ta rol satırları silinir.
          await tx.$executeRawUnsafe(
            `UPDATE users u SET email = r.new_email, email_normalized = r.new_email, username = r.new_user,
                    username_normalized = r.new_user, display_name = 'Arındırılmış kullanıcı', bio = NULL,
                    avatar_media_id = NULL, password_hash = '!sanitized', updated_at = now()
               FROM kv_real r WHERE u.id = r.id`,
          );
          if (roleHolders === "demote") report.demotedRoles = await tx.$executeRawUnsafe(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM kv_real)`);

          // 4. Doğrulama (bağımsız genel e-posta taraması dahil) ve tutarlılık, commit'ten ÖNCE.
          let identifiers = 0;
          let foreignEmails = 0;
          for (const c of await textColumns(tx)) {
            const probe = c.json ? `pg_temp.kv_json_strings(${q(c.column)})` : `${q(c.column)}::text`;
            identifiers += await one(`SELECT count(*) AS n FROM ${q(c.table)} WHERE ${q(c.column)} IS NOT NULL AND pg_temp.kv_has_trace(${probe}, '${modeOf(c)}')`);
            foreignEmails += await one(`SELECT count(*) AS n FROM ${q(c.table)} WHERE ${q(c.column)} IS NOT NULL AND pg_temp.kv_has_foreign_email(${q(c.column)}::text)`);
          }
          report.remaining = {
            identifiers,
            foreignEmails,
            sessions: await one(`SELECT count(*) AS n FROM sessions`),
            mfa: await one(`SELECT (SELECT count(*) FROM user_mfa_credentials) + (SELECT count(*) FROM mfa_recovery_codes) AS n`),
            realUsers: (await one(`SELECT count(*) AS n FROM users WHERE email_normalized !~* $1`, TEST_EMAIL_PATTERN)) - kept.length,
          };
          report.after = await summary();
          report.invariants = await checkInvariants(tx);
          const r = report.remaining;
          const broken = report.invariants.filter((i) => i.violations > 0);
          if (r.identifiers || r.foreignEmails || r.sessions || r.mfa || r.realUsers || broken.length) {
            throw new Error(`arındırma doğrulanamadı: ${JSON.stringify({ ...r, invariants: broken.map((i) => i.name) })}`);
          }
          if (!apply) throw new DryRun();
        },
        { timeout: 600_000, maxWait: 30_000 },
      );
      report.applied = true;
    } catch (err) {
      if (!(err instanceof DryRun)) throw err;
    }
    report.ok = report.invariants.every((i) => i.violations === 0);
    return report;
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { apply: { type: "boolean", default: false }, "role-holders": { type: "string", default: "keep" } } });
  const target = process.env.SANITIZE_DATABASE_URL;
  const policy = values["role-holders"];
  if (!target || (policy !== "keep" && policy !== "demote")) {
    console.error("SANITIZE_DATABASE_URL gerekli (yerel, izole kopya); --role-holders keep|demote");
    process.exit(2);
  }
  try {
    const r = await sanitize(target, { apply: values.apply, roleHolders: policy });
    console.log(`arındırma: ${r.target} · ${r.applied ? "UYGULANDI" : "DENEME (geri alındı; kalıcı yazmak için --apply)"} · rol sahipleri: ${r.roleHolders}`);
    console.log(`  gerçek görünümlü hesap: ${r.realUsers} (korunan rol sahibi: ${r.retainedRoleHolders}, silinen rol satırı: ${r.demotedRoles})`);
    console.log(`  silinen: ${Object.entries(r.purged).map(([t, n]) => `${t}=${n}`).join(", ")}`);
    console.log(`  yeniden yazılan: ${Object.entries(r.rewritten).map(([c, n]) => `${c}=${n}`).join(", ") || "yok"}`);
    console.log(`  önce: kullanıcı=${r.before.users}, oturum=${r.before.sessions}, rol=${JSON.stringify(r.before.roles)}, audit=${r.before.auditRows}`);
    console.log(`  sonra: kullanıcı=${r.after.users}, oturum=${r.after.sessions}, rol=${JSON.stringify(r.after.roles)}, audit=${r.after.auditRows}`);
    console.log(`  kalan: iz=${r.remaining.identifiers}, yabancı e-posta=${r.remaining.foreignEmails}, oturum=${r.remaining.sessions}, mfa=${r.remaining.mfa}, arındırılmamış gerçek hesap=${r.remaining.realUsers}`);
    for (const i of r.invariants) console.log(`  ${i.violations === 0 ? "✔" : "✖"} ${i.name}${i.violations ? `: ${i.violations} ihlal` : ""}`);
    console.log(r.ok ? "SONUÇ: tutarlı" : "SONUÇ: tutarlılık ihlali");
    process.exitCode = r.ok ? 0 : 1;
  } catch (err) {
    console.error(`arındırma başarısız: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

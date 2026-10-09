// SearchStore'un PostgreSQL uygulaması. Eşleşme: kv_normalize(sütun) LIKE '%' || kv_normalize(q) || '%'.
// Index'ler: migration 20260928220000_faruk_kv26_categories_search (pg_trgm GIN, ifade index'i).
// Sorgu planları: docs/KV-26_CATEGORIES_SEARCH.md.
import { Prisma, type PrismaClient } from "@kararver/db";
import type { SearchHit, SearchStore, SearchType } from "./store.ts";

/** LIKE joker karakterleri (%, _) ve kaçış karakteri kullanıcı girdisinde düz metin sayılır. */
export function likeLiteral(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Zaman cursor'ı ISO-8601 (Z) metni olarak gider ve açıkça timestamptz'ye çevrilir; Date parametresi
// saat dilimsiz timestamp olarak bağlanırsa oturum saat dilimi (TimeZone) karşılaştırmayı kaydırır.
type Row = { id: string; k1: string | number; k2: string | number | null };

export function createPrismaSearchStore(prisma: PrismaClient): SearchStore {
  const pattern = (q: string) => Prisma.sql`'%' || kv_normalize(${likeLiteral(q)}) || '%'`;

  const queries: Record<SearchType, (q: string, after: { keys: (string | number)[]; id: string } | null, limit: number) => Prisma.Sql> = {
    // Başlık eşleşmesi (rank 0) açıklama eşleşmesinden (rank 1) önce; sonra yeniden eskiye.
    polls: (q, after, limit) => {
      const like = pattern(q);
      const rank = Prisma.sql`(CASE WHEN kv_normalize(p.title) LIKE ${like} ESCAPE '\\' THEN 0 ELSE 1 END)`;
      const cursor = after
        ? Prisma.sql`AND (${rank} > ${Number(after.keys[0])}
            OR (${rank} = ${Number(after.keys[0])} AND (p.opens_at < ${String(after.keys[1])}::timestamptz
              OR (p.opens_at = ${String(after.keys[1])}::timestamptz AND p.id < ${after.id}::uuid))))`
        : Prisma.empty;
      return Prisma.sql`
        SELECT p.id::text AS id, ${rank} AS k1, to_char(p.opens_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS k2
        FROM polls p
        WHERE p.status IN ('ACTIVE', 'LOCKED')
          AND (kv_normalize(p.title) LIKE ${like} ESCAPE '\\' OR kv_normalize(coalesce(p.description, '')) LIKE ${like} ESCAPE '\\')
          ${cursor}
        ORDER BY k1 ASC, p.opens_at DESC, p.id DESC
        LIMIT ${limit}`;
    },
    // Kullanıcı adı başlangıç eşleşmesi önce; sonra kullanıcı adına göre. Silinmiş/banlı/askıdaki hesap görünmez.
    users: (q, after, limit) => {
      const like = pattern(q);
      const prefix = Prisma.sql`kv_normalize(${likeLiteral(q)}) || '%'`;
      const rank = Prisma.sql`(CASE WHEN kv_normalize(u.username) LIKE ${prefix} ESCAPE '\\' THEN 0 ELSE 1 END)`;
      const cursor = after
        ? Prisma.sql`AND (${rank} > ${Number(after.keys[0])}
            OR (${rank} = ${Number(after.keys[0])} AND (u.username_normalized > ${String(after.keys[1])}
              OR (u.username_normalized = ${String(after.keys[1])} AND u.id > ${after.id}::uuid))))`
        : Prisma.empty;
      return Prisma.sql`
        SELECT u.id::text AS id, ${rank} AS k1, u.username_normalized AS k2
        FROM users u
        WHERE u.deleted_at IS NULL AND u.status IN ('ACTIVE', 'RESTRICTED')
          AND (kv_normalize(u.username) LIKE ${like} ESCAPE '\\' OR kv_normalize(u.display_name) LIKE ${like} ESCAPE '\\')
          ${cursor}
        ORDER BY k1 ASC, u.username_normalized ASC, u.id ASC
        LIMIT ${limit}`;
    },
    categories: (q, after, limit) => {
      const like = pattern(q);
      const cursor = after
        ? Prisma.sql`AND (c.sort_order > ${Number(after.keys[0])} OR (c.sort_order = ${Number(after.keys[0])} AND c.id > ${after.id}::uuid))`
        : Prisma.empty;
      return Prisma.sql`
        SELECT c.id::text AS id, c.sort_order AS k1, NULL AS k2
        FROM categories c
        WHERE c.is_active AND (kv_normalize(c.name) LIKE ${like} ESCAPE '\\' OR kv_normalize(c.slug) LIKE ${like} ESCAPE '\\')
          ${cursor}
        ORDER BY c.sort_order ASC, c.id ASC
        LIMIT ${limit}`;
    },
    communities: (q, after, limit) => {
      const like = pattern(q);
      const cursor = after
        ? Prisma.sql`AND (m.member_count < ${Number(after.keys[0])} OR (m.member_count = ${Number(after.keys[0])} AND m.id < ${after.id}::uuid))`
        : Prisma.empty;
      return Prisma.sql`
        SELECT m.id::text AS id, m.member_count AS k1, NULL AS k2
        FROM communities m
        WHERE m.status = 'ACTIVE'
          AND (kv_normalize(m.name) LIKE ${like} ESCAPE '\\' OR kv_normalize(m.slug) LIKE ${like} ESCAPE '\\')
          ${cursor}
        ORDER BY m.member_count DESC, m.id DESC
        LIMIT ${limit}`;
    },
  };

  const categorySelect = { id: true, slug: true, name: true, description: true, iconKey: true, sortOrder: true } as const;

  return {
    listActiveCategories: () =>
      prisma.category.findMany({ where: { isActive: true }, select: categorySelect, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),

    async search(type, q, page): Promise<SearchHit[]> {
      const rows = await prisma.$queryRaw<Row[]>(queries[type](q, page.after, page.limit));
      return rows.map((r) => ({ id: r.id, keys: r.k2 === null ? [Number(r.k1)] : [Number(r.k1), r.k2] }));
    },

    async usersByIds(ids) {
      const users = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, username: true, displayName: true, avatarMedia: { select: { status: true, publicObjectKey: true } } },
      });
      const byId = new Map(
        users.map((u) => [
          u.id,
          {
            id: u.id,
            username: u.username,
            displayName: u.displayName,
            avatarPublicKey: u.avatarMedia?.status === "APPROVED" ? u.avatarMedia.publicObjectKey : null,
          },
        ]),
      );
      return ids.flatMap((id) => byId.get(id) ?? []);
    },

    async categoriesByIds(ids) {
      const rows = await prisma.category.findMany({ where: { id: { in: ids } }, select: categorySelect });
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids.flatMap((id) => byId.get(id) ?? []);
    },

    async communitiesByIds(ids) {
      const rows = await prisma.community.findMany({ where: { id: { in: ids } }, select: { id: true, slug: true, name: true } });
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids.flatMap((id) => byId.get(id) ?? []);
    },
  };
}

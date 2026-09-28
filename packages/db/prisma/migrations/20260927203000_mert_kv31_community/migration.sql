-- ═══════════════════════════════════════════════════════════════════════
-- KV-31 · Sahip: Mert · communities iskeletini tamamlar + community_memberships
-- 1. BÖLÜM: prisma migrate diff çıktısı (elle değiştirilmedi)
-- 2. BÖLÜM: Prisma schema'da ifade edilemeyen kısımlar (elle, en altta)
-- Açıklamalar: docs/DATA_MODEL.md §9
--
-- NOT NULL kolonlar varsayılansız eklenir: communities'e yazan bir uygulama
-- henüz yok, tablo her ortamda boştur. Doluysa bu migration bilerek başarısız olur.
-- ═══════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "community_role" AS ENUM ('MEMBER', 'MODERATOR');

-- CreateEnum
CREATE TYPE "community_members_visibility" AS ENUM ('PUBLIC', 'MEMBERS', 'MODERATORS');

-- AlterTable
ALTER TABLE "communities" ADD COLUMN     "created_by_id" UUID NOT NULL,
ADD COLUMN     "description" VARCHAR(1000),
ADD COLUMN     "image_media_id" UUID,
ADD COLUMN     "member_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "members_visibility" "community_members_visibility" NOT NULL DEFAULT 'MEMBERS',
ADD COLUMN     "name" VARCHAR(80) NOT NULL,
ADD COLUMN     "slug" VARCHAR(60) NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL;

-- CreateTable
CREATE TABLE "community_memberships" (
    "community_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "community_role" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "community_memberships_pkey" PRIMARY KEY ("community_id","user_id")
);

-- CreateIndex
CREATE INDEX "community_memberships_user_id_created_at_idx" ON "community_memberships"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "community_memberships_community_id_role_idx" ON "community_memberships"("community_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "communities_slug_key" ON "communities"("slug");

-- CreateIndex
CREATE INDEX "communities_status_member_count_idx" ON "communities"("status", "member_count" DESC);

-- AddForeignKey
ALTER TABLE "communities" ADD CONSTRAINT "communities_image_media_id_fkey" FOREIGN KEY ("image_media_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communities" ADD CONSTRAINT "communities_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_memberships_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ═══════════════════════════════════════════════════════════════════════
-- 2. BÖLÜM — ELLE EKLENENLER
-- Prisma bunları yönetmez ve sonraki migration'larda silmeye çalışmaz.
-- Bu dosya merge edildikten sonra değiştirilmez.
-- ═══════════════════════════════════════════════════════════════════════

-- URL'de kullanılan slug: küçük harf ASCII, rakam ve tek tire (ör. samsun-universitesi).
ALTER TABLE "communities"
  ADD CONSTRAINT "communities_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "communities_name_check" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "communities_member_count_check" CHECK ("member_count" >= 0);

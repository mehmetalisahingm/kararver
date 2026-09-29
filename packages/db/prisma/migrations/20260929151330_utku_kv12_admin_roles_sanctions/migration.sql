-- ═══════════════════════════════════════════════════════════════════════
-- KV-12 (#14) · Sahip: Utku · user_roles + sanctions
-- 1. BÖLÜM: prisma migrate dev --create-only çıktısı (elle değiştirilmedi)
-- 2. BÖLÜM: Prisma schema'da ifade edilemeyen kısımlar (elle, en altta)
-- Açıklamalar: docs/DATA_MODEL.md §9 · Yetki: packages/contracts/src/permissions.ts
-- ═══════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "sanction_type" AS ENUM ('WARNING', 'RESTRICT_COMMENTS', 'RESTRICT_POSTING', 'SUSPEND', 'BAN');

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role" "user_role" NOT NULL,
    "granted_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "sanctions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "sanction_type" NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "lifted_at" TIMESTAMPTZ(3),
    "lifted_by_id" UUID,
    "lift_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sanctions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_roles_role_idx" ON "user_roles"("role");

-- CreateIndex
CREATE INDEX "user_roles_granted_by_id_idx" ON "user_roles"("granted_by_id");

-- CreateIndex
CREATE INDEX "sanctions_user_id_lifted_at_ends_at_idx" ON "sanctions"("user_id", "lifted_at", "ends_at");

-- CreateIndex
CREATE INDEX "sanctions_created_by_id_idx" ON "sanctions"("created_by_id");

-- CreateIndex
CREATE INDEX "sanctions_lifted_by_id_idx" ON "sanctions"("lifted_by_id");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_lifted_by_id_fkey" FOREIGN KEY ("lifted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════
-- 2. BÖLÜM — ELLE EKLENENLER
-- Prisma bunları yönetmez ve sonraki migration'larda silmeye çalışmaz.
-- Bu dosya merge edildikten sonra değiştirilmez.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── user_roles ───
ALTER TABLE "user_roles"
  -- Satır yoksa USER (TrustedActor.roles boş); USER satırı yazılmaz.
  ADD CONSTRAINT "user_roles_not_user_check"
    CHECK ("role" <> 'USER'),
  -- Kimse kendi rolünü atayamaz (KV-04 §1.2/10).
  ADD CONSTRAINT "user_roles_not_self_check"
    CHECK ("granted_by_id" IS NULL OR "granted_by_id" <> "user_id"),
  -- Veren olmadan yazılabilen tek satır ilk SUPER_ADMIN'dir (bootstrap, DATA_MODEL §11.4 açık konu 6).
  ADD CONSTRAINT "user_roles_bootstrap_check"
    CHECK ("granted_by_id" IS NOT NULL OR "role" = 'SUPER_ADMIN');

-- ─── sanctions ───
ALTER TABLE "sanctions"
  ADD CONSTRAINT "sanctions_period_check"
    CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at"),
  -- SUSPEND süreli (contracts admin.sanctions.create refine'ı), BAN kalıcı (DATA_MODEL §7.2).
  ADD CONSTRAINT "sanctions_suspend_ends_check"
    CHECK ("type" <> 'SUSPEND' OR "ends_at" IS NOT NULL),
  ADD CONSTRAINT "sanctions_ban_permanent_check"
    CHECK ("type" <> 'BAN' OR "ends_at" IS NULL),
  -- Kimse kendine yaptırım uygulayamaz ve kendi yaptırımını kaldıramaz (KV-04 §4.1).
  ADD CONSTRAINT "sanctions_not_self_check"
    CHECK ("created_by_id" <> "user_id"),
  ADD CONSTRAINT "sanctions_lift_not_self_check"
    CHECK ("lifted_by_id" IS NULL OR "lifted_by_id" <> "user_id"),
  -- Gerekçe sözleşmedeki Reason gibi en az 3 anlamlı karakter.
  ADD CONSTRAINT "sanctions_reason_check"
    CHECK (length(btrim("reason")) >= 3),
  -- Kaldırma bilgisi üçü birlikte dolar veya birlikte boş kalır.
  ADD CONSTRAINT "sanctions_lift_check"
    CHECK (
      ("lifted_at" IS NULL AND "lifted_by_id" IS NULL AND "lift_reason" IS NULL)
      OR ("lifted_at" IS NOT NULL AND "lifted_by_id" IS NOT NULL AND "lift_reason" IS NOT NULL
          AND length(btrim("lift_reason")) >= 3 AND "lifted_at" >= "created_at")
    );

-- ─── Yaptırım geçmişi değişmez ───
-- Silinemez. Güncellemede tek izinli geçiş: kaldırılmamış satırda lifted_at/lifted_by_id/lift_reason
-- NULL'dan doluya (bir kez). Diğer alan değişiklikleri ve ikinci kaldırma reddedilir.
CREATE FUNCTION kv_sanctions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'KV_SANCTIONS_IMMUTABLE: yaptırım silinemez (sanction %)', OLD."id"
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD."lifted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'KV_SANCTIONS_IMMUTABLE: kaldırılmış yaptırım değiştirilemez (sanction %)', OLD."id"
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW."lifted_at" IS NULL
     OR NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."starts_at" IS DISTINCT FROM OLD."starts_at"
     OR NEW."ends_at" IS DISTINCT FROM OLD."ends_at"
     OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'KV_SANCTIONS_IMMUTABLE: yaptırımda sadece kaldırma bilgisi bir kez yazılabilir (sanction %)', OLD."id"
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "sanctions_guard"
  BEFORE UPDATE OR DELETE ON "sanctions"
  FOR EACH ROW EXECUTE FUNCTION kv_sanctions_guard();

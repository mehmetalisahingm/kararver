-- #184 / KV-54 S1: topluluk sahibi. Sahip, topluluk başına en çok bir kullanıcıdır (boş olabilir: V1'deki gibi yönetici yönetimi).
-- Yeni bir community_role değeri EKLENMEZ: mevcut rol mantığı (MEMBER/MODERATOR) dokunulmaz kalır, V1 izolasyonu bozulmaz.
-- DB düzeyinde iki güvence (uygulama zaten aynı kuralı verir; bu tetikleyiciler yarışta ve doğrudan SQL'de de korur):
--   1) sahip o topluluğun üyesi olmak zorundadır;
--   2) sahip olan kullanıcının üyeliği silinemez (önce sahiplik devredilir/bırakılır): "son sahip koruması".
BEGIN;

ALTER TABLE "communities" ADD COLUMN "owner_id" UUID;
ALTER TABLE "communities"
  ADD CONSTRAINT "communities_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "communities_owner_id_idx" ON "communities"("owner_id");

CREATE FUNCTION kv_communities_owner_is_member() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM community_memberships m WHERE m.community_id = NEW.id AND m.user_id = NEW.owner_id
  ) THEN
    RAISE EXCEPTION 'community owner must be a member of the community' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER communities_owner_is_member
  BEFORE INSERT OR UPDATE OF owner_id ON "communities"
  FOR EACH ROW EXECUTE FUNCTION kv_communities_owner_is_member();

CREATE FUNCTION kv_membership_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM communities c WHERE c.id = OLD.community_id AND c.owner_id = OLD.user_id) THEN
    RAISE EXCEPTION 'community owner cannot leave; release or transfer ownership first' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER community_memberships_owner_guard
  BEFORE DELETE ON "community_memberships"
  FOR EACH ROW EXECUTE FUNCTION kv_membership_owner_guard();

COMMIT;

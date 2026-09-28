-- KV-11 (#13) · Sahip: Faruk · Anket sahibi kendi anketine oy veremez (API_CONTRACTS §6, §7 karar 1)
-- Sadece elle yazılan SQL: Prisma schema'sında değişiklik yok (trigger + fonksiyon).
-- API aynı kontrolü önce yapar ve 403 SELF_VOTE_FORBIDDEN döner; bu trigger, API'yi atlayan
-- yazmaları (ör. hatalı bir job, elle SQL) da reddeder. Hata kodu KV_SELF_VOTE → contracts dbErrorMap.

CREATE FUNCTION kv_votes_forbid_self_vote() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "polls" WHERE "id" = NEW."poll_id" AND "author_id" = NEW."user_id") THEN
    RAISE EXCEPTION 'KV_SELF_VOTE: anket sahibi kendi anketine oy veremez (poll %)', NEW."poll_id"
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- votes_guard_identity poll_id/user_id değişimini zaten engeller; INSERT yeterli olurdu, ama
-- UPDATE de kapsanır ki kimlik trigger'ı kaldırılırsa bu kural açılmasın.
CREATE TRIGGER "votes_forbid_self_vote"
  BEFORE INSERT OR UPDATE OF "poll_id", "user_id" ON "votes"
  FOR EACH ROW EXECUTE FUNCTION kv_votes_forbid_self_vote();

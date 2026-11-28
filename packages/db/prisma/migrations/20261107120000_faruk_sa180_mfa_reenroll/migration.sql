-- #180/#291: kullanıcının kendi doğrulayıcısını kilitlenmeden yenilemesi.
-- Yeni sır etkin kaydın (secret_cipher) yanında AYRI bekleyen alanda tutulur; eski sır onaya kadar geçerlidir.
-- Bekleyen alan başlatan oturuma bağlıdır ve süreli; üç alan birlikte dolu ya da birlikte boştur.
ALTER TABLE user_mfa_credentials
  ADD COLUMN reenroll_secret_cipher bytea NULL,
  ADD COLUMN reenroll_session_id uuid NULL,
  ADD COLUMN reenroll_expires_at timestamptz NULL,
  ADD CONSTRAINT user_mfa_credentials_reenroll_complete CHECK (
    (reenroll_secret_cipher IS NULL AND reenroll_session_id IS NULL AND reenroll_expires_at IS NULL)
    OR (reenroll_secret_cipher IS NOT NULL AND reenroll_session_id IS NOT NULL AND reenroll_expires_at IS NOT NULL)
  );
-- Yenilemede eski kurtarma kodları silinmez, iptal edilir (iz kalır); doğrulama yalnız iptal edilmemiş kodu kabul eder.
ALTER TABLE mfa_recovery_codes ADD COLUMN revoked_at timestamptz(6) NULL;

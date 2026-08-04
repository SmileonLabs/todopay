ALTER TABLE otp_settings
  ADD COLUMN IF NOT EXISTS pending_secret text,
  ADD COLUMN IF NOT EXISTS verified_at timestamp,
  ADD COLUMN IF NOT EXISTS recovery_codes_hash text,
  ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

COMMENT ON COLUMN otp_settings.otp_secret IS
  'AES-256-GCM encrypted active TOTP secret; never returned by read APIs';
COMMENT ON COLUMN otp_settings.pending_secret IS
  'AES-256-GCM encrypted unverified enrollment secret';

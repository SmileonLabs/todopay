ALTER TABLE otp_settings
  ADD COLUMN IF NOT EXISTS last_used_step integer;

COMMENT ON COLUMN otp_settings.last_used_step IS
  'Highest successfully consumed 30-second TOTP counter; prevents code replay';

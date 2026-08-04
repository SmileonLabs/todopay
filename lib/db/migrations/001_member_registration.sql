ALTER TABLE virtual_account_issuances
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS verification_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_code text;

CREATE UNIQUE INDEX IF NOT EXISTS virtual_account_issuances_merchant_idempotency_unique
  ON virtual_account_issuances(merchant_id, idempotency_key);

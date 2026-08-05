BEGIN;

ALTER TABLE payment_intents
  ADD COLUMN IF NOT EXISTS attempt_number integer NOT NULL DEFAULT 1;

ALTER TABLE payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_attempt_number_check;
ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_attempt_number_check CHECK (attempt_number > 0);

DROP INDEX IF EXISTS payment_intents_merchant_order_unique;
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_merchant_order_attempt_unique
  ON payment_intents(merchant_id, merchant_order_id, attempt_number);

ALTER TABLE payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_provider_tracking_number_length_check;
ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_provider_tracking_number_length_check
  CHECK (provider_tracking_number IS NULL OR char_length(provider_tracking_number) <= 50);

COMMIT;
